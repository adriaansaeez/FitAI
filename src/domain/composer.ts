import type {
  DerivedMetrics,
  DecisionTrace,
  RunningSample,
  SafetyResult,
  TrainingBlock,
  PaceTargetSecPerKm,
} from "./types";
import { computeDerivedMetrics } from "./metrics";
import { evaluateSafety as evaluateSafetyPolicy } from "./safety";
import type { HeartRateZone } from "./heartRateZones";
import type { DecisionProvider, ProviderResult } from "../services/provider";

export const COMPOSER_REASON_CODES = {
  providerUnavailable: "provider_unavailable",
  lowChoiceConfidence: "low_choice_confidence",
  choiceConfidenceMissing: "choice_confidence_missing",
  lowInterpretability: "low_interpretability",
  increaseNotEasyBlock: "increase_not_easy_block",
  increaseBlockedBySafety: "increase_blocked_by_safety",
  increaseWithoutTarget: "increase_without_target",
  increaseAtHeartRateZoneCeiling: "increase_at_heart_rate_zone_ceiling",
  disproportionateEffortRisk: "disproportionate_effort_risk",
  cooldownNoOppositeChange: "cooldown_no_opposite_change",
  recoverReevaluationPending: "recover_reevaluation_pending",
  increaseAdjustmentLimited: "increase_adjustment_limited_5_10_sec_per_km",
  decreaseAdjustmentLimited: "decrease_adjustment_limited_5_15_sec_per_km",
  symptomsReported: "symptoms_reported",
  lowSignalQuality: "low_signal_quality",
  staleData: "stale_data",
  autoPaused: "auto_paused",
  missingRequiredMetrics: "missing_required_metrics",
  noIncreaseInBlock: "no_increase_in_block",
  composerBypassed: "composer_bypassed",
} as const;

/** Cooldown after a pace change during which opposite changes are blocked. */
export const PACE_CHANGE_COOLDOWN_SECONDS = 60;

/** A recover decision is re-evaluated after this many seconds. */
export const RECOVER_REEVALUATION_SECONDS = 90;

/** Provider choice confidence below this is rejected (pilot threshold). */
export const MIN_CHOICE_CONFIDENCE = 0.7;

/** Interpretability below this is rejected (pilot threshold). */
export const MIN_INTERPRETABILITY_SCORE = 1.4;
export const MIN_INTERPRETABILITY_CONFIDENCE = 0.75;

/** Disproportionate-effort probability at or above this blocks increases. */
export const MAX_DISPROPORTIONATE_EFFORT_PROBABILITY = 0.3;

const SAFETY_REASON_TO_CODE: Record<string, string> = {
  symptoms_reported: COMPOSER_REASON_CODES.symptomsReported,
  low_signal_quality: COMPOSER_REASON_CODES.lowSignalQuality,
  stale_data: COMPOSER_REASON_CODES.staleData,
  auto_paused: COMPOSER_REASON_CODES.autoPaused,
  missing_required_metrics: COMPOSER_REASON_CODES.missingRequiredMetrics,
  no_increase_in_block: COMPOSER_REASON_CODES.noIncreaseInBlock,
};

function mapSafetyReason(reason: string): string {
  return SAFETY_REASON_TO_CODE[reason] ?? reason;
}

function isLowConfidence(providerResult: ProviderResult): boolean {
  if (providerResult.actionConfidence === undefined) {
    return true;
  }
  return providerResult.actionConfidence < MIN_CHOICE_CONFIDENCE;
}

function isLowInterpretability(providerResult: ProviderResult): boolean {
  const interpretability = providerResult.interpretability;
  if (interpretability === undefined) {
    return true;
  }
  return (
    interpretability.score < MIN_INTERPRETABILITY_SCORE ||
    interpretability.confidence < MIN_INTERPRETABILITY_CONFIDENCE
  );
}

function probabilitiesToStringKeys(
  probabilities: Record<number, number> | undefined,
): Record<string, number> | undefined {
  if (probabilities === undefined) {
    return undefined;
  }
  const entries = Object.entries(probabilities).map(([key, value]) => [key, value] as const);
  return Object.fromEntries(entries);
}

function hasIncreaseBlockers(
  safety: SafetyResult,
  block: TrainingBlock | undefined,
  hasTarget: boolean,
  comparableHistoryCount: number,
): boolean {
  // An absent block must fail closed: only an explicit "easy" block may increase.
  if (block === undefined || block !== "easy") {
    return true;
  }
  // Fail closed (Kona 2022): without a verifiable pace target or without any
  // comparable history there is no basis for an increase, whatever the
  // provider proposes.
  if (!hasTarget || comparableHistoryCount <= 0) {
    return true;
  }
  return !safety.mayIncreaseIntensity;
}

