"use client";

/**
 * Summary cards row: current action with traffic-light color, confidence and
 * origin, pace vs target, HR + trend, RPE + grade, signal quality/freshness,
 * history maturity + baseline. Values come from the selected decision trace.
 */

import type { AthleteBaseline } from "@/domain/metrics";
import type { RunningSample } from "@/domain/types";
import type { DecisionEntry } from "./useRaceSimulation";
import {
  ACTION_COLORS,
  ACTION_LABELS,
  SOURCE_LABELS,
  MATURITY_LABELS,
  formatBpm,
  formatConfidence,
  formatPace,
  formatPaceVsTarget,
  SIGNAL_QUALITY_LABELS,
} from "./labels";

export function SummaryCards({
  entry,
  sample,
  baseline,
}: {
  entry: DecisionEntry | null;
  sample: RunningSample | null;
  baseline: AthleteBaseline;
}) {
  if (entry === null || sample === null) {
    return (
      <section className="cards" aria-label="Resumen de la decisión actual">
        <p className="note">Pulsa «Reproducir» o «Avanzar 1 s» para generar la primera decisión.</p>
      </section>
    );
  }

  const { trace } = entry;
  const metrics = trace.derivedMetrics;

  const baselineText =
    baseline.typicalEasyPaceSecPerKm !== undefined || baseline.typicalEasyHrBpm !== undefined
      ? `Línea base: ${formatPace(baseline.typicalEasyPaceSecPerKm ?? null)} · ${formatBpm(baseline.typicalEasyHrBpm ?? null)}`
      : "Sin línea base histórica";

  return (
    <section className="cards" aria-label="Resumen de la decisión actual">
      <div className="card card-action" style={{ borderLeftColor: ACTION_COLORS[trace.action] }}>
        <span className="card-label">Acción actual</span>
        <span className="card-value" style={{ color: ACTION_COLORS[trace.action] }}>
          {ACTION_LABELS[trace.action]}
        </span>
        <span className="card-sub">
          {SOURCE_LABELS[trace.source]} · confianza {formatConfidence(trace.confidence)}
          {entry.reused ? " · decisión reutilizada" : ""}
        </span>
      </div>

      <div className="card">
        <span className="card-label">Ritmo vs objetivo</span>
        <span className="card-value">{formatPace(metrics.paceWindowSecPerKm)}</span>
        <span className="card-sub">{formatPaceVsTarget(metrics.paceVsTargetSeconds)}</span>
      </div>

      <div className="card">
        <span className="card-label">Frecuencia cardíaca</span>
        <span className="card-value">{formatBpm(metrics.heartRateWindowBpm)}</span>
        <span className="card-sub">
          {metrics.hrTrendBpmPerMin === null
            ? "Tendencia: —"
            : `Tendencia: ${metrics.hrTrendBpmPerMin >= 0 ? "+" : "−"}${Math.abs(metrics.hrTrendBpmPerMin).toFixed(1)} ppm/min`}
        </span>
      </div>

      <div className="card">
        <span className="card-label">RPE y pendiente</span>
        <span className="card-value">{sample.rpe !== undefined ? `RPE ${sample.rpe}` : "RPE —"}</span>
        <span className="card-sub">Pendiente: {sample.gradePct.toFixed(1)}%</span>
      </div>

      <div className="card">
        <span className="card-label">Señal</span>
        <span className="card-value">
          {SIGNAL_QUALITY_LABELS[sample.signalQuality] ?? sample.signalQuality}
        </span>
        <span className="card-sub">Frescura: hace {sample.dataAgeSeconds} s</span>
      </div>

      <div className="card">
        <span className="card-label">Historial</span>
        <span className="card-value">{MATURITY_LABELS[metrics.historyMaturity]}</span>
        <span className="card-sub">{baselineText}</span>
      </div>
    </section>
  );
}
