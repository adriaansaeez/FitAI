import { describe, expect, it } from "vitest";
import { latestEvaluations } from "../src/components/LiveSimulationPanel";
import type { DecisionEntry } from "../src/components/useRaceSimulation";

function entry(second: number, reused = false): DecisionEntry {
  return {
    second,
    reused,
    calledJev: false,
    fetchFailed: false,
    trace: {
      second,
      action: "maintain",
      source: "mock",
      confidence: 0.9,
      reasonCodes: [],
      explanationKey: "decision.maintain",
      derivedMetrics: {
        paceWindowSecPerKm: 330,
        heartRateWindowBpm: 140,
        hrTrendBpmPerMin: 0,
        paceVsTargetSeconds: 0,
        comparableHistoryCount: 5,
        historicalPaceDeltaSeconds: 0,
        historicalHrDeltaBpm: 0,
        historyMaturity: "established",
      },
      safety: { hardStop: false, mayIncreaseIntensity: true, missingRequiredMetric: false, reasonCodes: [] },
    },
  };
}

describe("latestEvaluations", () => {
  it("keeps the five newest evaluated decisions and excludes reused entries", () => {
    const entries = [entry(1), entry(2, true), entry(3), entry(4), entry(5), entry(6), entry(7), entry(8)];
    expect(latestEvaluations(entries).map((item) => item.second)).toEqual([8, 7, 6, 5, 4]);
  });
});
