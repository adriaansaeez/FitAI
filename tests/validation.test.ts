import { describe, expect, it } from "vitest";
import {
  athleteProfileSchema,
  athleteSessionSummarySchema,
  decisionTraceSchema,
  derivedMetricsSchema,
  runningSampleSchema,
  safetyResultSchema,
  trainingBlockSchema,
} from "../src/domain/validation";
import { generateScenarioSamples } from "../src/simulation/scenarios";
import { generateAthleteHistory } from "../src/simulation/history";

describe("zod validation of scenario output", () => {
  it.each([
    "easy-under-target",
    "cardiac-drift",
    "uphill",
    "poor-signal",
    "symptom-stop",
  ] as const)("%s samples pass the RunningSample schema", (scenarioId) => {
    const samples = generateScenarioSamples(scenarioId, 42);
    expect(samples).toHaveLength(600);
    for (const sample of samples) {
      const result = runningSampleSchema.safeParse(sample);
      expect(result.success).toBe(true);
    }
  });

  it("rejects an invalid sample (negative second, bad signal quality)", () => {
    const bad = {
      second: -1,
      timestamp: "2025-01-01T00:00:01.000Z",
      paceSecPerKm: 320,
      heartRateBpm: 140,
      distanceM: 3,
      elevationM: 0,
      gradePct: 0,
      cadenceSpm: 170,
      signalQuality: "excellent",
      dataAgeSeconds: 0,
      autoPaused: false,
      symptomsReported: false,
    };
    expect(runningSampleSchema.safeParse(bad).success).toBe(false);
  });
});

describe("zod validation of athlete history", () => {
  it("validates generated athlete profiles for every history count", () => {
    for (const count of [0, 1, 3, 5, 10] as const) {
      const history = generateAthleteHistory(count, 42);
      expect(athleteProfileSchema.safeParse(history.profile).success).toBe(true);
    }
  });

  it("validates a single session summary and rejects unknown workout types", () => {
    const history = generateAthleteHistory(1, 42);
    const session = history.profile.sessions[0];
    expect(session).toBeDefined();
    expect(athleteSessionSummarySchema.safeParse(session).success).toBe(true);
    expect(trainingBlockSchema.safeParse("easy").success).toBe(true);
    expect(trainingBlockSchema.safeParse("sprint").success).toBe(false);
  });
});

describe("zod validation of decision-related schemas", () => {
  it("accepts a minimal derived metrics object", () => {
    const metrics = {
      paceWindowSecPerKm: null,
      heartRateWindowBpm: 140,
      hrTrendBpmPerMin: 1.2,
      paceVsTargetSeconds: 5,
      comparableHistoryCount: 3,
      historicalPaceDeltaSeconds: -4,
      historicalHrDeltaBpm: null,
      historyMaturity: "early",
    };
    expect(derivedMetricsSchema.safeParse(metrics).success).toBe(true);
    expect(derivedMetricsSchema.safeParse({ ...metrics, historyMaturity: "huge" }).success).toBe(
      false,
    );
  });

  it("accepts a minimal safety result", () => {
    expect(
      safetyResultSchema.safeParse({
        hardStop: false,
        mayIncreaseIntensity: true,
        missingRequiredMetric: false,
        reasonCodes: [],
      }).success,
    ).toBe(true);
    expect(
      safetyResultSchema.safeParse({
        hardStop: "no",
        mayIncreaseIntensity: true,
        missingRequiredMetric: false,
        reasonCodes: [],
      }).success,
    ).toBe(false);
  });

  it("accepts a full decision trace", () => {
    const trace = {
      second: 42,
      action: "maintain",
      source: "mock",
      confidence: 0.8,
      probabilities: { maintain: 0.8, recover: 0.1 },
      reasonCodes: ["within_target_range"],
      explanationKey: "decision.maintain",
      derivedMetrics: {
        paceWindowSecPerKm: 320,
        heartRateWindowBpm: 141,
        hrTrendBpmPerMin: 0.4,
        paceVsTargetSeconds: 0,
        comparableHistoryCount: 7,
        historicalPaceDeltaSeconds: -10,
        historicalHrDeltaBpm: 1,
        historyMaturity: "established",
      },
      safety: {
        hardStop: false,
        mayIncreaseIntensity: true,
        missingRequiredMetric: false,
        reasonCodes: [],
      },
    };
    expect(decisionTraceSchema.safeParse(trace).success).toBe(true);
    expect(
      decisionTraceSchema.safeParse({ ...trace, action: "sprint" }).success,
    ).toBe(false);
    expect(
      decisionTraceSchema.safeParse({ ...trace, source: "browser" }).success,
    ).toBe(false);
  });
});
