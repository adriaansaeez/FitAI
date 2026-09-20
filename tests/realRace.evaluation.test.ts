import { describe, expect, it } from "vitest";
import { evaluateDecisionAgainstObserved } from "../src/domain/evaluation";
import type { RaceDecisionEvaluation } from "../src/domain/evaluation";
import type { DecisionAction, DecisionTrace, RunningSample } from "../src/domain/types";

/** Minimal valid trace: only action/reasonCodes/confidence are consumed. */
function makeTrace(action: DecisionAction, confidence?: number): DecisionTrace {
  return {
    second: 1,
    action,
    source: "composer",
    ...(confidence !== undefined ? { confidence } : {}),
    reasonCodes: ["test_reason"],
    explanationKey: "decision.test",
    derivedMetrics: {
      paceWindowSecPerKm: null,
      heartRateWindowBpm: null,
      hrTrendBpmPerMin: null,
      paceVsTargetSeconds: null,
      comparableHistoryCount: 0,
      historicalPaceDeltaSeconds: null,
      historicalHrDeltaBpm: null,
      historyMaturity: "none",
    },
    safety: {
      hardStop: false,
      mayIncreaseIntensity: false,
      missingRequiredMetric: false,
      reasonCodes: [],
    },
  };
}

function makeSample(second: number, overrides: Partial<RunningSample> = {}): RunningSample {
  return {
    second,
    timestamp: `2022-10-08T21:30:07.000Z`,
    paceSecPerKm: 300,
    heartRateBpm: 150,
    distanceM: second * 3,
    elevationM: 0,
    gradePct: 0,
    cadenceSpm: 85,
    signalQuality: "high",
    dataAgeSeconds: 0,
    autoPaused: false,
    symptomsReported: false,
    ...overrides,
  };
}

/** Contiguous samples 1..count with pace/HR/elevation/grade derived from second. */
function makeSeries(
  count: number,
  overrides?: (second: number) => Partial<RunningSample>,
): RunningSample[] {
  return Array.from({ length: count }, (_, i) =>
    makeSample(i + 1, overrides?.(i + 1)),
  );
}

describe("evaluateDecisionAgainstObserved windows", () => {
  // pace = 300 + second, HR = 100 + second, so every window mean is exact.
  const samples = makeSeries(200, (second) => ({
    paceSecPerKm: 300 + second,
    heartRateBpm: 100 + second,
  }));

  it("computes the next 60 s and 90 s windows strictly after the decision second", () => {
    const evaluation = evaluateDecisionAgainstObserved(makeTrace("maintain"), samples, 10);
    // 60 s window: seconds 11..70 → pace (311+370)/2, HR (111+170)/2.
    expect(evaluation.observedNext60s?.meanPaceSecPerKm).toBeCloseTo((311 + 370) / 2, 10);
    expect(evaluation.observedNext60s?.meanHeartRateBpm).toBeCloseTo((111 + 170) / 2, 10);
    // 90 s window: seconds 11..100 → pace (311+400)/2, HR (111+200)/2.
    expect(evaluation.observedNext90s?.meanPaceSecPerKm).toBeCloseTo((311 + 400) / 2, 10);
    expect(evaluation.observedNext90s?.meanHeartRateBpm).toBeCloseTo((111 + 200) / 2, 10);
  });

  it("returns null windows when fewer than half the window seconds are available", () => {
    // 100 samples; decision at 75 → only 25 s remain (< 30 and < 45).
    const short = samples.slice(0, 100);
    const evaluation = evaluateDecisionAgainstObserved(makeTrace("maintain"), short, 75);
    expect(evaluation.observedNext60s).toBeNull();
    expect(evaluation.observedNext90s).toBeNull();
  });

  it("keeps windows available exactly at the half-window boundary", () => {
    // Decision at 55 of 100 → 45 s remain: 60 s window (45 ≥ 30) present,
    // 90 s window (45 ≥ 45, boundary inclusive) present.
    const short = samples.slice(0, 100);
    const atBoundary = evaluateDecisionAgainstObserved(makeTrace("maintain"), short, 55);
    expect(atBoundary.observedNext60s).not.toBeNull();
    expect(atBoundary.observedNext90s).not.toBeNull();
    // 90 s window covers seconds 56..100 → pace (356+400)/2.
    expect(atBoundary.observedNext90s?.meanPaceSecPerKm).toBeCloseTo((356 + 400) / 2, 10);

    // Decision at 56 → 44 s remain: 60 s window still present, 90 s window null.
    const justBelow = evaluateDecisionAgainstObserved(makeTrace("maintain"), short, 56);
    expect(justBelow.observedNext60s).not.toBeNull();
    expect(justBelow.observedNext90s).toBeNull();
  });
});

