/**
 * Spec mandatory test 9 (cooldown) in pure-function form, plus composer guard
 * edges (null provider result, low confidence, low interpretability,
 * disproportionate effort, non-easy blocks, recover hold) and the Spanish
 * message template integration.
 */

import { describe, expect, it } from "vitest";
import {
  COMPOSER_REASON_CODES,
  PACE_CHANGE_COOLDOWN_SECONDS,
  RECOVER_REEVALUATION_SECONDS,
  buildDecisionContext,
  composeDecision,
} from "../src/domain/composer";
import { evaluateSafety } from "../src/domain/safety";
import type { ProviderResult } from "../src/services/provider";
import type {
  DecisionTrace,
  DerivedMetrics,
  RunningSample,
  SafetyResult,
  TrainingBlock,
} from "../src/domain/types";
import {
  DECISION_MESSAGE_TEMPLATES,
  renderDecisionMessage,
  resolveDecisionMessageKey,
} from "../src/domain/messageTemplates";

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

function compose(overrides: {
  sample?: Partial<RunningSample>;
  metrics?: Partial<DerivedMetrics>;
  safety?: Partial<SafetyResult>;
  providerResult?: ProviderResult | null;
  previous?: DecisionTrace | null;
  block?: TrainingBlock;
}): DecisionTrace {
  return composeDecision(
    sample(overrides.sample ?? {}),
    metrics(overrides.metrics ?? {}),
    cleanSafety(overrides.safety ?? {}),
    overrides.providerResult !== undefined ? overrides.providerResult : providerResult(),
    overrides.previous !== undefined ? overrides.previous : null,
    overrides.block ?? "easy",
  );
}

describe("spec test 9: cooldown blocks immediate opposite changes", () => {
  it("exposes the 60 s cooldown constant from the spec", () => {
    expect(PACE_CHANGE_COOLDOWN_SECONDS).toBe(60);
  });

  it("decrease proposed within 60 s of an increase is downgraded to maintain by safety", () => {
    const previous = trace({ second: 100, action: "increase_gently" });
    const result = compose({
      sample: { second: 100 + PACE_CHANGE_COOLDOWN_SECONDS - 1 },
      providerResult: providerResult({ action: "decrease_gently" }),
      previous,
    });
    expect(result.action).toBe("maintain");
    expect(result.source).toBe("safety");
    expect(result.reasonCodes).toContain(COMPOSER_REASON_CODES.cooldownNoOppositeChange);
    expect(result.explanationKey).toBe(
      `decision.maintain.${COMPOSER_REASON_CODES.cooldownNoOppositeChange}`,
    );
  });

  it("increase proposed within 60 s of a decrease is downgraded to maintain by safety", () => {
    const previous = trace({ second: 100, action: "decrease_gently" });
    const result = compose({
      sample: { second: 100 + PACE_CHANGE_COOLDOWN_SECONDS - 1 },
      providerResult: providerResult({ action: "increase_gently" }),
      previous,
    });
    expect(result.action).toBe("maintain");
    expect(result.source).toBe("safety");
    expect(result.reasonCodes).toContain(COMPOSER_REASON_CODES.cooldownNoOppositeChange);
  });

  it("after the cooldown window the opposite change goes through", () => {
    const previous = trace({ second: 100, action: "increase_gently" });
    const result = compose({
      sample: { second: 100 + PACE_CHANGE_COOLDOWN_SECONDS },
      providerResult: providerResult({ action: "decrease_gently" }),
      previous,
    });
    expect(result.action).toBe("decrease_gently");
    expect(result.reasonCodes).not.toContain(COMPOSER_REASON_CODES.cooldownNoOppositeChange);
    expect(result.reasonCodes).toContain(COMPOSER_REASON_CODES.decreaseAdjustmentLimited);
  });

  it("the same action as the previous decision is not blocked by the cooldown", () => {
    const previous = trace({ second: 100, action: "increase_gently" });
    const result = compose({
      sample: { second: 130 },
      providerResult: providerResult({ action: "increase_gently" }),
      previous,
    });
    expect(result.action).toBe("increase_gently");
    expect(result.reasonCodes).not.toContain(COMPOSER_REASON_CODES.cooldownNoOppositeChange);
  });

  it("maintain proposals are never cooldown-blocked", () => {
    const previous = trace({ second: 100, action: "increase_gently" });
    const result = compose({
      sample: { second: 130 },
      providerResult: providerResult({ action: "maintain" }),
      previous,
    });
    expect(result.action).toBe("maintain");
    expect(result.source).toBe("mock");
  });

  it("no previous decision means no cooldown", () => {
    const result = compose({
      providerResult: providerResult({ action: "decrease_gently" }),
      previous: null,
    });
    expect(result.action).toBe("decrease_gently");
  });
});

