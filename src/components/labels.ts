/**
 * English runner-facing labels for the demo UI, plus formatting helpers.
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
  increase_gently: "Increase gently",
  maintain: "Maintain",
  decrease_gently: "Ease off",
  recover: "Recover",
  insufficient_data: "Insufficient data",
  stop_and_escalate: "Stop and escalate",
};

/** Short labels for the decision chart Y axis. */
export const ACTION_SHORT_LABELS: Record<DecisionAction, string> = {
  increase_gently: "Up",
  maintain: "Hold",
  decrease_gently: "Down",
  recover: "Recover",
  insufficient_data: "Low",
  stop_and_escalate: "Stop",
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
  safety: "Safety",
  mock: "Simulation",
  jev: "Jev",
  composer: "Composer",
};

export const SCENARIO_LABELS: Record<ScenarioId, string> = {
  "easy-under-target": "Easy, under target",
  "cardiac-drift": "Cardiac drift",
  uphill: "Uphill",
  "poor-signal": "Poor signal",
  "symptom-stop": "Symptom → stop",
  "inexperienced-runner": "Erratic novice",
};

/**
 * Data source selector: the synthetic scenarios vs the real Kona 2022 race
 * telemetry (spec: real-race validation, item 8).
 */
export const SOURCE_KIND_LABELS: Record<DataSource, string> = {
  synthetic: "Synthetic scenario",
  real: "Real race: Kona 2022 — Gustav Iden",
};

/** Static note shown instead of the interval select in real mode (60 s cadence). */
export const REAL_MODE_INTERVAL_LABEL = "Evaluation interval: 60 s (real mode)";

/** Note under the disabled history select in real mode. */
export const REAL_MODE_HISTORY_NOTE = "History not published";

/** Permanent attribution + limitations banner shown while real mode is active. */
export const REAL_MODE_ATTRIBUTION =
  "Real telemetry by Entalpi (CC BY-NC 4.0) — RPE, symptoms, and race plan not published; decisions are consistency validation, not diagnosis.";

export const SIGNAL_QUALITY_LABELS: Record<string, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Short labels for the table's History column. */
export const MATURITY_SHORT_LABELS: Record<DecisionTrace["derivedMetrics"]["historyMaturity"], string> = {
  none: "—",
  early: "Provisional",
  established: "Established",
};

export const MATURITY_LABELS: Record<DecisionTrace["derivedMetrics"]["historyMaturity"], string> = {
  none: "No personal reference; limited confidence",
  early: "Provisional reference (1–3 sessions)",
  established: "Established reference (4–10 sessions)",
};

/** English labels for composer/safety reason codes shown to the reader. */
export const REASON_LABELS: Record<string, string> = {
  provider_unavailable: "provider unavailable",
  low_choice_confidence: "low choice confidence",
  choice_confidence_missing: "choice confidence missing",
  low_interpretability: "unclear context",
  increase_not_easy_block: "increase outside easy block",
  increase_blocked_by_safety: "safety blocks increase",
  increase_at_heart_rate_zone_ceiling: "HR at target zone ceiling",
  disproportionate_effort_risk: "disproportionate effort",
  cooldown_no_opposite_change: "cooldown after pace change",
  recover_reevaluation_pending: "recover reevaluation pending",
  increase_adjustment_limited_5_10_sec_per_km: "increase limited to 5–10 s/km",
  decrease_adjustment_limited_5_15_sec_per_km: "decrease limited to 5–15 s/km",
  symptoms_reported: "symptom reported",
  low_signal_quality: "low-quality signal",
  stale_data: "stale data",
  auto_paused: "auto-paused",
  missing_required_metrics: "missing pace or HR",
  no_increase_in_block: "block does not allow increase",
};

export function reasonLabel(code: string): string {
  return REASON_LABELS[code] ?? code;
}

export function primaryReason(trace: DecisionTrace): string | null {
  return trace.reasonCodes[trace.reasonCodes.length - 1] ?? null;
}

/**
 * Final runner-facing rule message: the most specific English template for
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
    return "Within target range";
  }
  const sign = delta > 0 ? "+" : "−";
  return `${sign}${Math.abs(Math.round(delta))} s/km vs target`;
}

export function formatConfidence(confidence: number | undefined): string {
  return confidence === undefined ? "—" : `${Math.round(confidence * 100)}%`;
}

export function formatBpm(bpm: number | null | undefined): string {
  return bpm === null || bpm === undefined ? "—" : `${Math.round(bpm)} bpm`;
}

/** mm:ss tick label for chart X axes (seconds). */
export function formatSecondTick(second: number): string {
  const m = Math.floor(second / 60);
  const s = String(Math.round(second % 60)).padStart(2, "0");
  return `${m}:${s}`;
}
