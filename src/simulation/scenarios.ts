/**
 * The six scenario definitions from the spec, as data, plus a pure
 * sample generator: 1 sample per second, 600 samples, fully seed-driven.
 *
 * Same (scenarioId, seed, opts) -> identical output. No Date.now, no Math.random.
 */

import type { PaceTargetSecPerKm, RunningSample, TrainingBlock } from "../domain/types";
import { generateRoute, type RoutePoint } from "./route";
import { createRng, rngGauss, rngInt, rngRange } from "./rng";

export type ScenarioId =
  | "easy-under-target"
  | "cardiac-drift"
  | "uphill"
  | "poor-signal"
  | "symptom-stop"
  | "inexperienced-runner";

export const SCENARIO_IDS: readonly ScenarioId[] = [
  "easy-under-target",
  "cardiac-drift",
  "uphill",
  "poor-signal",
  "symptom-stop",
  "inexperienced-runner",
];

export interface ScenarioDefinition {
  id: ScenarioId;
  label: string;
  description: string;
  block: TrainingBlock;
  targetPaceSecPerKm: PaceTargetSecPerKm;
  /** Second with symptomsReported=true, or null when the scenario has none. */
  symptomSecond: number | null;
  expectedOutcome: string;
}

export const SCENARIOS: Record<ScenarioId, ScenarioDefinition> = {
  "easy-under-target": {
    id: "easy-under-target",
    label: "Easy, under target",
    description:
      "Stable easy run, runner below target pace, low HR and RPE.",
    block: "easy",
    targetPaceSecPerKm: { min: 315, max: 330 },
    symptomSecond: null,
    expectedOutcome: "After enough evidence, a limited gentle increase.",
  },
  "cardiac-drift": {
    id: "cardiac-drift",
    label: "Cardiac drift",
    description:
      "Same pace but HR rises steadily and RPE reaches 7.",
    block: "easy",
    targetPaceSecPerKm: { min: 315, max: 330 },
    symptomSecond: null,
    expectedOutcome: "Decrease gently or recover; never increase.",
  },
  uphill: {
    id: "uphill",
    label: "Uphill",
    description:
      "Pace slows during climbs while HR rises in an explainable way.",
    block: "easy",
    targetPaceSecPerKm: { min: 315, max: 330 },
    symptomSecond: null,
    expectedOutcome:
      "Maintain or decrease gently; slow pace is not read as lack of effort.",
  },
  "poor-signal": {
    id: "poor-signal",
    label: "Poor signal",
    description:
      "HR with gaps and spikes, GPS/pace of low quality or stale.",
    block: "easy",
    targetPaceSecPerKm: { min: 315, max: 330 },
    symptomSecond: null,
    expectedOutcome: "Insufficient data or maintain; never increase.",
  },
  "symptom-stop": {
    id: "symptom-stop",
    label: "Symptom stop",
    description: "A symptom is reported during an otherwise normal easy run.",
    block: "easy",
    targetPaceSecPerKm: { min: 315, max: 330 },
    symptomSecond: 360,
    expectedOutcome: "Stop and escalate without calling Jev.",
  },
  "inexperienced-runner": {
    id: "inexperienced-runner",
    label: "Inexperienced runner",
    description:
      "Inexperienced runner: erratic pace surges and fades, HR swinging high and uncontrolled, RPE jumping.",
    block: "easy",
    targetPaceSecPerKm: { min: 315, max: 330 },
    symptomSecond: null,
    expectedOutcome:
      "Maintain or decrease; erratic evidence and HR spikes must never trigger an increase.",
  },
};

export function isScenarioId(value: string): value is ScenarioId {
  return (SCENARIO_IDS as readonly string[]).includes(value);
}

export interface GenerateScenarioOptions {
  durationSeconds?: number;
  /** Fixed ISO start timestamp; defaults to a constant so output stays deterministic. */
  startTimestamp?: string;
  /** Override the symptom second (symptom-stop scenario only). */
  symptomSecond?: number;
}

