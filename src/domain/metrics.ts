/**
 * Pure metric engine.
 *
 * Deterministic: no Math.random, no Date.now inside logic. Windows and
 * thresholds follow the spec (pace 30-60 s, HR 60-90 s, freshness 15 s).
 */

import type {
  AthleteProfile,
  DerivedMetrics,
  PaceTargetSecPerKm,
  RunningSample,
  TrainingBlock,
} from "./types";
import {
  heartRateZonePosition,
  targetHeartRateZone,
  type HeartRateZone,
} from "./heartRateZones";

/** Pace smoothing window: inside the spec's 30-60 s range. */
export const PACE_WINDOW_SECONDS = 45;
/** HR smoothing and trend window: inside the spec's 60-90 s range. */
export const HR_WINDOW_SECONDS = 75;
/** Data older than this many seconds is stale (spec guard). */
export const MAX_FRESH_DATA_SECONDS = 15;

/**
 * Average of the last `windowSeconds` values, ignoring nulls.
 * Returns null when the window contains no usable value.
 */
export function windowAverage(
  values: ReadonlyArray<number | null>,
  windowSeconds: number,
): number | null {
  const window = values.slice(-Math.max(windowSeconds, 0));
  const usable = window.filter((v): v is number => v !== null);
  if (usable.length === 0) {
    return null;
  }
  return usable.reduce((sum, v) => sum + v, 0) / usable.length;
}

/**
 * Linear regression slope of the last `windowSeconds` values, in units per
 * minute (sample interval is 1 s). Null with fewer than two usable points.
 */
export function linearSlopePerMinute(
  values: ReadonlyArray<number | null>,
  windowSeconds: number,
): number | null {
  const window = values.slice(-Math.max(windowSeconds, 0));
  const points = window
    .map((v, x) => ({ x, y: v }))
    .filter((p): p is { x: number; y: number } => p.y !== null);
  if (points.length < 2) {
    return null;
  }
  const n = points.length;
  const meanX = points.reduce((sum, p) => sum + p.x, 0) / n;
  const meanY = points.reduce((sum, p) => sum + p.y, 0) / n;
  let covariance = 0;
  let variance = 0;
  for (const point of points) {
    covariance += (point.x - meanX) * (point.y - meanY);
    variance += (point.x - meanX) ** 2;
  }
  if (variance === 0) {
    return null;
  }
  // x is in seconds, so slope is per second; convert to per minute.
  return (covariance / variance) * 60;
}

/**
 * Difference between the smoothed pace and the target range.
 * Positive = slower than target, negative = faster, 0 = inside the range.
 */
export function paceVsTargetSeconds(
  paceSecPerKm: number | null,
  target?: PaceTargetSecPerKm,
): number | null {
  if (paceSecPerKm === null || target === undefined) {
    return null;
  }
  if (paceSecPerKm > target.max) {
    return paceSecPerKm - target.max;
  }
  if (paceSecPerKm < target.min) {
    return paceSecPerKm - target.min;
  }
  return 0;
}

/**
 * Cumulative distance in meters, integrating pace per second.
 * Distance holds still while pace is null (no extrapolation).
 */
export function accumulateDistance(
  paces: ReadonlyArray<number | null>,
  sampleIntervalSeconds = 1,
): number[] {
  const cumulative: number[] = [];
  let total = 0;
  for (const pace of paces) {
    if (pace !== null && pace > 0) {
      total += (1000 * sampleIntervalSeconds) / pace;
    }
    cumulative.push(Math.round(total * 100) / 100);
  }
  return cumulative;
}

/** Grade in percent from an elevation delta and the horizontal distance covered. */
export function gradeFromElevation(
  elevationDeltaM: number,
  distanceDeltaM: number,
): number {
  if (distanceDeltaM <= 0) {
    return 0;
  }
  return (elevationDeltaM / distanceDeltaM) * 100;
}

