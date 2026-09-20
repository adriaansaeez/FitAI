import { describe, expect, it } from "vitest";
import {
  HR_WINDOW_SECONDS,
  PACE_WINDOW_SECONDS,
  accumulateDistance,
  computeDerivedMetrics,
  gradeFromElevation,
  isSignalFresh,
  linearSlopePerMinute,
  paceVsTargetSeconds,
  windowAverage,
} from "../src/domain/metrics";
import { generateScenarioSamples } from "../src/simulation/scenarios";
import { generateAthleteHistory } from "../src/simulation/history";
import type { RunningSample } from "../src/domain/types";

describe("window smoothing", () => {
  it("uses windows inside the spec ranges (pace 30-60 s, HR 60-90 s)", () => {
    expect(PACE_WINDOW_SECONDS).toBeGreaterThanOrEqual(30);
    expect(PACE_WINDOW_SECONDS).toBeLessThanOrEqual(60);
    expect(HR_WINDOW_SECONDS).toBeGreaterThanOrEqual(60);
    expect(HR_WINDOW_SECONDS).toBeLessThanOrEqual(90);
  });

  it("averages the last N non-null values", () => {
    const values = [10, 20, 30, 40, 50];
    expect(windowAverage(values, 3)).toBe(40);
    expect(windowAverage(values, 5)).toBe(30);
  });

  it("ignores nulls and returns null when the window has no data", () => {
    expect(windowAverage([10, null, 30], 3)).toBe(20);
    expect(windowAverage([null, null, null], 3)).toBeNull();
    expect(windowAverage([], 30)).toBeNull();
  });

  it("respects the window size when values are longer", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    // Last 45 values are 56..100, mean = 78.
    expect(windowAverage(values, 45)).toBe(78);
  });
});

describe("hrTrend linear regression", () => {
  it("returns the slope in bpm per minute for a linear rise", () => {
    // +1 bpm every 10 s -> +6 bpm/min.
    const values = Array.from({ length: 75 }, (_, i) => 130 + Math.floor(i / 10));
    const slope = linearSlopePerMinute(values, 75);
    expect(slope).not.toBeNull();
    expect(slope as number).toBeCloseTo(6, 0);
  });

  it("returns approximately zero for a flat series", () => {
    const values = Array.from({ length: 75 }, () => 140);
    const slope = linearSlopePerMinute(values, 75);
    expect(splineZero(slope)).toBe(true);
  });

  it("returns null when fewer than two points exist", () => {
    expect(linearSlopePerMinute([140], 75)).toBeNull();
    expect(linearSlopePerMinute([null, null], 75)).toBeNull();
  });
});

function splineZero(value: number | null): boolean {
  return value !== null && Math.abs(value) < 0.5;
}

describe("paceVsTargetSeconds", () => {
  const target = { min: 300, max: 320 };

  it("is positive when slower than the target range", () => {
    expect(paceVsTargetSeconds(335, target)).toBe(15);
  });

  it("is negative when faster than the target range", () => {
    expect(paceVsTargetSeconds(290, target)).toBe(-10);
  });

  it("is zero inside the range and null without pace or target", () => {
    expect(paceVsTargetSeconds(310, target)).toBe(0);
    expect(paceVsTargetSeconds(null, target)).toBeNull();
    expect(paceVsTargetSeconds(310, undefined)).toBeNull();
  });
});

describe("distance and grade", () => {
  it("accumulates distance by integrating pace (300 s/km -> ~3.33 m per second)", () => {
    const cumulative = accumulateDistance([300, 300, 300, 300]);
    expect(cumulative[0]).toBeCloseTo(3.33, 2);
    expect(cumulative[1]).toBeCloseTo(6.67, 2);
    expect(cumulative[2]).toBeCloseTo(10, 2);
    expect(cumulative[3]).toBeCloseTo(13.33, 2);
  });

  it("holds distance on null pace seconds", () => {
    const cumulative = accumulateDistance([300, null, 300]);
    expect(cumulative[0]).toBeCloseTo(3.33, 2);
    expect(cumulative[1]).toBeCloseTo(3.33, 2);
    expect(cumulative[2]).toBeCloseTo(6.67, 2);
  });

  it("derives grade from elevation and horizontal distance", () => {
    expect(gradeFromElevation(10, 200)).toBeCloseTo(5, 6);
    expect(gradeFromElevation(-5, 200)).toBeCloseTo(-2.5, 6);
    expect(gradeFromElevation(1, 0)).toBe(0);
  });
});