const DEFAULT_START_TIMESTAMP = "2025-01-01T00:00:00.000Z";
const DEFAULT_DURATION_SECONDS = 600;

export function generateScenarioSamples(
  scenarioId: ScenarioId,
  seed: number,
  options: GenerateScenarioOptions = {},
): RunningSample[] {
  const durationSeconds = options.durationSeconds ?? DEFAULT_DURATION_SECONDS;
  const startMs = Date.parse(options.startTimestamp ?? DEFAULT_START_TIMESTAMP);
  if (Number.isNaN(startMs)) {
    throw new Error(`Invalid startTimestamp: ${String(options.startTimestamp)}`);
  }
  const rng = createRng(seed);
  const route = generateRoute(seed, { durationSeconds });
  const symptomSecond =
    scenarioId === "symptom-stop"
      ? (options.symptomSecond ?? SCENARIOS["symptom-stop"].symptomSecond ?? 360)
      : null;

  const samples: RunningSample[] = [];
  let distanceM = 0;
  // State for the poor-signal sample schedule.
  let lastGoodSecond = 0;
  const goodSampleEvery = rngInt(rng, 18, 25);

  for (let second = 1; second <= durationSeconds; second += 1) {
    const routePoint = route[second - 1] as RoutePoint;
    const reading = readScenarioSample(
      scenarioId,
      rng,
      second,
      routePoint.gradePct,
      lastGoodSecond,
      goodSampleEvery,
    );
    if (reading.goodSample) {
      lastGoodSecond = second;
    }

    // Distance integrates the scenario pace, holding on gaps (null pace).
    if (reading.paceSecPerKm !== null) {
      distanceM += 1000 / reading.paceSecPerKm;
    }

    samples.push({
      second,
      timestamp: new Date(startMs + second * 1000).toISOString(),
      paceSecPerKm: reading.paceSecPerKm,
      heartRateBpm: reading.heartRateBpm,
      distanceM: Math.round(distanceM * 100) / 100,
      elevationM: routePoint.elevationM,
      gradePct: routePoint.gradePct,
      cadenceSpm: reading.cadenceSpm,
      signalQuality: reading.signalQuality,
      dataAgeSeconds: reading.dataAgeSeconds,
      autoPaused: false,
      ...(reading.rpe !== null ? { rpe: reading.rpe } : {}),
      symptomsReported: symptomSecond !== null && second === symptomSecond,
    });
  }

  return samples;
}

interface ScenarioReading {
  paceSecPerKm: number | null;
  heartRateBpm: number | null;
  cadenceSpm: number | null;
  signalQuality: RunningSample["signalQuality"];
  dataAgeSeconds: number;
  rpe: number | null;
  goodSample: boolean;
}