/** True when the data age is within the freshness guard. */
export function isSignalFresh(
  dataAgeSeconds: number,
  maxAgeSeconds: number = MAX_FRESH_DATA_SECONDS,
): boolean {
  return dataAgeSeconds <= maxAgeSeconds;
}

export type AthleteBaseline = AthleteProfile["baseline"];

export interface ComputeDerivedMetricsInput {
  samples: readonly RunningSample[];
  /** Current second (inclusive); samples after it are ignored. */
  second: number;
  targetPaceSecPerKm?: PaceTargetSecPerKm;
  baseline?: AthleteBaseline;
  comparableHistoryCount?: number;
  block?: TrainingBlock;
  heartRateZones?: readonly HeartRateZone[];
}

/**
 * Derive all metrics for the current second from the sample history so far.
 * Pure and deterministic; re-derived from scratch every call.
 */
export function computeDerivedMetrics(
  input: ComputeDerivedMetricsInput,
): DerivedMetrics {
  const { samples, second, targetPaceSecPerKm, baseline, comparableHistoryCount, block, heartRateZones } =
    input;
  const upToNow = samples.filter((sample) => sample.second <= second);
  const paceSeries = upToNow.map((sample) => sample.paceSecPerKm);
  const hrSeries = upToNow.map((sample) => sample.heartRateBpm);

  const paceWindowSecPerKm = windowAverage(paceSeries, PACE_WINDOW_SECONDS);
  const heartRateWindowBpm = windowAverage(hrSeries, HR_WINDOW_SECONDS);
  const hrTrendBpmPerMin = linearSlopePerMinute(hrSeries, HR_WINDOW_SECONDS);

  const historicalPaceDeltaSeconds =
    paceWindowSecPerKm !== null && baseline?.typicalEasyPaceSecPerKm !== undefined
      ? paceWindowSecPerKm - baseline.typicalEasyPaceSecPerKm
      : null;
  const historicalHrDeltaBpm =
    heartRateWindowBpm !== null && baseline?.typicalEasyHrBpm !== undefined
      ? heartRateWindowBpm - baseline.typicalEasyHrBpm
      : null;

  const comparableCount = comparableHistoryCount ?? 0;
  const targetZone = block === undefined || heartRateZones === undefined ? null : targetHeartRateZone(block);
  const currentZone = heartRateZones === undefined ? null : heartRateZonePosition(heartRateWindowBpm, heartRateZones);
  const heartRateZoneDelta =
    currentZone !== null && targetZone !== null ? currentZone - targetZone.maxZone : null;
  let consecutiveSecondsAboveHeartRateZone = 0;
  if (targetZone !== null && heartRateZones !== undefined) {
    for (let index = upToNow.length - 1; index >= 0; index -= 1) {
      const zone = heartRateZonePosition(upToNow[index]!.heartRateBpm, heartRateZones);
      if (zone === null || zone <= targetZone.maxZone) break;
      consecutiveSecondsAboveHeartRateZone += 1;
    }
  }

  return {
    paceWindowSecPerKm,
    heartRateWindowBpm,
    hrTrendBpmPerMin,
    paceVsTargetSeconds: paceVsTargetSeconds(paceWindowSecPerKm, targetPaceSecPerKm),
    comparableHistoryCount: comparableCount,
    historicalPaceDeltaSeconds,
    historicalHrDeltaBpm,
    historyMaturity: deriveHistoryMaturity(comparableCount),
    heartRateZonePosition: currentZone,
    targetHeartRateZoneMin: targetZone?.minZone ?? null,
    targetHeartRateZoneMax: targetZone?.maxZone ?? null,
    heartRateZoneDelta,
    consecutiveSecondsAboveHeartRateZone,
  };
}

/**
 * historyMaturity mapping from the spec:
 * none (0 comparable sessions) / early (1-3) / established (4-10).
 * Counts above 10 are treated as established.
 */
export function deriveHistoryMaturity(comparableCount: number): DerivedMetrics["historyMaturity"] {
  if (comparableCount <= 0) {
    return "none";
  }
  if (comparableCount <= 3) {
    return "early";
  }
  return "established";
}
