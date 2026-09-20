/**
 * JevDecisionProvider: real Jev integration, SERVER-ONLY.
 *
 * One System One request per evaluation, with a reduced RunningContext state
 * (see docs/research/implementacion-jev-carrera.md) and exactly four typed
 * questions (Choice / Noul / Choice / Score).
 *
 * Hard rules (from docs/prompts/desarrollar-demo-carrera-jev.md):
 * - Jev classifies already-processed context; it never computes numbers,
 *   applies thresholds, or overrides safety.
 * - The adapter never produces stop_and_escalate; safety owns that action.
 * - Any failure propagates: no silent mock substitution. The pipeline in
 *   decideSecond catches it and composes "maintain".
 * - TYPESAFE_API_KEY is never exposed to the client; this module must not be
 *   imported by browser code.
 */

import {
  TypeSafeClient,
  choice,
  noul,
  score,
  type Questions,
  type SystemOneRequest,
  type SystemOneResult,
  type RequestOptions,
} from "@typesafe-ai/sdk";
import type { DecisionProvider, DecideInput, ProviderResult, ProviderAction, ProviderContextExplanation } from "./provider";
import { PACE_WINDOW_SECONDS } from "../domain/metrics";

/** Per-attempt HTTP timeout for the Jev call. Pilot default: 5 s. */
export const JEVD_DEFAULT_TIMEOUT_MS = 5000;

/**
 * Structural client subset used by the adapter. TypeSafeClient satisfies it;
 * tests inject fakes through the constructor so no network and no real
 * API key are ever involved.
 */
export interface JevClientLike {
  systemOne<Q extends Questions>(
    request: SystemOneRequest<Q>,
    options?: RequestOptions,
  ): Promise<SystemOneResult<Q>>;
}

/**
 * Reduced RunningContext sent to Jev (docs/research shape). Built from the
 * prepared provider context produced by buildDecisionContext.
 */
export type RunningContext = {
  sport: "running";
  block: string;
  target?: {
    paceSecPerKm?: { min: number; max: number };
  };
  window: {
    durationSeconds: number;
    paceSecPerKm?: number;
    paceVsTargetSeconds?: number; // positive = slower than target
    heartRateBpm?: number;
    hrTrendBpmPerMin?: number;
    gradePct?: number;
    stoppedOrAutoPaused: boolean;
    signalQuality: "high" | "medium" | "low" | "unknown";
    dataAgeSeconds: number;
  };
  athlete: {
    rpe?: number; // 0-10
    symptomsReported: boolean;
  };
  safety: {
    hardStop: boolean;
    mayIncreaseIntensity: boolean;
    missingRequiredMetric: boolean;
  };
  /**
   * History-maturity signals, kept at top level by adapter convention: how
   * much comparable history exists to interpret the window against. Omitted
   * when the prepared context does not carry them (JSON-safe state).
   */
  historyMaturity?: string;
  comparableHistoryCount?: number;
};

/** Question labels -> ProviderAction. stop_and_escalate is intentionally absent. */
const ACTION_BY_LABEL: Record<string, ProviderAction> = {
  increase_gently: "increase_gently",
  maintain: "maintain",
  decrease_gently: "decrease_gently",
  recover: "recover",
  // Adapter-boundary mapping: Jev's "not enough evidence" is the pipeline's
  // insufficient_data. Never a stop.
  insufficient_evidence: "insufficient_data",
};

const EXPLANATIONS: readonly ProviderContextExplanation[] = [
  "uphill_or_terrain",
  "pace_below_target",
  "likely_heat_or_fatigue",
  "normal_variation",
  "not_enough_context",
];

// ---------------------------------------------------------------------------
// State building
// ---------------------------------------------------------------------------