describe("evaluateDecisionAgainstObserved null handling", () => {
  it("averages only non-null pace and HR values inside the window", () => {
    const samples = makeSeries(100, (second) => ({
      paceSecPerKm: second % 2 === 0 ? null : 300 + second,
      heartRateBpm: second % 3 === 0 ? null : 100 + second,
    }));
    const evaluation = evaluateDecisionAgainstObserved(makeTrace("maintain"), samples, 10);
    // Odd seconds 11..69 carry pace → mean 300 + (11+69)/2 = 340.
    expect(evaluation.observedNext60s?.meanPaceSecPerKm).toBeCloseTo(340, 10);
    // Seconds 11..70 minus multiples of 3: mean of 100 + s = 140.5.
    expect(evaluation.observedNext60s?.meanHeartRateBpm).toBeCloseTo(140.5, 10);
  });

  it("returns null means when the window has no usable values at all", () => {
    const samples = makeSeries(100, () => ({ paceSecPerKm: null, heartRateBpm: null }));
    const evaluation = evaluateDecisionAgainstObserved(makeTrace("maintain"), samples, 10);
    expect(evaluation.observedNext60s).not.toBeNull();
    expect(evaluation.observedNext60s?.meanPaceSecPerKm).toBeNull();
    expect(evaluation.observedNext60s?.meanHeartRateBpm).toBeNull();
    expect(evaluation.observedNext60s?.hrTrendBpmPerMin).toBeNull();
  });

  it("returns a null HR trend with fewer than two HR points and a per-minute slope otherwise", () => {
    const singlePoint = makeSeries(100, (second) => ({
      heartRateBpm: second === 11 ? 120 : null,
    }));
    const one = evaluateDecisionAgainstObserved(makeTrace("maintain"), singlePoint, 10);
    expect(one.observedNext60s?.hrTrendBpmPerMin).toBeNull();

    // 1 bpm/s over the first two window points → 60 bpm/min.
    const twoPoints = makeSeries(100, (second) => ({
      heartRateBpm: second === 11 ? 120 : second === 12 ? 121 : null,
    }));
    const two = evaluateDecisionAgainstObserved(makeTrace("maintain"), twoPoints, 10);
    expect(two.observedNext60s?.hrTrendBpmPerMin).toBeCloseTo(60, 10);
  });
});

describe("evaluateDecisionAgainstObserved terrain", () => {
  it("measures elevation delta to the last sample within 90 s and the mean grade of that span", () => {
    // Elevation rises 0.5 m/s, grade 25 % after the decision second.
    const samples = makeSeries(200, (second) => ({
      elevationM: second <= 10 ? 100 : 100 + (second - 10) * 0.5,
      gradePct: second <= 10 ? 0 : 25,
    }));
    const evaluation = evaluateDecisionAgainstObserved(makeTrace("maintain"), samples, 10);
    // Last sample in the 90 s span: second 100 → 100 + 90 * 0.5 = 145 m.
    expect(evaluation.terrainDelta.elevationDeltaM).toBeCloseTo(45, 10);
    expect(evaluation.terrainDelta.meanGradePct).toBeCloseTo(25, 10);
  });

  it("computes terrain from the last available sample even when the 90 s window is short", () => {
    const samples = makeSeries(100, (second) => ({
      elevationM: 200 + second,
      gradePct: 3,
    }));
    // Decision at 80 → only 20 s remain: observed windows stay null (20 < 45),
    // but terrain still measures to the last available sample (second 100).
    const evaluation = evaluateDecisionAgainstObserved(makeTrace("maintain"), samples, 80);
    expect(evaluation.observedNext90s).toBeNull();
    expect(evaluation.terrainDelta.elevationDeltaM).toBeCloseTo(20, 10);
    expect(evaluation.terrainDelta.meanGradePct).toBeCloseTo(3, 10);
  });

  it("returns null terrain when no sample follows the decision", () => {
    const samples = makeSeries(100, (second) => ({ elevationM: 100 + second }));
    const evaluation = evaluateDecisionAgainstObserved(makeTrace("maintain"), samples, 100);
    expect(evaluation.terrainDelta).toEqual({ elevationDeltaM: null, meanGradePct: null });
  });
});

describe("evaluateDecisionAgainstObserved decision fields and determinism", () => {
  it("copies action, reasonCodes and confidence without back-references", () => {
    const trace = makeTrace("increase_gently", 0.7);
    const evaluation: RaceDecisionEvaluation = evaluateDecisionAgainstObserved(
      trace,
      makeSeries(100),
      5,
    );
    expect(evaluation.decisionSecond).toBe(5);
    expect(evaluation.action).toBe("increase_gently");
    expect(evaluation.reasonCodes).toEqual(["test_reason"]);
    expect(evaluation.confidence).toBe(0.7);
    // Mutating the result never touches the trace.
    evaluation.reasonCodes.push("mutated");
    expect(trace.reasonCodes).toEqual(["test_reason"]);
  });

  it("maps an undefined confidence to null", () => {
    const evaluation = evaluateDecisionAgainstObserved(makeTrace("maintain"), makeSeries(100), 5);
    expect(evaluation.confidence).toBeNull();
  });

  it("is deterministic for identical inputs", () => {
    const samples = makeSeries(100);
    const a = evaluateDecisionAgainstObserved(makeTrace("maintain", 0.8), samples, 10);
    const b = evaluateDecisionAgainstObserved(makeTrace("maintain", 0.8), samples, 10);
    expect(a).toEqual(b);
  });
});
