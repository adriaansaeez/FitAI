/**
 * Composer bypass (raw policy mode) tests.
 *
 * Raw mode ("policyMode: "raw"") skips ALL composer veto/correction rules
 * (low/missing confidence, low interpretability, disproportionate risk,
 * heart-rate-zone ceiling, increase validity guards, cooldown and adjustment
 * limits) so the provider decision is accepted verbatim. The symptom
 * hard-stop, missingRequiredMetric and degraded-safety short-circuits REMAIN
 * active, and every raw-mode decision from the provider carries the
 * `composer_bypassed` reason code for audit transparency.
 */

import { describe, expect, it, vi } from "vitest";
import {
  COMPOSER_REASON_CODES,
  PACE_CHANGE_COOLDOWN_SECONDS,
  composeDecision,
  decideSecond,
} from "../src/domain/composer";
import { resolveDecisionMessageKey } from "../src/domain/messageTemplates";
import type { DecisionProvider } from "../src/services/provider";
import type { ProviderResult } from "../src/services/provider";
import type {
  DecisionTrace,
  DerivedMetrics,
  PaceTargetSecPerKm,
  RunningSample,
  SafetyResult,
  TrainingBlock,
} from "../src/domain/types";

function sample(overrides: Partial<RunningSample> = {}): RunningSample {
  return {
    second: 130,
    timestamp: "2025-01-01T00:02:10.000Z",
    paceSecPerKm: 335,
    heartRateBpm: 140,
    distanceM: 5000,
    elevationM: 10,
    gradePct: 0,
    cadenceSpm: 170,
    signalQuality: "high",
    dataAgeSeconds: 0,
    autoPaused: false,
    symptomsReported: false,
    ...overrides,
  };
}

function metrics(overrides: Partial<DerivedMetrics> = {}): DerivedMetrics {
  return {
    paceWindowSecPerKm: 335,
    heartRateWindowBpm: 140,
    hrTrendBpmPerMin: 1,
    paceVsTargetSeconds: 5,
    comparableHistoryCount: 5,
    historicalPaceDeltaSeconds: null,
    historicalHrDeltaBpm: null,
    historyMaturity: "established",
    ...overrides,
  };
}

function cleanSafety(overrides: Partial<SafetyResult> = {}): SafetyResult {
  return {
    hardStop: false,
    mayIncreaseIntensity: true,
    missingRequiredMetric: false,
    reasonCodes: [],
    ...overrides,
  };
}

function providerResult(overrides: Partial<ProviderResult> = {}): ProviderResult {
  return {
    action: "increase_gently",
    actionConfidence: 0.9,
    disproportionateEffortProbability: 0.1,
    contextExplanation: "normal_variation",
    interpretability: { score: 2, confidence: 0.9, probabilities: { 1: 1 } },
    source: "mock",
    ...overrides,
  };
}

function trace(overrides: Partial<DecisionTrace>): DecisionTrace {
  return {
    second: 100,
    action: "increase_gently",
    source: "mock",
    confidence: 0.9,
    reasonCodes: [],
    explanationKey: "decision.increase_gently",
    derivedMetrics: metrics(),
    safety: cleanSafety(),
    ...overrides,
  };
}

function compose(
  overrides: {
    sample?: Partial<RunningSample>;
    metrics?: Partial<DerivedMetrics>;
    safety?: Partial<SafetyResult>;
    providerResult?: ProviderResult | null;
    previous?: DecisionTrace | null;
    block?: TrainingBlock;
    targetPaceSecPerKm?: PaceTargetSecPerKm | null;
    policyMode?: "guarded" | "raw";
  },
): DecisionTrace {
  const targetPaceSecPerKm =
    overrides.targetPaceSecPerKm === null
      ? undefined
      : (overrides.targetPaceSecPerKm ?? { min: 320, max: 340 });
  return composeDecision(
    sample(overrides.sample ?? {}),
    metrics(overrides.metrics ?? {}),
    cleanSafety(overrides.safety ?? {}),
    overrides.providerResult !== undefined ? overrides.providerResult : providerResult(),
    overrides.previous !== undefined ? overrides.previous : null,
    overrides.block ?? "easy",
    targetPaceSecPerKm,
    overrides.policyMode,
  );
}