function readNumber(context: Record<string, unknown>, key: string): number | undefined {
  const value = context[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNullableNumber(
  context: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = context[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readString(context: Record<string, unknown>, key: string): string | undefined {
  const value = context[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readBoolean(context: Record<string, unknown>, key: string): boolean {
  return context[key] === true;
}

/** Keeps the state JSON-safe: undefined keys are omitted, nulls become absent optionals. */
function withoutUndefined(
  values: Record<string, unknown>,
): Record<string, string | number | boolean | Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Record<string, string | number | boolean | Record<string, unknown>>;
}

/**
 * Builds the reduced RunningContext for Jev from the prepared provider
 * context (buildDecisionContext output). No raw route data, no identifiers,
 * no full biometric history, no raw proprietary scores.
 */
export function buildJevState(context: Record<string, unknown>): RunningContext {
  const block = readString(context, "block") ?? "easy";
  const second = readNumber(context, "second") ?? 0;
  const signalQuality = readString(context, "signalQuality") ?? "unknown";

  const window = withoutUndefined({
    // Length of the processed pace/HR window ending at this second.
    durationSeconds: Math.min(second + 1, PACE_WINDOW_SECONDS),
    paceSecPerKm: readNullableNumber(context, "paceSecPerKm"),
    paceVsTargetSeconds: readNullableNumber(context, "paceVsTargetSeconds"),
    heartRateBpm: readNullableNumber(context, "heartRateBpm"),
    hrTrendBpmPerMin: readNullableNumber(context, "hrTrendBpmPerMin"),
    gradePct: readNumber(context, "gradePct") ?? 0,
    stoppedOrAutoPaused: readBoolean(context, "autoPaused"),
    signalQuality,
    dataAgeSeconds: readNumber(context, "dataAgeSeconds") ?? 0,
  });

  // The provider only runs after safety passed, so hardStop and
  // missingRequiredMetric are always false at this point. These flags are
  // stated explicitly so Jev reasons over the same safety picture.
  const safety = {
    hardStop: false,
    mayIncreaseIntensity: readBoolean(context, "mayIncreaseIntensity"),
    missingRequiredMetric: false,
  };

  const athlete = withoutUndefined({
    rpe: readNumber(context, "rpe"),
    symptomsReported: readBoolean(context, "symptomsReported"),
  });

  // History-maturity signals for the interpretability question. Top level by
  // adapter convention; omitted when the prepared context lacks them.
  const historyMaturity = readString(context, "historyMaturity");
  const comparableHistoryCount = readNumber(context, "comparableHistoryCount");

  // The block pace-target range is not part of buildDecisionContext output
  // today; include it when a caller supplies it so the state stays faithful
  // to the documented RunningContext shape.
  const targetRaw = context["targetPaceSecPerKm"];
  let target: RunningContext["target"] | undefined;
  if (
    typeof targetRaw === "object" &&
    targetRaw !== null &&
    typeof (targetRaw as Record<string, unknown>)["min"] === "number" &&
    typeof (targetRaw as Record<string, unknown>)["max"] === "number"
  ) {
    const targetRange = targetRaw as Record<string, unknown>;
    target = {
      paceSecPerKm: {
        min: targetRange["min"] as number,
        max: targetRange["max"] as number,
      },
    };
  }

  return {
    sport: "running",
    block,
    ...(target !== undefined ? { target } : {}),
    window: {
      durationSeconds: window["durationSeconds"] as number,
      paceSecPerKm: window["paceSecPerKm"] as number | undefined,
      paceVsTargetSeconds: window["paceVsTargetSeconds"] as number | undefined,
      heartRateBpm: window["heartRateBpm"] as number | undefined,
      hrTrendBpmPerMin: window["hrTrendBpmPerMin"] as number | undefined,
      gradePct: window["gradePct"] as number | undefined,
      stoppedOrAutoPaused: window["stoppedOrAutoPaused"] as boolean,
      signalQuality: window["signalQuality"] as RunningContext["window"]["signalQuality"],
      dataAgeSeconds: window["dataAgeSeconds"] as number,
    },
    athlete: {
      rpe: athlete["rpe"] as number | undefined,
      symptomsReported: athlete["symptomsReported"] as boolean,
    },
    safety,
    ...(historyMaturity !== undefined ? { historyMaturity } : {}),
    ...(comparableHistoryCount !== undefined ? { comparableHistoryCount } : {}),
  };
}

// ---------------------------------------------------------------------------
// Questions (plain English, specific criteria, per the docs)
// ---------------------------------------------------------------------------

const EFFORT_ACTION_INSTRUCTIONS =
  "For the current running block, select the most conservative training action. " +
  "Field meanings: `window.paceVsTargetSeconds` is the window pace versus the target range `target.paceSecPerKm` (when present); positive means slower than target, negative means faster. " +
  "`window.hrTrendBpmPerMin` is heart-rate drift per minute across the window; a clearly positive value means rising internal cost. " +
  "`athlete.rpe` is the runner's self-reported effort on a 0-10 scale, higher = harder. " +
  "`safety.mayIncreaseIntensity` false means an intensity increase is not allowed in this state; a hard safety stop or reported symptoms would have blocked this request before it was sent. " +
  "Judge from `block`, the window fields, `athlete.rpe`, and data reliability (`window.signalQuality`, `window.dataAgeSeconds`). Do not diagnose illness. " +
  "Choose the conservative action given the evidence; use insufficient_evidence only when the state genuinely lacks the metrics needed for the other options (for example no pace and no heart rate), not merely when the choice is close.";

const EFFORT_DISPROPORTIONATE_INSTRUCTIONS =
  "Is the runner's apparent effort disproportionate to the current workout objective? " +
  "Compare the self-reported effort `athlete.rpe` (0-10, higher = harder) against the observed pace `window.paceSecPerKm` and heart rate `window.heartRateBpm` for the block type `block` and the target pace range `target.paceSecPerKm` when present. " +
  "Effort is disproportionate when RPE or heart rate is clearly higher than the pace and block justify (for example high `athlete.rpe` with pace at or faster than target, or `window.hrTrendBpmPerMin` clearly positive at an easy pace), discounting terrain via `window.gradePct` and unreliable data via `window.signalQuality`. Do not diagnose illness.";

const CONTEXT_EXPLANATION_INSTRUCTIONS =
  "Which non-medical context best explains this pace-versus-effort pattern? " +
  "Read the state: `window.gradePct` is terrain slope in percent (non-zero grade plausibly slows pace at modest effort); `window.paceVsTargetSeconds` is seconds versus the target range `target.paceSecPerKm` (positive = slower); `window.heartRateBpm` and `window.hrTrendBpmPerMin` show internal cost and its drift; `window.signalQuality` and `window.dataAgeSeconds` say how trustworthy the window is. " +
  "uphill_or_terrain when `window.gradePct` explains a slower pace without excess effort; pace_below_target when pace is below the target range without excess effort; likely_heat_or_fatigue when effort is elevated for a comparable pace (a training-context label, not a diagnosis); normal_variation when the deviation is small or expected; not_enough_context when these window fields cannot support any explanation.";

const CONTEXT_INTERPRETABILITY_INSTRUCTIONS =
  "Score how interpretable this context is for a conservative pacing decision, based on what the state concretely contains: the target range `target.paceSecPerKm`; window pace and heart rate (`window.paceSecPerKm`, `window.heartRateBpm`); the heart-rate trend `window.hrTrendBpmPerMin`; self-reported effort `athlete.rpe`; and comparison history (`historyMaturity`, `comparableHistoryCount`). Judge completeness and consistency of this picture, not which action to take.";

const EFFORT_ACTION_CRITERIA = {
  increase_gently:
    "Easy block only: pace has been sustainably below the target range, apparent effort is low, data is recent and reliable, and safety in state permits a small increase.",
  maintain:
    "Pace and apparent effort fit the planned block, or the deviation is small normal variation.",
  decrease_gently:
    "Apparent effort is higher than intended for this block, without any emergency signal.",
  recover:
    "The current block appears poorly tolerated and the runner should transition to recovery.",
  insufficient_evidence:
    "The context is incomplete, stale, contradictory, or too ambiguous to choose an action.",
} as const;

const CONTEXT_EXPLANATION_CRITERIA = {
  uphill_or_terrain: "Terrain or grade plausibly explains the pace-versus-effort pattern.",
  pace_below_target:
    "The runner is below the planned easy pace without excess apparent effort.",
  likely_heat_or_fatigue:
    "Effort is elevated for a comparable pace; this is a training-context label, not a diagnosis.",
  normal_variation: "The deviation is small or expected for this point in the session.",
  not_enough_context: "The state cannot support any explanation.",
} as const;

const INTERPRETABILITY_RUBRIC = [
  "Unusable: key measurements are missing or unusable - for example `window.paceSecPerKm` or `window.heartRateBpm` absent, a stale or low-quality window (`window.dataAgeSeconds`, `window.signalQuality`), or no comparable history (`historyMaturity`, `comparableHistoryCount`) - so the pattern cannot be judged.",
  "Limited: the core window metrics exist and are fresh, but the picture is incomplete - for example the target range `target.paceSecPerKm`, the trend `window.hrTrendBpmPerMin`, or `athlete.rpe` is missing, or history is not yet mature - so the pattern is only partly explained.",
  "Clear: target (`target.paceSecPerKm`), window pace and heart rate (`window.paceSecPerKm`, `window.heartRateBpm`), trend (`window.hrTrendBpmPerMin`), effort (`athlete.rpe`), terrain (`window.gradePct`), and data quality (`window.signalQuality`) are present and form a consistent picture.",
] as const;

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

function assertKnownLabel(label: string, question: string): void {
  if (!(label in ACTION_BY_LABEL)) {
    throw new Error(`Jev returned unknown ${question} label: ${label}`);
  }
}

export class JevDecisionProvider implements DecisionProvider {
  private readonly client: JevClientLike;

  /**
   * @param client injected TypeSafe client (or a test fake). When omitted, a
   * real client is built, which reads TYPESAFE_API_KEY from the environment.
   * @param timeoutMs per-attempt HTTP timeout; default 5 s. Per-attempt retry
   * backoff is a client-level concern; the pipeline treats any failure as
   * "maintain" via decideSecond.
   */
  constructor(client?: JevClientLike, timeoutMs: number = JEVD_DEFAULT_TIMEOUT_MS) {
    this.client = client ?? new TypeSafeClient({ timeout: timeoutMs });
  }

  async decide(input: DecideInput): Promise<ProviderResult> {
    const state = buildJevState(input.context);

    const response = await this.client.systemOne({
      // SDK default model ('jev-latest') is used: no model override here.
      state,
      questions: {
        effort_action: choice(EFFORT_ACTION_INSTRUCTIONS, EFFORT_ACTION_CRITERIA),
        effort_disproportionate: noul(
          EFFORT_DISPROPORTIONATE_INSTRUCTIONS,
          {
            true: "Effort is clearly higher than the block and target pace justify.",
            false: "Effort is proportionate to the block, pace, and terrain.",
          },
        ),
        context_explanation: choice(
          CONTEXT_EXPLANATION_INSTRUCTIONS,
          CONTEXT_EXPLANATION_CRITERIA,
        ),
        context_interpretability: score(
          CONTEXT_INTERPRETABILITY_INSTRUCTIONS,
          INTERPRETABILITY_RUBRIC,
        ),
      },
    });

    const { answers } = response;

    // effort_action: Choice -> ProviderAction (never stop_and_escalate).
    const actionLabel = answers.effort_action.choice;
    assertKnownLabel(actionLabel, "effort_action");
    const action = ACTION_BY_LABEL[actionLabel];
    if (action === undefined) {
      // Unreachable given ACTION_BY_LABEL; kept as a fail-closed guard.
      throw new Error(`Jev effort_action label cannot be mapped: ${actionLabel}`);
    }

    // effort_disproportionate: Noul -> yes-probability. Noul answers carry no
    // confidence field, so none is invented.
    const disproportionateEffortProbability = answers.effort_disproportionate.noul;

    // context_explanation: Choice -> explanation label.
    const explanationLabel = answers.context_explanation.choice;
    if (!(EXPLANATIONS as readonly string[]).includes(explanationLabel)) {
      throw new Error(`Jev returned unknown context_explanation label: ${explanationLabel}`);
    }

    // context_interpretability: Score -> interpretability with number-keyed
    // probabilities (SDK keys them by rubric level as strings).
    const scoreAnswer = answers.context_interpretability;
    const interpretability = {
      score: scoreAnswer.score,
      confidence: scoreAnswer.confidence,
      probabilities: Object.fromEntries(
        Object.entries(scoreAnswer.probabilities).map(([key, value]) => [Number(key), value]),
      ),
    };

    return {
      action,
      actionConfidence: answers.effort_action.confidence,
      disproportionateEffortProbability,
      contextExplanation: explanationLabel,
      interpretability,
      raw: { model: response.model, answers },
      source: "jev",
    };
  }
}