function hasDisproportionateRisk(providerResult: ProviderResult): boolean {
  const probability = providerResult.disproportionateEffortProbability;
  return probability !== undefined && probability >= MAX_DISPROPORTIONATE_EFFORT_PROBABILITY;
}

/**
 * Pure composer: combines sample, metrics, safety, provider result and the
 * previous decision into the final trace for this second.
 *
 * Deviation from the spec signature: optional trailing parameters were added
 * so the "increase only in easy" rule and the fail-closed target/history guard
 * can be enforced without threading block state through DerivedMetrics
 * (immutable in this task). When block is undefined, increases are
 * conservatively denied; the same applies when targetPaceSecPerKm is omitted
 * or comparableHistoryCount is 0.
 */
export function composeDecision(
  sample: RunningSample,
  metrics: DerivedMetrics,
  safety: SafetyResult,
  providerResult: ProviderResult | null,
  previousDecision: DecisionTrace | null,
  block?: TrainingBlock,
  targetPaceSecPerKm?: PaceTargetSecPerKm,
  /** "raw" bypasses every composer veto/correction rule; defaults to "guarded". */
  policyMode: "guarded" | "raw" = "guarded",
): DecisionTrace {
  const reasonCodes: string[] = safety.reasonCodes.map(mapSafetyReason);

  // 1. Hard stop wins over everything and never reaches a provider.
  if (safety.hardStop) {
    return {
      second: sample.second,
      action: "stop_and_escalate",
      source: "safety",
      confidence: 1,
      reasonCodes,
      explanationKey: `decision.stop_and_escalate.${COMPOSER_REASON_CODES.symptomsReported}`,
      derivedMetrics: metrics,
      safety,
    };
  }

  // 2. Missing required metrics or degraded data -> insufficient data.
  if (safety.missingRequiredMetric || isDegradedSafety(safety)) {
    return {
      second: sample.second,
      action: "insufficient_data",
      source: "safety",
      confidence: 1,
      reasonCodes,
      explanationKey: `decision.insufficient_data.${primaryReason(reasonCodes) ?? COMPOSER_REASON_CODES.staleData}`,
      derivedMetrics: metrics,
      safety,
    };
  }

  // Raw mode: the provider decision is accepted verbatim. The hard stop and
  // the missingRequiredMetric / degraded-safety short-circuits above still
  // apply, and the recover hold below is bypassed (it is a composer rule,
  // not a safety rule). Every other veto/correction rule (cooldown, low
  // confidence, low interpretability, increase validity, zone ceiling,
  // disproportionate risk, adjustment limits) is also skipped, and the
  // bypass is recorded for audit.
  if (policyMode === "raw") {
    // Without a provider result there is nothing to accept verbatim: skip the
    // recover hold below and fall through to the provider-unavailable handling.
    if (providerResult !== null) {
      reasonCodes.push(COMPOSER_REASON_CODES.composerBypassed);
      return {
        second: sample.second,
        action: providerResult.action,
        source: providerResult.source ?? "composer",
        confidence: providerResult.actionConfidence,
        reasonCodes,
        explanationKey: decisionMessageKey(
          providerResult.action,
          primaryReason(reasonCodes),
        ),
        derivedMetrics: metrics,
        safety,
        probabilities: probabilitiesToStringKeys(providerResult.interpretability?.probabilities),
      };
    }
  }

  // 3. Recover hold: a previous recover stands until re-evaluation time
  // (raw mode never reaches this rule: it returned above or has no provider
  // result and falls through to the provider-unavailable handling).
  if (
    policyMode !== "raw" &&
    previousDecision !== null &&
    previousDecision.action === "recover" &&
    sample.second - previousDecision.second < RECOVER_REEVALUATION_SECONDS
  ) {
    return {
      second: sample.second,
      action: "recover",
      source: "composer",
      confidence: previousDecision.confidence,
      reasonCodes: [...reasonCodes, COMPOSER_REASON_CODES.recoverReevaluationPending],
      explanationKey: `decision.recover.${COMPOSER_REASON_CODES.recoverReevaluationPending}`,
      derivedMetrics: metrics,
      safety,
      probabilities: previousDecision.probabilities,
    };
  }

  // 4. Provider unavailable or failed -> maintain; run continues.
  if (providerResult === null) {
    return {
      second: sample.second,
      action: "maintain",
      source: "composer",
      reasonCodes: [...reasonCodes, COMPOSER_REASON_CODES.providerUnavailable],
      explanationKey: `decision.maintain.${COMPOSER_REASON_CODES.providerUnavailable}`,
      derivedMetrics: metrics,
      safety,
    };
  }

  let proposedAction = providerResult.action;
  let composerSource: "mock" | "jev" | "composer" =
    providerResult.source ?? "composer";

  // 5. Cooldown: block immediate opposite change after a pace change.
  const cooldownBlock = cooldownOppositeChangeBlock(previousDecision, proposedAction, sample.second);
  if (cooldownBlock) {
    reasonCodes.push(COMPOSER_REASON_CODES.cooldownNoOppositeChange);
    // Guard overrides dominate; recorded as safety even though Jev may have run.
    return {
      second: sample.second,
      action: "maintain",
      source: "safety",
      confidence: providerResult.actionConfidence,
      reasonCodes,
      explanationKey: `decision.maintain.${COMPOSER_REASON_CODES.cooldownNoOppositeChange}`,
      derivedMetrics: metrics,
      safety,
    };
  }

  // 6. Low provider confidence -> maintain.
  if (isLowConfidence(providerResult)) {
    reasonCodes.push(
      providerResult.actionConfidence === undefined
        ? COMPOSER_REASON_CODES.choiceConfidenceMissing
        : COMPOSER_REASON_CODES.lowChoiceConfidence,
    );
    proposedAction = "maintain";
    composerSource = "composer";
  }

  // 7. Low interpretability -> maintain.
  if (isLowInterpretability(providerResult)) {
    reasonCodes.push(COMPOSER_REASON_CODES.lowInterpretability);
    proposedAction = "maintain";
    composerSource = "composer";
  }

  // 8. increase_gently validity: easy block, safety allows, low risk, and a
  // fail-closed target/history guard (never increase without them).
  if (proposedAction === "increase_gently") {
    const hasTarget = targetPaceSecPerKm !== undefined;
    if (
      hasIncreaseBlockers(
        safety,
        block,
        hasTarget,
        metrics.comparableHistoryCount,
      )
    ) {
      if (block !== "easy") {
        // Absent block keeps the original conservative code; explicit non-easy
        // blocks report the block reason.
        reasonCodes.push(
          block !== undefined
            ? COMPOSER_REASON_CODES.increaseNotEasyBlock
            : COMPOSER_REASON_CODES.increaseBlockedBySafety,
        );
      } else if (!hasTarget || metrics.comparableHistoryCount <= 0) {
        reasonCodes.push(COMPOSER_REASON_CODES.increaseWithoutTarget);
      } else {
        reasonCodes.push(COMPOSER_REASON_CODES.increaseBlockedBySafety);
      }
      proposedAction = "maintain";
      composerSource = "composer";
    } else if (typeof metrics.heartRateZoneDelta === "number" && metrics.heartRateZoneDelta >= 0) {
      reasonCodes.push(COMPOSER_REASON_CODES.increaseAtHeartRateZoneCeiling);
      proposedAction = "maintain";
      composerSource = "composer";
    } else if (hasDisproportionateRisk(providerResult)) {
      reasonCodes.push(COMPOSER_REASON_CODES.disproportionateEffortRisk);
      proposedAction = "maintain";
      composerSource = "composer";
    }
  }

  // 9. Adjustment limits are surfaced as reason codes / templates.
  if (proposedAction === "increase_gently") {
    reasonCodes.push(COMPOSER_REASON_CODES.increaseAdjustmentLimited);
  } else if (proposedAction === "decrease_gently") {
    reasonCodes.push(COMPOSER_REASON_CODES.decreaseAdjustmentLimited);
  }

  return {
    second: sample.second,
    action: proposedAction,
    source: composerSource,
    confidence: providerResult.actionConfidence,
    reasonCodes,
    explanationKey: decisionMessageKey(proposedAction, primaryReason(reasonCodes)),
    derivedMetrics: metrics,
    safety,
    probabilities: probabilitiesToStringKeys(providerResult.interpretability?.probabilities),
  };
}