describe("raw mode: composer veto rules are skipped", () => {
  it("a low-confidence increase the guarded mode would veto is accepted verbatim", () => {
    const guarded = compose({ providerResult: providerResult({ actionConfidence: 0.5 }) });
    expect(guarded.action).toBe("maintain");
    expect(guarded.source).toBe("composer");
    expect(guarded.reasonCodes).toContain(COMPOSER_REASON_CODES.lowChoiceConfidence);

    const raw = compose({
      providerResult: providerResult({ actionConfidence: 0.5 }),
      policyMode: "raw",
    });
    expect(raw.action).toBe("increase_gently");
    expect(raw.source).toBe("mock");
    expect(raw.confidence).toBe(0.5);
    expect(raw.reasonCodes).toContain(COMPOSER_REASON_CODES.composerBypassed);
    expect(raw.reasonCodes).not.toContain(COMPOSER_REASON_CODES.lowChoiceConfidence);
  });

  it("a proposal with missing confidence is accepted in raw mode", () => {
    const raw = compose({
      providerResult: providerResult({ actionConfidence: undefined }),
      policyMode: "raw",
    });
    expect(raw.action).toBe("increase_gently");
    expect(raw.source).toBe("mock");
    expect(raw.reasonCodes).not.toContain(COMPOSER_REASON_CODES.choiceConfidenceMissing);
    expect(raw.reasonCodes).toContain(COMPOSER_REASON_CODES.composerBypassed);
  });

  it("a low-interpretability proposal is accepted in raw mode", () => {
    const raw = compose({
      providerResult: providerResult({
        interpretability: { score: 1, confidence: 0.5, probabilities: { 1: 1 } },
      }),
      policyMode: "raw",
    });
    expect(raw.action).toBe("increase_gently");
    expect(raw.source).toBe("mock");
    expect(raw.reasonCodes).not.toContain(COMPOSER_REASON_CODES.lowInterpretability);
    expect(raw.reasonCodes).toContain(COMPOSER_REASON_CODES.composerBypassed);
  });

  it("an increase at the heart-rate zone ceiling is accepted in raw mode but vetoed when guarded", () => {
    const overrides = {
      metrics: { heartRateZoneDelta: 0.4 },
      providerResult: providerResult({ action: "increase_gently" as const }),
    };
    const guarded = compose(overrides);
    expect(guarded.action).toBe("maintain");
    expect(guarded.source).toBe("composer");
    expect(guarded.reasonCodes).toContain(COMPOSER_REASON_CODES.increaseAtHeartRateZoneCeiling);

    const raw = compose({ ...overrides, policyMode: "raw" });
    expect(raw.action).toBe("increase_gently");
    expect(raw.source).toBe("mock");
    expect(raw.reasonCodes).not.toContain(COMPOSER_REASON_CODES.increaseAtHeartRateZoneCeiling);
    expect(raw.reasonCodes).toContain(COMPOSER_REASON_CODES.composerBypassed);
  });

  it("an increase with disproportionate-effort risk is accepted in raw mode", () => {
    const raw = compose({
      providerResult: providerResult({ disproportionateEffortProbability: 0.9 }),
      policyMode: "raw",
    });
    expect(raw.action).toBe("increase_gently");
    expect(raw.reasonCodes).not.toContain(COMPOSER_REASON_CODES.disproportionateEffortRisk);
    expect(raw.reasonCodes).toContain(COMPOSER_REASON_CODES.composerBypassed);
  });

  it("increase validity guards (non-easy block, safety denial) are skipped in raw mode", () => {
    const rawNonEasy = compose({ block: "tempo", policyMode: "raw" });
    expect(rawNonEasy.action).toBe("increase_gently");
    expect(rawNonEasy.source).toBe("mock");
    expect(rawNonEasy.reasonCodes).not.toContain(COMPOSER_REASON_CODES.increaseNotEasyBlock);
    expect(rawNonEasy.reasonCodes).toContain(COMPOSER_REASON_CODES.composerBypassed);

    const rawSafetyDenial = compose({
      safety: { mayIncreaseIntensity: false },
      policyMode: "raw",
    });
    expect(rawSafetyDenial.action).toBe("increase_gently");
    expect(rawSafetyDenial.reasonCodes).not.toContain(
      COMPOSER_REASON_CODES.increaseBlockedBySafety,
    );

    const rawFailClosed = compose({
      targetPaceSecPerKm: null,
      metrics: { comparableHistoryCount: 0, historyMaturity: "none" },
      policyMode: "raw",
    });
    expect(rawFailClosed.action).toBe("increase_gently");
    expect(rawFailClosed.reasonCodes).not.toContain(COMPOSER_REASON_CODES.increaseWithoutTarget);
  });

  it("the cooldown on opposite changes is skipped in raw mode", () => {
    const previous = trace({ second: 100, action: "increase_gently" });
    const raw = compose({
      sample: { second: 100 + PACE_CHANGE_COOLDOWN_SECONDS - 1 },
      providerResult: providerResult({ action: "decrease_gently" }),
      previous,
      policyMode: "raw",
    });
    expect(raw.action).toBe("decrease_gently");
    expect(raw.source).toBe("mock");
    expect(raw.reasonCodes).not.toContain(COMPOSER_REASON_CODES.cooldownNoOppositeChange);
    expect(raw.reasonCodes).toContain(COMPOSER_REASON_CODES.composerBypassed);
  });

  it("adjustment-limit reason codes are not appended in raw mode", () => {
    const rawIncrease = compose({ policyMode: "raw" });
    expect(rawIncrease.reasonCodes).not.toContain(COMPOSER_REASON_CODES.increaseAdjustmentLimited);

    const rawDecrease = compose({
      providerResult: providerResult({ action: "decrease_gently" }),
      policyMode: "raw",
    });
    expect(rawDecrease.reasonCodes).not.toContain(COMPOSER_REASON_CODES.decreaseAdjustmentLimited);
    expect(rawDecrease.reasonCodes).toContain(COMPOSER_REASON_CODES.composerBypassed);
  });

  it("the provider source is preserved (jev stays jev) and the raw explanationKey resolves", () => {
    const raw = compose({ providerResult: providerResult({ source: "jev" }), policyMode: "raw" });
    expect(raw.source).toBe("jev");
    expect(raw.reasonCodes[raw.reasonCodes.length - 1]).toBe(
      COMPOSER_REASON_CODES.composerBypassed,
    );
    // No template exists for composer_bypassed: resolution falls back to the action.
    expect(resolveDecisionMessageKey(raw.action, COMPOSER_REASON_CODES.composerBypassed)).toBe(
      "decision.increase_gently",
    );
  });
});

