import { describe, expect, it } from "vitest";
import { decideSecond } from "../src/domain/composer";
import {
  DEFAULT_HEART_RATE_ZONES,
  heartRateZonePosition,
} from "../src/domain/heartRateZones";
import { computeDerivedMetrics } from "../src/domain/metrics";
import type { RunningSample } from "../src/domain/types";
import { heartRateZonesSchema } from "../src/domain/validation";
import { MockDecisionProvider } from "../src/services/mockDecisionProvider";

function sample(second: number, heartRateBpm: number): RunningSample {
  return {
    second,
    timestamp: `2025-01-01T00:00:${String(second).padStart(2, "0")}.000Z`,
    paceSecPerKm: 330,
    heartRateBpm,
    distanceM: second * 3,
    elevationM: 0,
    gradePct: 0,
    cadenceSpm: 170,
    signalQuality: "high",
    dataAgeSeconds: 0,
    autoPaused: false,
    symptomsReported: false,
  };
}

describe("manual heart-rate zones", () => {
  it("classifies default-zone boundaries and out-of-range values", () => {
    expect(heartRateZonePosition(99, DEFAULT_HEART_RATE_ZONES)).toBe(0);
    expect(heartRateZonePosition(100, DEFAULT_HEART_RATE_ZONES)).toBe(1);
    expect(heartRateZonePosition(139, DEFAULT_HEART_RATE_ZONES)).toBe(2);
    expect(heartRateZonePosition(190, DEFAULT_HEART_RATE_ZONES)).toBe(5);
    expect(heartRateZonePosition(191, DEFAULT_HEART_RATE_ZONES)).toBe(6);
  });

  it("derives the easy-block target and a 60-second excess streak", () => {
    const samples = Array.from({ length: 60 }, (_, index) => sample(index + 1, 150));
    const metrics = computeDerivedMetrics({
      samples,
      second: 60,
      block: "easy",
      heartRateZones: DEFAULT_HEART_RATE_ZONES,
    });
    expect(metrics.heartRateZonePosition).toBe(3);
    expect(metrics.targetHeartRateZoneMin).toBe(2);
    expect(metrics.targetHeartRateZoneMax).toBe(2);
    expect(metrics.heartRateZoneDelta).toBe(1);
    expect(metrics.consecutiveSecondsAboveHeartRateZone).toBe(60);
  });

  it("uses sustained configured-zone excess to reduce with Mock", async () => {
    const samples = Array.from({ length: 60 }, (_, index) => sample(index + 1, 150));
    const trace = await decideSecond({
      samples,
      block: "easy",
      heartRateZones: DEFAULT_HEART_RATE_ZONES,
      comparableHistoryCount: 5,
      provider: new MockDecisionProvider(),
    });
    expect(trace.action).toBe("decrease_gently");
  });

  it("rejects gaps, overlaps and inverted zones", () => {
    expect(heartRateZonesSchema.safeParse(DEFAULT_HEART_RATE_ZONES).success).toBe(true);
    expect(
      heartRateZonesSchema.safeParse([
        { zone: 1, minBpm: 100, maxBpm: 119 },
        { zone: 2, minBpm: 121, maxBpm: 139 },
        ...DEFAULT_HEART_RATE_ZONES.slice(2),
      ]).success,
    ).toBe(false);
    expect(
      heartRateZonesSchema.safeParse([
        { zone: 1, minBpm: 120, maxBpm: 100 },
        ...DEFAULT_HEART_RATE_ZONES.slice(1),
      ]).success,
    ).toBe(false);
  });
});
