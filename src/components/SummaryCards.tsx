"use client";

/**
 * Summary cards row: current action with traffic-light color, confidence and
 * origin, pace vs target, HR + trend, RPE + grade, signal quality/freshness.
 * Values come from the selected decision trace.
 */

import { memo } from "react";

import type { RunningSample } from "@/domain/types";
import type { DecisionEntry } from "./useRaceSimulation";
import { heartRateZoneLabel } from "@/domain/heartRateZones";
import {
  ACTION_COLORS,
  ACTION_LABELS,
  SOURCE_LABELS,
  formatBpm,
  formatConfidence,
  formatPace,
  formatPaceVsTarget,
  SIGNAL_QUALITY_LABELS,
} from "./labels";

// Memoized: entry/sample keep their identity across page renders that don't
// touch the selection (e.g. the per-tick targetSecond ticker render), so the
// subtree is skipped. Rendered output is unchanged.
export const SummaryCards = memo(function SummaryCards({
  entry,
  sample,
}: {
  entry: DecisionEntry | null;
  sample: RunningSample | null;
}) {
  if (entry === null || sample === null) {
    return (
      <section className="cards" aria-label="Current decision summary">
        <p className="note">Press “Play” or “Step 1 s” to generate the first decision.</p>
      </section>
    );
  }

  const { trace } = entry;
  const metrics = trace.derivedMetrics;

  return (
    <section className="cards" aria-label="Current decision summary">
      <div className="card card-action" style={{ borderLeftColor: ACTION_COLORS[trace.action] }}>
        <span className="card-label">Current action</span>
        <span className="card-value" style={{ color: ACTION_COLORS[trace.action] }}>
          {ACTION_LABELS[trace.action]}
        </span>
        <span className="card-sub">
          {SOURCE_LABELS[trace.source]} · confidence {formatConfidence(trace.confidence)}
          {entry.reused ? " · reused decision" : ""}
        </span>
      </div>

      <div className="card">
        <span className="card-label">Pace vs target</span>
        <span className="card-value">{formatPace(metrics.paceWindowSecPerKm)}</span>
        <span className="card-sub">{formatPaceVsTarget(metrics.paceVsTargetSeconds)}</span>
      </div>

      <div className="card">
        <span className="card-label">Heart rate</span>
        <span className="card-value">{formatBpm(metrics.heartRateWindowBpm)}</span>
        <span className="card-sub">
          {heartRateZoneLabel(metrics.heartRateZonePosition ?? null)} · target {metrics.targetHeartRateZoneMin == null ? "—" : `Z${metrics.targetHeartRateZoneMin}–Z${metrics.targetHeartRateZoneMax}`}
          {" · "}{metrics.hrTrendBpmPerMin === null
            ? "Trend: —"
            : `Trend: ${metrics.hrTrendBpmPerMin >= 0 ? "+" : "−"}${Math.abs(metrics.hrTrendBpmPerMin).toFixed(1)} bpm/min`}
        </span>
      </div>

      <div className="card">
        <span className="card-label">RPE and grade</span>
        <span className="card-value">{sample.rpe !== undefined ? `RPE ${sample.rpe}` : "RPE —"}</span>
        <span className="card-sub">Grade: {sample.gradePct.toFixed(1)}%</span>
      </div>

      <div className="card">
        <span className="card-label">Signal</span>
        <span className="card-value">
          {SIGNAL_QUALITY_LABELS[sample.signalQuality] ?? sample.signalQuality}
        </span>
        <span className="card-sub">Freshness: {sample.dataAgeSeconds} s ago</span>
      </div>
    </section>
  );
});