function isDegradedSafety(safety: SafetyResult): boolean {
  const degradedCodes: string[] = [
    COMPOSER_REASON_CODES.lowSignalQuality,
    COMPOSER_REASON_CODES.staleData,
    COMPOSER_REASON_CODES.autoPaused,
  ];
  return safety.reasonCodes.some((reason) => degradedCodes.includes(mapSafetyReason(reason)));
}

function cooldownOppositeChangeBlock(
  previousDecision: DecisionTrace | null,
  proposedAction: "increase_gently" | "maintain" | "decrease_gently" | "recover" | "insufficient_data",
  currentSecond: number,
): boolean {
  if (previousDecision === null) {
    return false;
  }
  const previousAction = previousDecision.action;
  const withinCooldown = currentSecond - previousDecision.second < PACE_CHANGE_COOLDOWN_SECONDS;
  if (!withinCooldown) {
    return false;
  }
  if (previousAction === "increase_gently" && proposedAction === "decrease_gently") {
    return true;
  }
  if (previousAction === "decrease_gently" && proposedAction === "increase_gently") {
    return true;
  }
  return false;
}

function primaryReason(reasonCodes: string[]): string | null {
  const last = reasonCodes[reasonCodes.length - 1];
  return last ?? null;
}

export function decisionMessageKey(action: string, reasonCode: string | null): string {
  return reasonCode === null ? `decision.${action}` : `decision.${action}.${reasonCode}`;
}