describe("composer guard edges", () => {
  it("hardStop yields stop_and_escalate from safety regardless of the provider result", () => {
    const safety = evaluateSafety(sample({ symptomsReported: true }), metrics(), "easy");
    const result = composeDecision(
      sample({ symptomsReported: true }),
      metrics(),
      safety,
      providerResult({ action: "increase_gently" }),
      null,
      "easy",
    );
    expect(result.action).toBe("stop_and_escalate");
    expect(result.source).toBe("safety");
    expect(result.confidence).toBe(1);
    expect(result.reasonCodes).toContain("symptoms_reported");
  });

  it("null provider result degrades to maintain with provider_unavailable; run continues", () => {
    const result = compose({ providerResult: null });
    expect(result.action).toBe("maintain");
    expect(result.source).toBe("composer");
    expect(result.reasonCodes).toContain(COMPOSER_REASON_CODES.providerUnavailable);
  });

  it("choice confidence below 0.70 forces maintain", () => {
    const result = compose({
      providerResult: providerResult({ actionConfidence: 0.69 }),
    });
    expect(result.action).toBe("maintain");
    expect(result.source).toBe("composer");
    expect(result.reasonCodes).toContain(COMPOSER_REASON_CODES.lowChoiceConfidence);
  });

  it("a missing choice confidence forces maintain with a dedicated reason", () => {
    const result = compose({
      providerResult: providerResult({ actionConfidence: undefined }),
    });
    expect(result.action).toBe("maintain");
    expect(result.reasonCodes).toContain(COMPOSER_REASON_CODES.choiceConfidenceMissing);
  });

  it("interpretability below thresholds forces maintain", () => {
    const lowScore = compose({
      providerResult: providerResult({
        interpretability: { score: 1.3, confidence: 0.9, probabilities: {} },
      }),
    });
    expect(lowScore.action).toBe("maintain");
    expect(lowScore.reasonCodes).toContain(COMPOSER_REASON_CODES.lowInterpretability);

    const lowConfidence = compose({
      providerResult: providerResult({
        interpretability: { score: 2, confidence: 0.74, probabilities: {} },
      }),
    });
    expect(lowConfidence.action).toBe("maintain");
    expect(lowConfidence.reasonCodes).toContain(COMPOSER_REASON_CODES.lowInterpretability);

    const missing = compose({
      providerResult: providerResult({ interpretability: undefined }),
    });
    expect(missing.action).toBe("maintain");
    expect(missing.reasonCodes).toContain(COMPOSER_REASON_CODES.lowInterpretability);
  });

  it("disproportionate effort probability at or above 0.30 blocks increases", () => {
    const result = compose({
      providerResult: providerResult({ disproportionateEffortProbability: 0.3 }),
    });
    expect(result.action).toBe("maintain");
    expect(result.reasonCodes).toContain(COMPOSER_REASON_CODES.disproportionateEffortRisk);
  });

  it("increases outside the easy block are denied", () => {
    const tempo = compose({ block: "tempo" });
    expect(tempo.action).toBe("maintain");
    expect(tempo.reasonCodes).toContain(COMPOSER_REASON_CODES.increaseNotEasyBlock);

    // Missing block is treated conservatively: no increase.
    const noBlock = composeDecision(
      sample(),
      metrics(),
      cleanSafety(),
      providerResult(),
      null,
    );
    expect(noBlock.action).toBe("maintain");
    expect(noBlock.reasonCodes).toContain(COMPOSER_REASON_CODES.increaseBlockedBySafety);
  });

  it("a valid increase is marked as limited to 5-10 s/km and keeps provider data", () => {
    const result = compose({});
    expect(result.action).toBe("increase_gently");
    expect(result.source).toBe("mock");
    expect(result.confidence).toBe(0.9);
    expect(result.reasonCodes).toContain(COMPOSER_REASON_CODES.increaseAdjustmentLimited);
    expect(result.probabilities).toEqual({ "1": 1 });
  });

  it("a valid decrease is marked as limited to 5-15 s/km", () => {
    const result = compose({
      providerResult: providerResult({
        action: "decrease_gently",
        disproportionateEffortProbability: 0.55,
      }),
    });
    expect(result.action).toBe("decrease_gently");
    expect(result.reasonCodes).toContain(COMPOSER_REASON_CODES.decreaseAdjustmentLimited);
  });

  it("a recover decision stands until the 90 s re-evaluation window", () => {
    expect(RECOVER_REEVALUATION_SECONDS).toBe(90);
    const previous = trace({ second: 100, action: "recover", confidence: 0.86 });

    const held = compose({
      sample: { second: 150 },
      providerResult: providerResult({ action: "maintain" }),
      previous,
    });
    expect(held.action).toBe("recover");
    expect(held.source).toBe("composer");
    expect(held.reasonCodes).toContain(COMPOSER_REASON_CODES.recoverReevaluationPending);

    const reevaluated = compose({
      sample: { second: 100 + RECOVER_REEVALUATION_SECONDS },
      providerResult: providerResult({ action: "maintain" }),
      previous,
    });
    expect(reevaluated.action).toBe("maintain");
    expect(reevaluated.reasonCodes).not.toContain(COMPOSER_REASON_CODES.recoverReevaluationPending);
  });

  it("degraded safety codes make the composer return insufficient_data even with a good provider", () => {
    const safety = evaluateSafety(sample({ signalQuality: "low" }), metrics(), "easy");
    const result = composeDecision(
      sample({ signalQuality: "low" }),
      metrics(),
      safety,
      providerResult({ action: "increase_gently" }),
      null,
      "easy",
    );
    expect(result.action).toBe("insufficient_data");
    expect(result.source).toBe("safety");
    expect(result.reasonCodes).toContain(COMPOSER_REASON_CODES.lowSignalQuality);
  });
});

