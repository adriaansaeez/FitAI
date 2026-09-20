/**
 * Spec mandatory tests 7, 8 and 10 in pure-function form:
 * - 7: history 0 -> maturity "none" and reduced mock confidence.
 * - 8: history 10 -> baseline computed from comparable sessions only.
 * - 10: provider failure does not intensify and the simulation continues.
 */

import { describe, expect, it } from "vitest";
import { composeDecision, decideSecond } from "../src/domain/composer";
import { decideRequestBodySchema } from "../src/app/api/decide/handler";
import {
  MockDecisionProvider,
  MOCK_CONFIDENCE,
  MOCK_MATURITY_CONFIDENCE_FACTOR,
  decideMockFromContext,
} from "../src/services/mockDecisionProvider";
import type { DecisionProvider, DecideInput, ProviderResult } from "../src/services/provider";
import { SCENARIOS, generateScenarioSamples } from "../src/simulation/scenarios";
import {
  computeBaseline,
  generateAthleteHistory,
  median,
} from "../src/simulation/history";

const SEED = 42;
const HISTORY_SEED = 7;

/** Provider that always proposes a high-confidence, low-risk increase. */
function increaseProvider(): DecisionProvider {
  return {
    async decide(): Promise<ProviderResult> {
      return {
        action: "increase_gently",
        actionConfidence: 0.95,
        disproportionateEffortProbability: 0.05,
        contextExplanation: "normal_variation",
        interpretability: { score: 2, confidence: 0.9, probabilities: {} },
        source: "mock",
      };
    },
  };
}

/** Base context of a safe easy second where an increase would be eligible. */
function safeEasyContext(historyMaturity: string): Record<string, unknown> {
  return {
    block: "easy",
    second: 120,
    paceSecPerKm: 338,
    heartRateBpm: 140,
    gradePct: 0,
    signalQuality: "high",
    dataAgeSeconds: 0,
    rpe: 3,
    paceWindowSecPerKm: 338,
    heartRateWindowBpm: 140,
    hrTrendBpmPerMin: 1,
    paceVsTargetSeconds: 8,
    comparableHistoryCount: 10,
    historicalPaceDeltaSeconds: 8,
    historicalHrDeltaBpm: 0,
    historyMaturity,
    mayIncreaseIntensity: true,
    safetyReasonCodes: [],
  };
}

function failingProvider(fail: () => never): DecisionProvider {
  return {
    async decide(): Promise<ProviderResult> {
      fail();
    },
  };
}

