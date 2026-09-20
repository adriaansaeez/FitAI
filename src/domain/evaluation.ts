/**
 * Post-hoc evaluation of a race decision against the telemetry that followed
 * it (spec: real-race validation, "Qué se compara y qué no").
 *
 * This is a coherence and prudence aid, NOT a clinical accuracy measure: a
 * later acceleration is never proof that an `increase_gently` was correct
 * (the athlete could be following a plan, reacting to rivals or descending).
 *
 * The spec's evaluation-row fields `videoReview` (link/timestamp + human
 * label) and `assessment` (`consistent` | `conservative` | `unsupported` |
 * `not_assessable`) are deliberately NOT modelled here: they are assigned by
 * a human reviewer afterwards and must never be inferred from telemetry.
 *
 * Only plain RunningSample fields are consumed — no GPS coordinates, no
 * identifiers. Pure and deterministic: same inputs, same evaluation.
 */

import { linearSlopePerMinute, windowAverage } from "./metrics";
import type { DecisionTrace, RunningSample } from "./types";

/** Observed telemetry summary over the window AFTER a decision second. */
export type ObservedWindow = {
  meanPaceSecPerKm: number | null;
  meanHeartRateBpm: number | null;
  hrTrendBpmPerMin: number | null;
};

/** Terrain change over the window that followed a decision second. */
export type TerrainDelta = {
  elevationDeltaM: number | null;
  meanGradePct: number | null;
};

/**
 * One evaluation row. Human-assigned fields (videoReview, assessment) are
 * appended later outside this module — see the module JSDoc.
 */
export type RaceDecisionEvaluation = {
  decisionSecond: number;
  action: string;
  reasonCodes: string[];
  confidence: number | null;
  observedNext60s: ObservedWindow | null;
  observedNext90s: ObservedWindow | null;
  terrainDelta: TerrainDelta;
};

const NEXT_60S = 60;
const NEXT_90S = 90;
/** An observed window is reported only when at least half its seconds exist. */
const MIN_WINDOW_COVERAGE = 0.5;

/**
 * Samples strictly AFTER `decisionSecond` and within `windowSeconds` of it.
 * Samples are 1-indexed by their `second` field (one sample per second).
 */
function samplesAfter(
  samples: readonly RunningSample[],
  decisionSecond: number,
  windowSeconds: number,
): RunningSample[] {
  return samples.filter(
    (sample) => sample.second > decisionSecond && sample.second <= decisionSecond + windowSeconds,
  );
}

/**
 * Observed summary of the window after the decision. Null when fewer than
 * half the window seconds are available (e.g. near the end of the session).
 * Means run over non-null values only; the HR trend is a simple linear slope
 * per minute over the available points (null with fewer than two points).
 */
function computeObservedWindow(
  samples: readonly RunningSample[],
  decisionSecond: number,
  windowSeconds: number,
): ObservedWindow | null {
  const window = samplesAfter(samples, decisionSecond, windowSeconds);
  if (window.length < windowSeconds * MIN_WINDOW_COVERAGE) {
    return null;
  }
  return {
    meanPaceSecPerKm: windowAverage(
      window.map((sample) => sample.paceSecPerKm),
      windowSeconds,
    ),
    meanHeartRateBpm: windowAverage(
      window.map((sample) => sample.heartRateBpm),
      windowSeconds,
    ),
    hrTrendBpmPerMin: linearSlopePerMinute(
      window.map((sample) => sample.heartRateBpm),
      windowSeconds,
    ),
  };
}

/**
 * Elevation change from the decision second to the last sample within the
 * window that follows it, plus the mean published grade over that span.
 * Null when the decision second or any following sample is unavailable.
 */
function computeTerrainDelta(
  samples: readonly RunningSample[],
  decisionSecond: number,
  windowSeconds: number,
): TerrainDelta {
  const after = samplesAfter(samples, decisionSecond, windowSeconds);
  const last = after[after.length - 1];
  const at = samples.find((sample) => sample.second === decisionSecond);
  if (at === undefined || last === undefined) {
    return { elevationDeltaM: null, meanGradePct: null };
  }
  return {
    elevationDeltaM: last.elevationM - at.elevationM,
    meanGradePct: windowAverage(
      after.map((sample) => sample.gradePct),
      after.length,
    ),
  };
}

/**
 * Evaluate one decision trace against the telemetry that followed it.
 * Pure recompute from raw samples; nothing is persisted here — the spec's
 * evaluation rows (including the human `videoReview`/`assessment` labels)
 * live outside the client.
 */
export function evaluateDecisionAgainstObserved(
  trace: DecisionTrace,
  samples: readonly RunningSample[],
  decisionSecond: number,
): RaceDecisionEvaluation {
  return {
    decisionSecond,
    action: trace.action,
    reasonCodes: [...trace.reasonCodes],
    confidence: trace.confidence ?? null,
    observedNext60s: computeObservedWindow(samples, decisionSecond, NEXT_60S),
    observedNext90s: computeObservedWindow(samples, decisionSecond, NEXT_90S),
    terrainDelta: computeTerrainDelta(samples, decisionSecond, NEXT_90S),
  };
}