describe("signal freshness", () => {
  it("marks data older than 15 s as stale", () => {
    expect(isSignalFresh(0)).toBe(true);
    expect(isSignalFresh(15)).toBe(true);
    expect(isSignalFresh(16)).toBe(false);
  });
});

describe("computeDerivedMetrics", () => {
  const baseline = {
    typicalEasyPaceSecPerKm: 330,
    typicalEasyHrBpm: 140,
    typicalEasyRpe: 3,
  };
  const target = SCENARIOS_TARGET["easy-under-target"];

  it("computes windowed metrics and historical deltas on scenario output", () => {
    const samples = generateScenarioSamples("easy-under-target", 42);
    const metrics = computeDerivedMetrics({
      samples,
      second: 600,
      targetPaceSecPerKm: target,
      baseline,
      comparableHistoryCount: 7,
    });
    const lastSample = samples[samples.length - 1] as RunningSample;
    expect(metrics.paceWindowSecPerKm).not.toBeNull();
    expect(metrics.heartRateWindowBpm).not.toBeNull();
    expect(metrics.hrTrendBpmPerMin).not.toBeNull();
    expect(metrics.paceVsTargetSeconds).not.toBeNull();
    expect(metrics.paceVsTargetSeconds as number).toBeGreaterThan(0);
    expect(metrics.comparableHistoryCount).toBe(7);
    expect(metrics.historyMaturity).toBe("established");
    expect(metrics.historicalPaceDeltaSeconds).toBeCloseTo(
      (metrics.paceWindowSecPerKm as number) - 330,
      6,
    );
    expect(metrics.historicalHrDeltaBpm).toBeCloseTo(
      (metrics.heartRateWindowBpm as number) - 140,
      6,
    );
    expect(lastSample.second).toBe(600);
  });

  it("re-derives historyMaturity from the comparable count", () => {
    const samples = generateScenarioSamples("easy-under-target", 42);
    expect(
      computeDerivedMetrics({ samples, second: 600, comparableHistoryCount: 0 })
        .historyMaturity,
    ).toBe("none");
    expect(
      computeDerivedMetrics({ samples, second: 600, comparableHistoryCount: 2 })
        .historyMaturity,
    ).toBe("early");
    expect(
      computeDerivedMetrics({ samples, second: 600, comparableHistoryCount: 4 })
        .historyMaturity,
    ).toBe("established");
  });

  it("returns null metric values when the window has no usable data", () => {
    const samples: RunningSample[] = Array.from({ length: 100 }, (_, i) => ({
      second: i + 1,
      timestamp: `2025-01-01T00:00:${String(i + 1).padStart(2, "0")}Z`,
      paceSecPerKm: null,
      heartRateBpm: null,
      distanceM: 0,
      elevationM: 0,
      gradePct: 0,
      cadenceSpm: null,
      signalQuality: "low",
      dataAgeSeconds: 40,
      autoPaused: false,
      symptomsReported: false,
    }));
    const metrics = computeDerivedMetrics({ samples, second: 100 });
    expect(metrics.paceWindowSecPerKm).toBeNull();
    expect(metrics.heartRateWindowBpm).toBeNull();
    expect(metrics.hrTrendBpmPerMin).toBeNull();
    expect(metrics.paceVsTargetSeconds).toBeNull();
    expect(metrics.historicalPaceDeltaSeconds).toBeNull();
    expect(metrics.historicalHrDeltaBpm).toBeNull();
  });

  it("is deterministic: same inputs produce the same metrics", () => {
    const samples = generateScenarioSamples("cardiac-drift", 42);
    const history = generateAthleteHistory(5, 42);
    const args = {
      samples,
      second: 600,
      targetPaceSecPerKm: SCENARIOS_TARGET["cardiac-drift"],
      baseline: history.profile.baseline,
      comparableHistoryCount: history.comparableCount,
    };
    expect(computeDerivedMetrics(args)).toEqual(computeDerivedMetrics(args));
  });

  it("detects a positive HR trend on the cardiac-drift scenario", () => {
    const samples = generateScenarioSamples("cardiac-drift", 42);
    const metrics = computeDerivedMetrics({
      samples,
      second: 600,
      comparableHistoryCount: 0,
    });
    expect(metrics.hrTrendBpmPerMin as number).toBeGreaterThan(1);
  });
});

// Target ranges reused from the scenario definitions without importing them
// twice in different describe blocks; kept in one place for these tests.
const SCENARIOS_TARGET: Record<
  "easy-under-target" | "cardiac-drift",
  { min: number; max: number }
> = {
  "easy-under-target": { min: 315, max: 330 },
  "cardiac-drift": { min: 315, max: 330 },
};