describe("spec test 7: history 0 -> maturity none and reduced confidence", () => {
  it("maps comparable counts to none/early/established maturity", () => {
    expect(generateAthleteHistory(0, HISTORY_SEED).historyMaturity).toBe("none");
    expect(generateAthleteHistory(3, HISTORY_SEED).historyMaturity).toBe("early");
    expect(generateAthleteHistory(10, HISTORY_SEED).historyMaturity).toBe("established");
  });

  it("orders the mock maturity confidence factor none < early < established", () => {
    const factorNone = MOCK_MATURITY_CONFIDENCE_FACTOR["none"] as number;
    const factorEarly = MOCK_MATURITY_CONFIDENCE_FACTOR["early"] as number;
    const factorEstablished = MOCK_MATURITY_CONFIDENCE_FACTOR["established"] as number;
    expect(factorNone).toBeLessThan(factorEarly);
    expect(factorEarly).toBeLessThan(factorEstablished);

    // Identical safe inputs except historyMaturity: confidence scales by factor.
    const none = decideMockFromContext(safeEasyContext("none"));
    const early = decideMockFromContext(safeEasyContext("early"));
    const established = decideMockFromContext(safeEasyContext("established"));

    expect(none.actionConfidence).toBeCloseTo(
      MOCK_CONFIDENCE.maintain * factorNone,
      10,
    );
    expect(early.actionConfidence).toBeCloseTo(
      MOCK_CONFIDENCE.increase * factorEarly,
      10,
    );
    expect(established.actionConfidence).toBeCloseTo(
      MOCK_CONFIDENCE.increase * factorEstablished,
      10,
    );
    expect(none.actionConfidence!).toBeLessThan(early.actionConfidence!);
    expect(early.actionConfidence!).toBeLessThan(established.actionConfidence!);
  });

  it("with maturity none the mock never proposes an increase", () => {
    const result = decideMockFromContext(safeEasyContext("none"));
    expect(result.action).not.toBe("increase_gently");
    // Interpretability confidence is also reduced without history.
    expect(result.interpretability?.confidence).toBeLessThan(
      decideMockFromContext(safeEasyContext("established")).interpretability?.confidence ?? 1,
    );
  });

  it("full pipeline with history 0: maturity none everywhere, no increase, reduced confidence flagged", async () => {
    const samples = generateScenarioSamples("easy-under-target", SEED);
    const history = generateAthleteHistory(0, HISTORY_SEED);
    expect(history.comparableCount).toBe(0);

    const traces = [];
    let previous = null;
    for (let end = 1; end <= samples.length; end += 1) {
      previous = await decideSecond({
        samples: samples.slice(0, end),
        block: SCENARIOS["easy-under-target"].block,
        targetPaceSecPerKm: SCENARIOS["easy-under-target"].targetPaceSecPerKm,
        baseline: history.profile.baseline,
        comparableHistoryCount: history.comparableCount,
        provider: new MockDecisionProvider(),
        previousDecision: previous,
      });
      traces.push(previous);
    }

    expect(traces.map((t) => t.action)).not.toContain("increase_gently");
    expect(traces.every((t) => t.derivedMetrics.historyMaturity === "none")).toBe(true);
    expect(traces.every((t) => t.derivedMetrics.comparableHistoryCount === 0)).toBe(true);
    // Reduced mock confidence falls below the composer's 0.70 threshold.
    expect(
      traces.some((t) => t.reasonCodes.includes("low_choice_confidence")),
    ).toBe(true);
  });
});