/** Pure, deterministic context handed to a provider. */
export function buildDecisionContext(
  sample: RunningSample,
  metrics: DerivedMetrics,
  safety: SafetyResult,
  block: TrainingBlock,
  targetPaceSecPerKm?: PaceTargetSecPerKm,
): Record<string, unknown> {
  return {
    block,
    targetPaceSecPerKm,
    second: sample.second,
    paceSecPerKm: sample.paceSecPerKm,
    heartRateBpm: sample.heartRateBpm,
    gradePct: sample.gradePct,
    signalQuality: sample.signalQuality,
    dataAgeSeconds: sample.dataAgeSeconds,
    autoPaused: sample.autoPaused,
    rpe: sample.rpe,
    symptomsReported: sample.symptomsReported,
    paceWindowSecPerKm: metrics.paceWindowSecPerKm,
    heartRateWindowBpm: metrics.heartRateWindowBpm,
    hrTrendBpmPerMin: metrics.hrTrendBpmPerMin,
    paceVsTargetSeconds: metrics.paceVsTargetSeconds,
    comparableHistoryCount: metrics.comparableHistoryCount,
    historicalPaceDeltaSeconds: metrics.historicalPaceDeltaSeconds,
    historicalHrDeltaBpm: metrics.historicalHrDeltaBpm,
    historyMaturity: metrics.historyMaturity,
    heartRateZonePosition: metrics.heartRateZonePosition,
    targetHeartRateZoneMin: metrics.targetHeartRateZoneMin,
    targetHeartRateZoneMax: metrics.targetHeartRateZoneMax,
    heartRateZoneDelta: metrics.heartRateZoneDelta,
    consecutiveSecondsAboveHeartRateZone: metrics.consecutiveSecondsAboveHeartRateZone,
    mayIncreaseIntensity: safety.mayIncreaseIntensity,
    safetyReasonCodes: [...safety.reasonCodes],
  };
}

export type DecideSecondInput = {
  samples: readonly RunningSample[];
  block: TrainingBlock;
  targetPaceSecPerKm?: PaceTargetSecPerKm;
  baseline?: {
    typicalEasyPaceSecPerKm?: number;
    typicalEasyHrBpm?: number;
    typicalEasyRpe?: number;
  };
  comparableHistoryCount?: number;
  heartRateZones?: readonly HeartRateZone[];
  provider?: DecisionProvider;
  previousDecision?: DecisionTrace | null;
  /** Defaults to "guarded"; "raw" accepts the provider decision verbatim
   *  (symptom hard-stop and data-quality short-circuits still apply). */
  policyMode?: "guarded" | "raw";
};

/**
 * Orchestrates one second: metrics -> safety -> provider (unless safety
 * already forces a decision) -> composer. Safety always runs first and the
 * provider is skipped entirely when safety dictates the outcome.
 */
export async function decideSecond(input: DecideSecondInput): Promise<DecisionTrace> {
  const { samples, block, previousDecision } = input;
  const policyMode = input.policyMode ?? "guarded";
  const currentSample = samples[samples.length - 1];
  if (currentSample === undefined) {
    throw new Error("decideSecond requires at least one sample");
  }

  const metrics = computeDerivedMetrics({
    samples,
    second: currentSample.second,
    targetPaceSecPerKm: input.targetPaceSecPerKm,
    baseline: input.baseline,
    comparableHistoryCount: input.comparableHistoryCount ?? 0,
    block,
    heartRateZones: input.heartRateZones,
  });
  const safety = evaluateSafetyPolicy(currentSample, metrics, block);

  let providerResult: ProviderResult | null = null;
  const providerNeeded = !safety.hardStop && !safety.missingRequiredMetric && !isDegradedSafety(safety);
  if (providerNeeded && input.provider !== undefined) {
    try {
      providerResult = await input.provider.decide({
        context: buildDecisionContext(
          currentSample,
          metrics,
          safety,
          block,
          input.targetPaceSecPerKm,
        ),
        previousDecision: previousDecision ?? undefined,
      });
    } catch {
      providerResult = null;
    }
  }

  return composeDecision(
    currentSample,
    metrics,
    safety,
    providerResult,
    previousDecision ?? null,
    block,
    input.targetPaceSecPerKm,
    policyMode,
  );
}