describe("message template integration", () => {
  it("every explanationKey emitted by composeDecision resolves to a Spanish template", () => {
    const cases: DecisionTrace[] = [
      compose({ providerResult: providerResult({ action: "decrease_gently" }), previous: trace({ second: -1000, action: "increase_gently" }) }),
      compose({}),
      compose({ sample: { second: 130 }, providerResult: providerResult({ action: "maintain" }) }),
      compose({ providerResult: null }),
      compose({ providerResult: providerResult({ actionConfidence: 0.5 }) }),
      compose({
        sample: { second: 100 + PACE_CHANGE_COOLDOWN_SECONDS - 1, symptomsReported: true },
        safety: { hardStop: true, mayIncreaseIntensity: false, reasonCodes: ["symptoms_reported"] },
      }),
    ];
    for (const result of cases) {
      const resolved = resolveDecisionMessageKey(result.action, primaryReasonOf(result));
      expect(DECISION_MESSAGE_TEMPLATES[resolved]).toBeDefined();
      expect(resolved).toBe(result.explanationKey);
    }
  });

  it("renders placeholders and falls back for unknown reasons", () => {
    expect(
      renderDecisionMessage("decision.increase_gently", { increaseSecPerKm: 8 }),
    ).toContain("8 s/km");
    expect(
      renderDecisionMessage("decision.increase_gently.increase_adjustment_limited_5_10_sec_per_km"),
    ).toContain("5 y 10 s/km");
    expect(resolveDecisionMessageKey("maintain", "unknown_reason")).toBe("decision.maintain");
    expect(renderDecisionMessage("decision.unknown_key")).toBe("decision.unknown_key");
  });
});

describe("buildDecisionContext", () => {
  it("includes targetPaceSecPerKm when provided and leaves it undefined when omitted", () => {
    const target = { min: 320, max: 340 };
    const withTarget = buildDecisionContext(sample(), metrics(), evaluateSafety(sample(), metrics(), "easy"), "easy", target);
    expect(withTarget.targetPaceSecPerKm).toBe(target);

    const withoutTarget = buildDecisionContext(sample(), metrics(), evaluateSafety(sample(), metrics(), "easy"), "easy");
    expect(withoutTarget.targetPaceSecPerKm).toBeUndefined();
  });
});

function primaryReasonOf(result: DecisionTrace): string | null {
  return result.reasonCodes[result.reasonCodes.length - 1] ?? null;
}