describe("raw mode: safety short-circuits remain active", () => {
  it("the symptom hard-stop still wins in raw mode and carries no bypass code", () => {
    const raw = compose({
      sample: { symptomsReported: true },
      safety: { hardStop: true, mayIncreaseIntensity: false, reasonCodes: ["symptoms_reported"] },
      policyMode: "raw",
    });
    expect(raw.action).toBe("stop_and_escalate");
    expect(raw.source).toBe("safety");
    expect(raw.reasonCodes).toContain(COMPOSER_REASON_CODES.symptomsReported);
    expect(raw.reasonCodes).not.toContain(COMPOSER_REASON_CODES.composerBypassed);
  });

  it("decideSecond with a symptomatic sample stops before ever calling the provider in raw mode", async () => {
    const provider: DecisionProvider = {
      decide: vi.fn(() => Promise.resolve(providerResult({ source: "jev" }))),
    };
    const result = await decideSecond({
      samples: [sample({ symptomsReported: true })],
      block: "easy",
      policyMode: "raw",
      provider,
    });
    expect(result.action).toBe("stop_and_escalate");
    expect(result.source).toBe("safety");
    expect(provider.decide).not.toHaveBeenCalled();
  });

  it("missingRequiredMetric still short-circuits in raw mode", () => {
    const raw = compose({
      safety: {
        missingRequiredMetric: true,
        reasonCodes: ["missing_required_metrics"],
      },
      policyMode: "raw",
    });
    expect(raw.action).toBe("insufficient_data");
    expect(raw.source).toBe("safety");
    expect(raw.reasonCodes).not.toContain(COMPOSER_REASON_CODES.composerBypassed);
  });

  it("degraded safety (stale data) still short-circuits in raw mode", () => {
    const raw = compose({
      safety: { reasonCodes: ["stale_data"] },
      policyMode: "raw",
    });
    expect(raw.action).toBe("insufficient_data");
    expect(raw.source).toBe("safety");
    expect(raw.reasonCodes).not.toContain(COMPOSER_REASON_CODES.composerBypassed);
  });
});

describe("default (absent policyMode) behavior is unchanged", () => {
  it("guarded vetoes apply and composer_bypassed is never appended", () => {
    const lowConfidence = compose({ providerResult: providerResult({ actionConfidence: 0.5 }) });
    expect(lowConfidence.action).toBe("maintain");
    expect(lowConfidence.source).toBe("composer");
    expect(lowConfidence.reasonCodes).toContain(COMPOSER_REASON_CODES.lowChoiceConfidence);
    expect(lowConfidence.reasonCodes).not.toContain(COMPOSER_REASON_CODES.composerBypassed);

    const zoneCeiling = compose({ metrics: { heartRateZoneDelta: 0.4 } });
    expect(zoneCeiling.action).toBe("maintain");
    expect(zoneCeiling.reasonCodes).toContain(COMPOSER_REASON_CODES.increaseAtHeartRateZoneCeiling);
    expect(zoneCeiling.reasonCodes).not.toContain(COMPOSER_REASON_CODES.composerBypassed);

    const cooldown = compose({
      sample: { second: 100 + PACE_CHANGE_COOLDOWN_SECONDS - 1 },
      providerResult: providerResult({ action: "decrease_gently" }),
      previous: trace({ second: 100, action: "increase_gently" }),
    });
    expect(cooldown.action).toBe("maintain");
    expect(cooldown.reasonCodes).toContain(COMPOSER_REASON_CODES.cooldownNoOppositeChange);
    expect(cooldown.reasonCodes).not.toContain(COMPOSER_REASON_CODES.composerBypassed);
  });

  it("explicit policyMode 'guarded' behaves identically to the absent flag", () => {
    const explicit = compose({
      providerResult: providerResult({ actionConfidence: 0.5 }),
      policyMode: "guarded",
    });
    expect(explicit.action).toBe("maintain");
    expect(explicit.source).toBe("composer");
    expect(explicit.reasonCodes).not.toContain(COMPOSER_REASON_CODES.composerBypassed);
  });
});