describe("spec test 8: history 10 computes the baseline from comparable sessions only", () => {
  it("keeps 7 comparable sessions and 3 distractors out of 10", () => {
    const history = generateAthleteHistory(10, HISTORY_SEED);
    expect(history.profile.sessions).toHaveLength(10);
    expect(history.comparableCount).toBe(7);
    expect(history.comparableSessions).toHaveLength(7);
    // Every distractor is excluded for a documented reason.
    const comparableIds = new Set(history.comparableSessions.map((s) => s.id));
    for (const session of history.profile.sessions) {
      if (!comparableIds.has(session.id)) {
        const comparable =
          session.workoutType === "easy" &&
          session.completedAsPlanned &&
          session.symptomsReported !== true &&
          Math.abs(session.durationSeconds - 1800) <= 600;
        expect(comparable).toBe(false);
      }
    }
  });

  it("baseline equals the median math over comparable sessions only", () => {
    const history = generateAthleteHistory(10, HISTORY_SEED);
    const comparables = history.comparableSessions;

    const medianPace = median(comparables.map((s) => s.averagePaceSecPerKm));
    const medianHr = median(
      comparables
        .map((s) => s.averageHeartRateBpm)
        .filter((v): v is number => v !== undefined),
    );

    expect(history.profile.baseline.typicalEasyPaceSecPerKm).toBe(medianPace);
    expect(history.profile.baseline.typicalEasyHrBpm).toBe(medianHr);
    // Sanity: the baseline really differs from the pooled (comparable +
    // distractor) median, so distractors are provably excluded.
    const pooledPace = median(history.profile.sessions.map((s) => s.averagePaceSecPerKm));
    expect(pooledPace).not.toBe(medianPace);
    // A tempo distractor is far faster than any easy baseline.
    const tempo = history.profile.sessions.find((s) => s.workoutType === "tempo");
    expect(tempo).toBeDefined();
    expect(Math.abs(medianPace! - tempo!.averagePaceSecPerKm)).toBeGreaterThan(10);
  });

  it("historical deltas in the pipeline match pace/HR window minus the comparable median", async () => {
    const samples = generateScenarioSamples("easy-under-target", SEED);
    const history = generateAthleteHistory(10, HISTORY_SEED);
    const medianPace = history.profile.baseline.typicalEasyPaceSecPerKm!;
    const medianHr = history.profile.baseline.typicalEasyHrBpm!;

    const trace = await decideSecond({
      samples: samples.slice(0, 120),
      block: SCENARIOS["easy-under-target"].block,
      targetPaceSecPerKm: SCENARIOS["easy-under-target"].targetPaceSecPerKm,
      baseline: history.profile.baseline,
      comparableHistoryCount: history.comparableCount,
      provider: new MockDecisionProvider(),
    });

    const derived = trace.derivedMetrics;
    expect(derived.historyMaturity).toBe("established");
    expect(derived.paceWindowSecPerKm).not.toBeNull();
    expect(derived.heartRateWindowBpm).not.toBeNull();
    expect(derived.historicalPaceDeltaSeconds).toBeCloseTo(
      derived.paceWindowSecPerKm! - medianPace,
      9,
    );
    expect(derived.historicalHrDeltaBpm).toBeCloseTo(
      derived.heartRateWindowBpm! - medianHr,
      9,
    );
  });

  it("computeBaseline matches the median helper directly", () => {
    const history = generateAthleteHistory(10, HISTORY_SEED);
    expect(computeBaseline(history.comparableSessions)).toEqual(history.profile.baseline);
  });
});

