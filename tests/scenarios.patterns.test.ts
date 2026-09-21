import { describe, expect, it } from "vitest";
import { SCENARIOS, generateScenarioSamples } from "../src/simulation/scenarios";
import type { RunningSample } from "../src/domain/types";

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function paces(samples: RunningSample[]): number[] {
  return samples
    .map((s) => s.paceSecPerKm)
    .filter((p): p is number => p !== null);
}

describe("scenario defining patterns", () => {
  it("easy-under-target: stable easy pace below target, low HR/RPE, clean signal", () => {
    const target = SCENARIOS["easy-under-target"].targetPaceSecPerKm;
    const samples = generateScenarioSamples("easy-under-target", 11);
    const validPaces = paces(samples);
    expect(validPaces).toHaveLength(samples.length);
    // Runner is slower than the target range (pace seconds per km above max).
    expect(mean(validPaces)).toBeGreaterThan(target.max);
    expect(samples.every((s) => s.heartRateBpm !== null && s.heartRateBpm < 155)).toBe(true);
    expect(samples.every((s) => (s.rpe ?? 3) <= 4)).toBe(true);
    expect(samples.every((s) => s.signalQuality === "high")).toBe(true);
    expect(samples.every((s) => s.dataAgeSeconds <= 2)).toBe(true);
    expect(samples.every((s) => !s.symptomsReported)).toBe(true);
  });

  it("cardiac-drift: sustained HR rise at stable pace, RPE reaches 7", () => {
    const samples = generateScenarioSamples("cardiac-drift", 11);
    const first60 = samples
      .slice(0, 60)
      .map((s) => s.heartRateBpm)
      .filter((v): v is number => v !== null);
    const last60 = samples
      .slice(-60)
      .map((s) => s.heartRateBpm)
      .filter((v): v is number => v !== null);
    // Sustained rise: late HR clearly above early HR.
    expect(mean(last60) - mean(first60)).toBeGreaterThan(15);
    // Pace stays essentially stable across the session.
    const validPaces = paces(samples);
    expect(Math.max(...validPaces) - Math.min(...validPaces)).toBeLessThan(15);
    // RPE climbs and reaches 7.
    const rpes = samples.map((s) => s.rpe).filter((v): v is number => v !== undefined);
    expect(Math.max(...rpes)).toBe(7);
    expect(samples.every((s) => s.signalQuality === "high")).toBe(true);
  });

  it("uphill: pace slows while grade is positive, HR rises explainably", () => {
    const samples = generateScenarioSamples("uphill", 11);
    const flat = samples.filter((s) => s.gradePct <= 1);
    const climbing = samples.filter((s) => s.gradePct >= 3);
    // The route must actually contain climbs.
    expect(climbing.length).toBeGreaterThan(30);
    const flatPace = mean(paces(flat));
    const climbPace = mean(paces(climbing));
    // Positive grade means slower pace (more seconds per km).
    expect(climbPace).toBeGreaterThan(flatPace + 10);
    // Effort still rises on climbs (HR), so slow pace is not "lack of effort".
    const flatHr = mean(
      flat.map((s) => s.heartRateBpm).filter((v): v is number => v !== null),
    );
    const climbHr = mean(
      climbing.map((s) => s.heartRateBpm).filter((v): v is number => v !== null),
    );
    expect(climbHr).toBeGreaterThan(flatHr);
  });

  it("poor-signal: HR and pace gaps, stale data, low quality", () => {
    const samples = generateScenarioSamples("poor-signal", 11);
    expect(samples.some((s) => s.heartRateBpm === null)).toBe(true);
    expect(samples.some((s) => s.paceSecPerKm === null)).toBe(true);
    expect(samples.some((s) => s.dataAgeSeconds > 15)).toBe(true);
    const low = samples.filter((s) => s.signalQuality === "low");
    expect(low.length).toBeGreaterThan(samples.length / 2);
  });

  it("symptom-stop: exactly one symptomsReported=true second", () => {
    const samples = generateScenarioSamples("symptom-stop", 11);
    const symptomatic = samples.filter((s) => s.symptomsReported);
    expect(symptomatic).toHaveLength(1);
    expect(symptomatic[0]?.second).toBe(
      SCENARIOS["symptom-stop"].symptomSecond,
    );
    // Everything before the symptom looks like a normal easy run.
    const before = samples.filter((s) => s.second < (symptomatic[0]?.second ?? 0));
    expect(before.every((s) => !s.symptomsReported)).toBe(true);
  });

  it("inexperienced-runner: erratic but physiologically realistic", () => {
    const samples = generateScenarioSamples("inexperienced-runner", 42);

    // Pace: always present and inside physiologically plausible bounds.
    const validPaces = paces(samples);
    expect(validPaces).toHaveLength(samples.length);
    expect(Math.min(...validPaces)).toBeGreaterThanOrEqual(290);
    expect(Math.max(...validPaces)).toBeLessThanOrEqual(415);

    // Pace is genuinely erratic: novice sawtooth, far noisier than the
    // easy-under-target signal (stdDev ~1.5 there).
    const paceMean = mean(validPaces);
    const paceStdDev = Math.sqrt(
      mean(validPaces.map((p) => (p - paceMean) ** 2)),
    );
    expect(paceStdDev).toBeGreaterThan(25);
    expect(Math.max(...validPaces) - Math.min(...validPaces)).toBeGreaterThan(80);

    // HR: always present, bounded, and swinging hard.
    const hrs = samples
      .map((s) => s.heartRateBpm)
      .filter((v): v is number => v !== null);
    expect(hrs).toHaveLength(samples.length);
    expect(Math.min(...hrs)).toBeGreaterThanOrEqual(120);
    expect(Math.max(...hrs)).toBeLessThanOrEqual(186);
    expect(Math.max(...hrs) - Math.min(...hrs)).toBeGreaterThan(35);

    // HR lags pace: in the first 120 s cycle, the fastest pace happens
    // before the HR peak (surge first, HR follows).
    const firstCycle = samples.slice(0, 120);
    const minPaceSecond = firstCycle.reduce(
      (best, s) => ((s.paceSecPerKm ?? Infinity) < best.pace ? { second: s.second, pace: s.paceSecPerKm ?? Infinity } : best),
      { second: 0, pace: Infinity },
    ).second;
    const maxHrSecond = firstCycle.reduce(
      (best, s) => ((s.heartRateBpm ?? -Infinity) > best.hr ? { second: s.second, hr: s.heartRateBpm ?? -Infinity } : best),
      { second: 0, hr: -Infinity },
    ).second;
    expect(minPaceSecond).toBeGreaterThan(0);
    expect(maxHrSecond).toBeGreaterThan(0);
    expect(minPaceSecond).toBeLessThan(maxHrSecond);

    // RPE checkpoints (every 30 s) jump within [4, 8]; both ends occur.
    const rpeCheckpoints = samples
      .filter((s) => s.second % 30 === 0)
      .map((s) => s.rpe)
      .filter((v): v is number => v !== null);
    expect(rpeCheckpoints).toHaveLength(20);
    expect(rpeCheckpoints.every((r) => r >= 4 && r <= 8)).toBe(true);
    expect(rpeCheckpoints).toContain(4);
    expect(rpeCheckpoints).toContain(8);

    // Signal stays clean; no symptoms in this scenario.
    expect(samples.every((s) => s.signalQuality === "high")).toBe(true);
    expect(samples.every((s) => !s.symptomsReported)).toBe(true);
  });

  it("symptom-stop: supports a custom symptom second", () => {
    const samples = generateScenarioSamples("symptom-stop", 11, {
      symptomSecond: 120,
    });
    const symptomatic = samples.filter((s) => s.symptomsReported);
    expect(symptomatic).toHaveLength(1);
    expect(symptomatic[0]?.second).toBe(120);
  });
});
