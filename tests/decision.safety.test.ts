/**
 * Spec mandatory tests 2 and 3 (pure-function form) plus cheap safety edges:
 * - 2: a reported symptom produces stop_and_escalate and never calls a provider.
 * - 3: low signal, stale data and auto-pause never produce increase_gently.
 */

import { describe, expect, it } from "vitest";
import { evaluateSafety, SAFETY_REASON_CODES, MAX_STALE_DATA_SECONDS } from "../src/domain/safety";
import { decideSecond } from "../src/domain/composer";
import type { DecisionProvider, DecideInput, ProviderResult } from "../src/services/provider";
import type { DerivedMetrics, RunningSample, TrainingBlock } from "../src/domain/types";
import { generateScenarioSamples } from "../src/simulation/scenarios";

function sample(overrides: Partial<RunningSample> = {}): RunningSample {
  return {
    second: 100,
    timestamp: "2025-01-01T00:01:40.000Z",
    paceSecPerKm: 330,
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
    comparableHistoryCount: 0,
    historicalPaceDeltaSeconds: null,
    historicalHrDeltaBpm: null,
    historyMaturity: "none",
    ...overrides,
  };
}

/** Provider that records any invocation and fails loudly if called. */
function spyProvider(): { provider: DecisionProvider; callCount: () => number } {
  const state = { calls: 0 };
  const provider: DecisionProvider = {
    async decide(_input: DecideInput): Promise<ProviderResult> {
      state.calls += 1;
      throw new Error("spy: provider must never be called");
    },
  };
  return { provider, callCount: () => state.calls };
}

describe("spec test 2: reported symptom stops and escalates without calling the provider", () => {
  it("evaluateSafety marks a symptomsReported sample as hardStop", () => {
    const safety = evaluateSafety(sample({ symptomsReported: true }), metrics(), "easy");
    expect(safety.hardStop).toBe(true);
    expect(safety.mayIncreaseIntensity).toBe(false);
    expect(safety.reasonCodes).toContain(SAFETY_REASON_CODES.symptomsReported);
  });

  it("decideSecond returns stop_and_escalate from safety and never invokes the provider", async () => {
    // Real scenario sample at the symptom second (360) of symptom-stop.
    const samples = generateScenarioSamples("symptom-stop", 42, { durationSeconds: 360 });
    const current = samples[samples.length - 1];
    if (current === undefined) throw new Error("expected samples");
    expect(current.second).toBe(360);
    expect(current.symptomsReported).toBe(true);
    const spy = spyProvider();

    const trace = await decideSecond({
      samples,
      block: "easy",
      provider: spy.provider,
    });

    expect(trace.action).toBe("stop_and_escalate");
    expect(trace.source).toBe("safety");
    expect(trace.confidence).toBe(1);
    expect(trace.reasonCodes).toContain(SAFETY_REASON_CODES.symptomsReported);
    expect(spy.callCount()).toBe(0);
  });

  it("hardStop dominates even when safety would otherwise allow an increase", () => {
    const safety = evaluateSafety(sample({ symptomsReported: true }), metrics(), "easy");
    expect(safety.hardStop).toBe(true);
    // mayIncreaseIntensity must be false even with clean data on an easy block.
    expect(safety.mayIncreaseIntensity).toBe(false);
  });
});

describe("spec test 3: degraded data never yields increase_gently", () => {
  const degradedCases: Array<{
    name: string;
    overrides: Partial<RunningSample>;
    reasonCode: string;
  }> = [
    {
      name: 'signalQuality "low"',
      overrides: { signalQuality: "low" },
      reasonCode: SAFETY_REASON_CODES.lowSignalQuality,
    },
    {
      name: `dataAgeSeconds > ${MAX_STALE_DATA_SECONDS}`,
      overrides: { dataAgeSeconds: MAX_STALE_DATA_SECONDS + 1 },
      reasonCode: SAFETY_REASON_CODES.staleData,
    },
    {
      name: "autoPaused",
      overrides: { autoPaused: true },
      reasonCode: SAFETY_REASON_CODES.autoPaused,
    },
  ];

  it.each(degradedCases)("$name: safety blocks increases and populates reasonCodes", ({ overrides, reasonCode }) => {
    const safety = evaluateSafety(sample(overrides), metrics(), "easy");
    expect(safety.hardStop).toBe(false);
    expect(safety.mayIncreaseIntensity).toBe(false);
    expect(safety.missingRequiredMetric).toBe(false);
    expect(safety.reasonCodes).toContain(reasonCode);
    expect(safety.reasonCodes.length).toBeGreaterThan(0);
  });

  it.each(degradedCases)("$name: full decideSecond pipeline never returns increase_gently", async ({ overrides }) => {
    const spy = spyProvider();
    const trace = await decideSecond({
      samples: [sample(overrides)],
      block: "easy",
      provider: spy.provider,
    });
    // The provider is never even needed for degraded data.
    expect(spy.callCount()).toBe(0);
    expect(trace.action).not.toBe("increase_gently");
    // Composer turns degraded data into explicit insufficient_data from safety.
    expect(trace.action).toBe("insufficient_data");
    expect(trace.source).toBe("safety");
    expect(trace.reasonCodes.length).toBeGreaterThan(0);
  });

  it("boundary: data aged exactly 15 s is still fresh", () => {
    const safety = evaluateSafety(sample({ dataAgeSeconds: MAX_STALE_DATA_SECONDS }), metrics(), "easy");
    expect(safety.reasonCodes).not.toContain(SAFETY_REASON_CODES.staleData);
    expect(safety.mayIncreaseIntensity).toBe(true);
  });
});

describe("cheap safety edges", () => {
  it("missing both pace and heart rate is a missing required metric", async () => {
    const blank = sample({ paceSecPerKm: null, heartRateBpm: null, cadenceSpm: null });
    const safety = evaluateSafety(blank, metrics({ paceWindowSecPerKm: null, heartRateWindowBpm: null }), "easy");
    expect(safety.missingRequiredMetric).toBe(true);
    expect(safety.mayIncreaseIntensity).toBe(false);
    expect(safety.reasonCodes).toContain(SAFETY_REASON_CODES.missingRequiredMetrics);

    const trace = await decideSecond({ samples: [blank], block: "easy" });
    expect(trace.action).toBe("insufficient_data");
  });

  it.each<TrainingBlock>(["warmup", "recovery"])("%s block sets mayIncreaseIntensity false", (block) => {
    const safety = evaluateSafety(sample(), metrics(), block);
    expect(safety.mayIncreaseIntensity).toBe(false);
    expect(safety.reasonCodes).toContain(SAFETY_REASON_CODES.noIncreaseInBlock);
  });

  it("clean fresh data on an easy block allows increases", () => {
    const safety = evaluateSafety(sample(), metrics(), "easy");
    expect(safety.hardStop).toBe(false);
    expect(safety.missingRequiredMetric).toBe(false);
    expect(safety.mayIncreaseIntensity).toBe(true);
    expect(safety.reasonCodes).toEqual([]);
  });

  it("stale-data guard matches the metrics freshness constant", () => {
    expect(MAX_STALE_DATA_SECONDS).toBe(15);
  });
});
