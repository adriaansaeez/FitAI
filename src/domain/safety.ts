import type { RunningSample, TrainingBlock, DerivedMetrics, SafetyResult } from "./types";
import { MAX_FRESH_DATA_SECONDS } from "./metrics";

export const SAFETY_REASON_CODES = {
  symptomsReported: "symptoms_reported",
  lowSignalQuality: "low_signal_quality",
  staleData: "stale_data",
  autoPaused: "auto_paused",
  missingRequiredMetrics: "missing_required_metrics",
  noIncreaseInBlock: "no_increase_in_block",
} as const;

/** Data-quality reasons that force degraded handling (never increase). */
export const DEGRADED_DATA_REASON_CODES: readonly string[] = [
  SAFETY_REASON_CODES.lowSignalQuality,
  SAFETY_REASON_CODES.staleData,
  SAFETY_REASON_CODES.autoPaused,
];

/** Data older than this many seconds is stale (mirrors metrics freshness rule). */
export const MAX_STALE_DATA_SECONDS = 15;

export function hasDegradedData(safety: SafetyResult): boolean {
  return safety.reasonCodes.some((reason) => DEGRADED_DATA_REASON_CODES.includes(reason));
}

function isLowSignal(signalQuality: RunningSample["signalQuality"]): boolean {
  return signalQuality === "low";
}

function isStale(dataAgeSeconds: number | null): boolean {
  return dataAgeSeconds !== null && dataAgeSeconds > MAX_STALE_DATA_SECONDS;
}

/**
 * Pure deterministic safety policy, evaluated BEFORE any provider.
 *
 * Rules (pilot thresholds, not physiological claims):
 * 1. symptomsReported -> hard stop; the caller must return stop_and_escalate
 *    without calling any provider.
 * 2. Low signal, stale data (> 15 s) or auto-pause -> degraded data: the
 *    composer must return insufficient_data or maintain, never increase.
 * 3. Both pace and heart rate missing -> missingRequiredMetric; composer
 *    returns insufficient_data.
 * 4. warmup / recovery blocks -> mayIncreaseIntensity false.
 */
export function evaluateSafety(
  sample: RunningSample,
  metrics: DerivedMetrics,
  block: TrainingBlock,
): SafetyResult {
  const reasonCodes: string[] = [];

  if (sample.symptomsReported) {
    reasonCodes.push(SAFETY_REASON_CODES.symptomsReported);
  }
  if (isLowSignal(sample.signalQuality)) {
    reasonCodes.push(SAFETY_REASON_CODES.lowSignalQuality);
  }
  if (isStale(sample.dataAgeSeconds)) {
    reasonCodes.push(SAFETY_REASON_CODES.staleData);
  }
  if (sample.autoPaused) {
    reasonCodes.push(SAFETY_REASON_CODES.autoPaused);
  }
  if (metrics.paceWindowSecPerKm === null && metrics.heartRateWindowBpm === null) {
    reasonCodes.push(SAFETY_REASON_CODES.missingRequiredMetrics);
  }
  if (block === "warmup" || block === "recovery") {
    reasonCodes.push(SAFETY_REASON_CODES.noIncreaseInBlock);
  }

  const hardStop = sample.symptomsReported;
  const missingRequiredMetric =
    metrics.paceWindowSecPerKm === null && metrics.heartRateWindowBpm === null;
  const degraded = hasDegradedData({ hardStop, mayIncreaseIntensity: false, missingRequiredMetric, reasonCodes });
  const mayIncreaseIntensity = !hardStop && !missingRequiredMetric && !degraded && block === "easy";

  return {
    hardStop,
    mayIncreaseIntensity,
    missingRequiredMetric,
    reasonCodes,
  };
}
