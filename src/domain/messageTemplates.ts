/**
 * English runner-facing message templates.
 *
 * Messages are template strings with named placeholders; no model free text
 * ever reaches the runner. Placeholders are rendered with renderDecisionMessage.
 */

export const DECISION_MESSAGE_TEMPLATES: Record<string, string> = {
  // stop_and_escalate
  "decision.stop_and_escalate": "We're stopping. You reported a symptom; stop the race and seek support before continuing.",
  "decision.stop_and_escalate.symptoms_reported":
    "We're stopping. You reported a symptom; stop the race and seek support before continuing.",

  // insufficient_data
  "decision.insufficient_data":
    "Not enough data right now. Holding your current pace until the signal recovers.",
  "decision.insufficient_data.low_signal_quality":
    "Low-quality signal. Holding your current pace until we get a reliable reading.",
  "decision.insufficient_data.stale_data":
    "Data is more than 15 s behind. Holding your pace until it refreshes.",
  "decision.insufficient_data.auto_paused":
    "The session is auto-paused. Resume the run to re-evaluate.",
  "decision.insufficient_data.missing_required_metrics":
    "Pace or heart rate is missing. We can't assess effort without these metrics.",

  // maintain
  "decision.maintain": "Holding your current pace.",
  "decision.maintain.normal_variation": "Everything looks as expected. Holding your current pace.",
  "decision.maintain.uphill_or_terrain": "We're on a climb. The slow pace is the terrain, not a lack of effort: holding your pace.",
  "decision.maintain.pace_below_target": "You're below the target range. Holding your pace for now.",
  "decision.maintain.likely_heat_or_fatigue": "Holding your pace while we keep an eye on the HR trend.",
  "decision.maintain.low_choice_confidence": "Not enough confidence to change pace: holding.",
  "decision.maintain.choice_confidence_missing": "Not enough confidence to change pace: holding.",
  "decision.maintain.low_interpretability": "The context isn't clear enough: holding your pace.",
  "decision.maintain.provider_unavailable": "The decision provider is unavailable: holding your pace and the run continues.",
  "decision.maintain.cooldown_no_opposite_change":
    "Cooldown period after a pace change: holding your current pace.",
  "decision.maintain.increase_not_easy_block": "Pace increases are only allowed in easy blocks: holding.",
  "decision.maintain.increase_blocked_by_safety": "The safety policy doesn't allow picking up the pace: holding.",
  "decision.maintain.disproportionate_effort_risk":
    "Effort looks disproportionate to the current target: holding your pace.",

  // increase_gently
  "decision.increase_gently":
    "You can ease the pace up gently: {increaseSecPerKm} s/km faster over the next 60 s.",
  "decision.increase_gently.increase_adjustment_limited_5_10_sec_per_km":
    "Gentle increase: adjust to 5 to 10 s/km faster over the next 60 s.",

  // decrease_gently
  "decision.decrease_gently":
    "We're easing off gently: {decreaseSecPerKm} s/km slower over the next 60 s.",
  "decision.decrease_gently.likely_heat_or_fatigue":
    "Your heart rate is climbing: easing off 5 to 15 s/km slower.",
  "decision.decrease_gently.decrease_adjustment_limited_5_15_sec_per_km":
    "Gentle decrease: adjust 5 to 15 s/km slower over the next 60 s.",

  // recover
  "decision.recover":
    "Switching to recovery: ease off and walk if you need to.",
  "decision.recover.likely_heat_or_fatigue":
    "Your heart rate is very high for the target: switching to recovery.",
  "decision.recover.recover_reevaluation_pending":
    "Still recovering; we'll re-evaluate at 90 s.",

  // safety transparency (never a runner instruction on its own)
  "decision.safety.no_increase_in_block":
    "No pace increases during warmup or cool-down.",
};

/** Build a template key for an action and optional primary reason code. */
export function decisionMessageKey(action: string, reasonCode: string | null): string {
  return reasonCode === null ? `decision.${action}` : `decision.${action}.${reasonCode}`;
}

/**
 * Resolve the most specific template key available, falling back from
 * `action.reason` to `action`.
 */
export function resolveDecisionMessageKey(action: string, reasonCode: string | null): string {
  const specific = decisionMessageKey(action, reasonCode);
  if (specific in DECISION_MESSAGE_TEMPLATES) {
    return specific;
  }
  return `decision.${action}`;
}

/** Render a template by replacing `{placeholder}` tokens with params. */
export function renderDecisionMessage(
  key: string,
  params: Record<string, string | number> = {},
): string {
  const template = DECISION_MESSAGE_TEMPLATES[key];
  if (template === undefined) {
    return key;
  }
  return template.replace(/\{(\w+)\}/g, (match, token: string) => {
    const value = params[token];
    return value === undefined ? match : String(value);
  });
}
