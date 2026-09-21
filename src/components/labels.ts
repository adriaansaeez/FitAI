/**
 * Spanish runner-facing labels for the demo UI, plus formatting helpers.
 *
 * All runner-facing strings live here or in src/domain/messageTemplates.ts;
 * no model free text is ever rendered.
 */

import type { DecisionAction, DecisionTrace } from "@/domain/types";
import {
  resolveDecisionMessageKey,
  renderDecisionMessage,
} from "@/domain/messageTemplates";
import type { ScenarioId } from "@/simulation/scenarios";
import type { DataSource } from "./useRaceSimulation";

export const ACTION_LABELS: Record<DecisionAction, string> = {
  increase_gently: "Subir suave",
  maintain: "Mantener",
  decrease_gently: "Bajar suave",
  recover: "Recuperar",
  insufficient_data: "Datos insuficientes",
  stop_and_escalate: "Detener y escalar",
};

/** Short labels for the decision chart Y axis. */
export const ACTION_SHORT_LABELS: Record<DecisionAction, string> = {
  increase_gently: "Subir",
  maintain: "Mantener",
  decrease_gently: "Bajar",
  recover: "Recuperar",
  insufficient_data: "Insuf.",
  stop_and_escalate: "Detener",
};

/** Sober traffic-light palette. Safety and stops dominate visually. */
export const ACTION_COLORS: Record<DecisionAction, string> = {
  increase_gently: "#fc5200",
  maintain: "#0060d0",
  decrease_gently: "#a83a00",
  recover: "#0060d0",
  insufficient_data: "#43423f",
  stop_and_escalate: "#b42318",
};

/**
 * Severity ladder for the decision chart: bottom = stop, top = increase.
 * Colored per-point by ACTION_COLORS.
 */
export const ACTION_LEVELS: Record<DecisionAction, number> = {
  stop_and_escalate: -1,
  insufficient_data: 0,
  recover: 1,
  decrease_gently: 2,
  maintain: 3,
  increase_gently: 4,
};

export const LEVEL_ACTION: Record<number, DecisionAction> = {
  [-1]: "stop_and_escalate",
  0: "insufficient_data",
  1: "recover",
  2: "decrease_gently",
  3: "maintain",
  4: "increase_gently",
};

export const SOURCE_LABELS: Record<DecisionTrace["source"], string> = {
  safety: "Seguridad",
  mock: "Simulación",
  jev: "Jev",
  composer: "Compositor",
};

export const SCENARIO_LABELS: Record<ScenarioId, string> = {
  "easy-under-target": "Fácil bajo objetivo",
  "cardiac-drift": "Deriva cardíaca",
  uphill: "Subida",
  "poor-signal": "Señal pobre",
  "symptom-stop": "Síntoma → detener",
  "inexperienced-runner": "Novato irregular",
};

/**
 * Data source selector: the synthetic scenarios vs the real Kona 2022 race
 * telemetry (spec: real-race validation, item 8).
 */
export const SOURCE_KIND_LABELS: Record<DataSource, string> = {
  synthetic: "Escenario sintético",
  real: "Carrera real: Kona 2022 — Gustav Iden",
};

/** Static note shown instead of the interval select in real mode (60 s cadence). */
export const REAL_MODE_INTERVAL_LABEL = "Intervalo de evaluación: 60 s (modo real)";

/** Note under the disabled history select in real mode. */
export const REAL_MODE_HISTORY_NOTE = "Historial no publicado";

/** Permanent attribution + limitations banner shown while real mode is active. */
export const REAL_MODE_ATTRIBUTION =
  "Telemetría real por Entalpi (CC BY-NC 4.0) — RPE, síntomas y plan de carrera no publicados; las decisiones son validación de coherencia, no diagnóstico.";

export const SIGNAL_QUALITY_LABELS: Record<string, string> = {
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

/** Short labels for the table's Historial column. */
export const MATURITY_SHORT_LABELS: Record<DecisionTrace["derivedMetrics"]["historyMaturity"], string> = {
  none: "—",
  early: "Provisional",
  established: "Establecida",
};

export const MATURITY_LABELS: Record<DecisionTrace["derivedMetrics"]["historyMaturity"], string> = {
  none: "Sin referencia personal; confianza limitada",
  early: "Referencia provisional (1–3 sesiones)",
  established: "Referencia establecida (4–10 sesiones)",
};

/** Spanish labels for composer/safety reason codes shown to the reader. */
export const REASON_LABELS: Record<string, string> = {
  provider_unavailable: "proveedor no disponible",
  low_choice_confidence: "baja confianza de la elección",
  choice_confidence_missing: "confianza de la elección ausente",
  low_interpretability: "contexto poco claro",
  increase_not_easy_block: "subida fuera de bloque easy",
  increase_blocked_by_safety: "seguridad impide subir",
  increase_at_heart_rate_zone_ceiling: "FC en el techo de la zona objetivo",
  disproportionate_effort_risk: "esfuerzo desproporcionado",
  cooldown_no_opposite_change: "espera tras cambio de ritmo",
  recover_reevaluation_pending: "reevaluación de recuperar pendiente",
  increase_adjustment_limited_5_10_sec_per_km: "subida limitada a 5–10 s/km",
  decrease_adjustment_limited_5_15_sec_per_km: "bajada limitada a 5–15 s/km",
  symptoms_reported: "síntoma reportado",
  low_signal_quality: "señal de baja calidad",
  stale_data: "datos retrasados",
  auto_paused: "autopausa",
  missing_required_metrics: "faltan ritmo o FC",
  no_increase_in_block: "el bloque no permite subir",
};

export function reasonLabel(code: string): string {
  return REASON_LABELS[code] ?? code;
}

export function primaryReason(trace: DecisionTrace): string | null {
  return trace.reasonCodes[trace.reasonCodes.length - 1] ?? null;
}

/**
 * Final runner-facing rule message: the most specific Spanish template for
 * the action + primary reason, rendered with the pilot adjustment limits.
 */
export function finalRuleMessage(trace: DecisionTrace): string {
  const key = resolveDecisionMessageKey(trace.action, primaryReason(trace));
  return renderDecisionMessage(key, {
    increaseSecPerKm: "5–10",
    decreaseSecPerKm: "5–15",
  });
}

/** Format seconds-per-km as m:ss /km. */
export function formatPace(secPerKm: number | null | undefined): string {
  if (secPerKm === null || secPerKm === undefined || !Number.isFinite(secPerKm)) {
    return "—";
  }
  const total = Math.round(secPerKm);
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds} /km`;
}

/** Format a signed seconds-per-km delta vs the target range. */
export function formatPaceVsTarget(delta: number | null | undefined): string {
  if (delta === null || delta === undefined) {
    return "—";
  }
  if (delta === 0) {
    return "Dentro del rango objetivo";
  }
  const sign = delta > 0 ? "+" : "−";
  return `${sign}${Math.abs(Math.round(delta))} s/km vs objetivo`;
}

export function formatConfidence(confidence: number | undefined): string {
  return confidence === undefined ? "—" : `${Math.round(confidence * 100)}%`;
}

export function formatBpm(bpm: number | null | undefined): string {
  return bpm === null || bpm === undefined ? "—" : `${Math.round(bpm)} ppm`;
}

/** mm:ss tick label for chart X axes (seconds). */
export function formatSecondTick(second: number): string {
  const m = Math.floor(second / 60);
  const s = String(Math.round(second % 60)).padStart(2, "0");
  return `${m}:${s}`;
}