function readScenarioSample(
  scenarioId: ScenarioId,
  rng: ReturnType<typeof createRng>,
  second: number,
  gradePct: number,
  lastGoodSecond: number,
  goodSampleEvery: number,
): ScenarioReading {
  const rpeCheckpoint = second % 30 === 0;

  switch (scenarioId) {
    case "easy-under-target": {
      // Stable easy pace slower than the target range, low HR/RPE.
      const pace = 338 + rngGauss(rng, 0, 1.5);
      const hr = 140 + 3 * Math.sin((2 * Math.PI * second) / 300) + rngGauss(rng, 0, 1.5);
      return {
        paceSecPerKm: round1(pace),
        heartRateBpm: Math.round(hr),
        cadenceSpm: Math.round(168 + rngGauss(rng, 0, 2)),
        signalQuality: "high",
        dataAgeSeconds: second % 3 === 0 ? 1 : 0,
        rpe: rpeCheckpoint ? 3 : null,
        goodSample: true,
      };
    }

    case "cardiac-drift": {
      // Same stable pace, HR rises steadily, RPE climbs to 7.
      const pace = 320 + rngGauss(rng, 0, 1.2);
      const progress = second / 600;
      const hr = 130 + 40 * progress + rngGauss(rng, 0, 1.2);
      return {
        paceSecPerKm: round1(pace),
        heartRateBpm: Math.round(hr),
        cadenceSpm: Math.round(168 + rngGauss(rng, 0, 2)),
        signalQuality: "high",
        dataAgeSeconds: second % 3 === 0 ? 1 : 0,
        rpe: rpeCheckpoint ? Math.min(7, Math.round(3 + 4 * progress)) : null,
        goodSample: true,
      };
    }

    case "uphill": {
      // Pace slows proportionally to positive grade; HR still rises.
      const climb = Math.max(gradePct, 0);
      const pace = 318 + climb * 6 + rngGauss(rng, 0, 1.5);
      const hr = 136 + climb * 1.8 + second * 0.005 + rngGauss(rng, 0, 1.5);
      return {
        paceSecPerKm: round1(pace),
        heartRateBpm: Math.round(hr),
        cadenceSpm: Math.round(166 + rngGauss(rng, 0, 2)),
        signalQuality: "high",
        dataAgeSeconds: second % 3 === 0 ? 1 : 0,
        rpe: rpeCheckpoint ? 4 : null,
        goodSample: true,
      };
    }

    case "poor-signal": {
      // Sparse good readings separated by low-quality gaps with stale data.
      if (second - lastGoodSecond >= goodSampleEvery) {
        const spike = rng() < 0.2 ? rngRange(rng, 10, 20) : 0;
        return {
          paceSecPerKm: round1(330 + rngGauss(rng, 0, 8)),
          heartRateBpm: Math.round(142 + rngGauss(rng, 0, 3) + spike),
          cadenceSpm: Math.round(165 + rngGauss(rng, 0, 4)),
          signalQuality: "medium",
          dataAgeSeconds: 0,
          rpe: rpeCheckpoint ? 5 : null,
          goodSample: true,
        };
      }
      return {
        paceSecPerKm: null,
        heartRateBpm: null,
        cadenceSpm: null,
        signalQuality: "low",
        dataAgeSeconds: second - lastGoodSecond,
        rpe: rpeCheckpoint ? 5 : null,
        goodSample: false,
      };
    }

    case "symptom-stop": {
      // Normal easy run; the symptom second is applied by the caller.
      const pace = 328 + rngGauss(rng, 0, 2);
      const hr = 138 + rngGauss(rng, 0, 2);
      return {
        paceSecPerKm: round1(pace),
        heartRateBpm: Math.round(hr),
        cadenceSpm: Math.round(168 + rngGauss(rng, 0, 2)),
        signalQuality: "high",
        dataAgeSeconds: second % 3 === 0 ? 1 : 0,
        rpe: rpeCheckpoint ? 3 : null,
        goodSample: true,
      };
    }

    case "inexperienced-runner": {
      // Novice sawtooth pacing: 120 s cycle. First 40 s quadratic surge
      // (340 -> 295 s/km), next 80 s linear fade (295 -> 410 s/km).
      const t = second % 120;
      const basePace =
        t < 40
          ? 340 - 45 * (t / 40) ** 2
          : 295 + 115 * ((t - 40) / 80);
      const pace = basePace + rngGauss(rng, 0, 4);
      // HR lags the surges: phase-shifted sine plus slow upward drift.
      const hr =
        150 +
        28 * Math.sin((2 * Math.PI * second) / 120 - 0.9) +
        second * 0.004 +
        rngGauss(rng, 0, 3);
      // Surge intensity 0..1 derived from how far below the cycle-start pace.
      const surgeIntensity = Math.min(1, Math.max(0, (340 - basePace) / 45));
      return {
        paceSecPerKm: round1(Math.min(415, Math.max(290, pace))),
        heartRateBpm: Math.round(Math.min(186, Math.max(120, hr))),
        cadenceSpm: Math.round(158 + 10 * surgeIntensity + rngGauss(rng, 0, 3)),
        signalQuality: "high",
        dataAgeSeconds: second % 3 === 0 ? 1 : 0,
        rpe: rpeCheckpoint
          ? 4 + Math.round(4 * (0.5 + 0.5 * Math.sin((2 * Math.PI * second) / 120 - 0.9)))
          : null,
        goodSample: true,
      };
    }
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