describe("spec test 10: provider failure does not intensify", () => {
  const samples = generateScenarioSamples("easy-under-target", SEED);

  it("a provider that throws degrades to maintain with provider_unavailable", async () => {
    const trace = await decideSecond({
      samples: samples.slice(0, 120),
      block: "easy",
      provider: failingProvider(() => {
        throw new Error("provider exploded");
      }),
    });
    expect(trace.action).toBe("maintain");
    expect(trace.source).toBe("composer");
    expect(trace.reasonCodes).toContain("provider_unavailable");
    expect(trace.action).not.toBe("increase_gently");
  });

  it("a provider promise that rejects degrades to maintain as well", async () => {
    const provider: DecisionProvider = {
      decide(): Promise<ProviderResult> {
        return Promise.reject(new Error("network timeout"));
      },
    };
    const trace = await decideSecond({
      samples: samples.slice(0, 120),
      block: "easy",
      provider,
    });
    expect(trace.action).toBe("maintain");
    expect(trace.reasonCodes).toContain("provider_unavailable");
    expect(trace.action).not.toBe("increase_gently");
  });

  it("the simulation continues after a provider failure", async () => {
    const failing = failingProvider(() => {
      throw new Error("transient failure");
    });
    const failed = await decideSecond({
      samples: samples.slice(0, 120),
      block: "easy",
      provider: failing,
    });
    expect(failed.action).toBe("maintain");

    const recovered = await decideSecond({
      samples: samples.slice(0, 121),
      block: "easy",
      provider: new MockDecisionProvider(),
    });
    expect(recovered.second).toBe(121);
    expect(recovered.action).toBeDefined();
    expect(recovered.action).not.toBe("stop_and_escalate");
    expect(recovered.derivedMetrics.paceWindowSecPerKm).not.toBeNull();
  });

  it("a well-formed provider insufficient_data result passes through the composer", () => {
    const providerResult: ProviderResult = {
      action: "insufficient_data",
      actionConfidence: 0.9,
      contextExplanation: "not_enough_context",
      interpretability: { score: 2, confidence: 0.9, probabilities: {} },
      source: "mock",
    };
    const trace = composeDecision(
      {
        second: 120,
        timestamp: "2025-01-01T00:02:00.000Z",
        paceSecPerKm: 338,
        heartRateBpm: 140,
        distanceM: 5000,
        elevationM: 0,
        gradePct: 0,
        cadenceSpm: 170,
        signalQuality: "high",
        dataAgeSeconds: 0,
        autoPaused: false,
        symptomsReported: false,
      },
      {
        paceWindowSecPerKm: 338,
        heartRateWindowBpm: 140,
        hrTrendBpmPerMin: 1,
        paceVsTargetSeconds: 8,
        comparableHistoryCount: 10,
        historicalPaceDeltaSeconds: 8,
        historicalHrDeltaBpm: 0,
        historyMaturity: "established",
      },
      { hardStop: false, mayIncreaseIntensity: true, missingRequiredMetric: false, reasonCodes: [] },
      providerResult,
      null,
      "easy",
    );
    expect(trace.action).toBe("insufficient_data");
    expect(trace.source).toBe("mock");
    expect(trace.confidence).toBe(0.9);
  });

  it("an absent provider leaves the run in maintain without a failure code", async () => {
    const trace = await decideSecond({
      samples: samples.slice(0, 120),
      block: "easy",
    });
    expect(trace.action).toBe("maintain");
    expect(trace.source).toBe("composer");
    expect(trace.reasonCodes).toContain("provider_unavailable");
  });

  it("a spy confirms decideSecond catches synchronous throws inside decide", async () => {
    const seen: DecideInput[] = [];
    const provider: DecisionProvider = {
      async decide(input: DecideInput): Promise<ProviderResult> {
        seen.push(input);
        throw new Error("boom");
      },
    };
    const trace = await decideSecond({
      samples: samples.slice(0, 120),
      block: "easy",
      provider,
    });
    // The provider WAS called (context delivered) but its failure never intensifies.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.context["block"]).toBe("easy");
    expect(trace.action).toBe("maintain");
    expect(trace.reasonCodes).toContain("provider_unavailable");
  });
});

describe("fail-closed increase guard (Kona 2022): no increase without target/history", () => {
  const samples = generateScenarioSamples("easy-under-target", SEED);
  const target = SCENARIOS["easy-under-target"].targetPaceSecPerKm;

  it("decideSecond denies a provider-proposed increase when no pace target is given", async () => {
    const trace = await decideSecond({
      samples: samples.slice(0, 120),
      block: "easy",
      provider: increaseProvider(),
    });
    expect(trace.action).toBe("maintain");
    expect(trace.source).toBe("composer");
    expect(trace.reasonCodes).toContain("increase_without_target");
  });

  it("decideSecond denies the increase with a target but zero comparable history", async () => {
    const trace = await decideSecond({
      samples: samples.slice(0, 120),
      block: "easy",
      targetPaceSecPerKm: target,
      comparableHistoryCount: 0,
      provider: increaseProvider(),
    });
    expect(trace.action).toBe("maintain");
    expect(trace.reasonCodes).toContain("increase_without_target");
  });

  it("decideSecond allows the increase with a target and comparable history", async () => {
    const trace = await decideSecond({
      samples: samples.slice(0, 120),
      block: "easy",
      targetPaceSecPerKm: target,
      comparableHistoryCount: 1,
      provider: increaseProvider(),
    });
    expect(trace.action).toBe("increase_gently");
    expect(trace.reasonCodes).not.toContain("increase_without_target");
  });

  it("the decide request schema accepts a body without paceTargetSecPerKm", () => {
    const parsed = decideRequestBodySchema.safeParse({
      sample: samples[samples.length - 1],
      block: "easy",
      recentSamples: [],
      historyCount: 5,
      previousDecision: null,
      callJev: false,
    });
    expect(parsed.success).toBe(true);
  });
});
