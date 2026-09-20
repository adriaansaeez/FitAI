/**
 * Spanish runner-facing message templates.
 *
 * Messages are template strings with named placeholders; no model free text
 * ever reaches the runner. Placeholders are rendered with renderDecisionMessage.
 */

export const DECISION_MESSAGE_TEMPLATES: Record<string, string> = {
  // stop_and_escalate
  "decision.stop_and_escalate": "Nos detenemos. Has reportado un síntoma; detén la carrera y busca apoyo antes de continuar.",
  "decision.stop_and_escalate.symptoms_reported":
    "Nos detenemos. Has reportado un síntoma; detén la carrera y busca apoyo antes de continuar.",

  // insufficient_data
  "decision.insufficient_data":
    "Datos insuficientes en este momento. Mantenemos el ritmo actual hasta recuperar señal.",
  "decision.insufficient_data.low_signal_quality":
    "Señal de baja calidad. Mantenemos el ritmo actual hasta recuperar una lectura fiable.",
  "decision.insufficient_data.stale_data":
    "Los datos tienen más de 15 s de retraso. Mantenemos el ritmo hasta que se actualicen.",
  "decision.insufficient_data.auto_paused":
    "La sesión está en autopausa. Reanuda la carrera para volver a evaluar.",
  "decision.insufficient_data.missing_required_metrics":
    "Faltan ritmo o frecuencia cardíaca. No podemos evaluar el esfuerzo sin estas métricas.",

  // maintain
  "decision.maintain": "Mantenemos el ritmo actual.",
  "decision.maintain.normal_variation": "Todo dentro de lo esperado. Mantenemos el ritmo actual.",
  "decision.maintain.uphill_or_terrain": "Estamos en subida. El ritmo lento es terreno, no falta de esfuerzo: mantenemos el ritmo.",
  "decision.maintain.pace_below_target": "Vas por debajo del rango objetivo. Mantenemos el ritmo por ahora.",
  "decision.maintain.likely_heat_or_fatigue": "Mantenemos el ritmo y seguimos observando la tendencia de FC.",
  "decision.maintain.low_choice_confidence": "No hay suficiente certeza para cambiar el ritmo: mantenemos.",
  "decision.maintain.choice_confidence_missing": "No hay suficiente certeza para cambiar el ritmo: mantenemos.",
  "decision.maintain.low_interpretability": "El contexto no es suficientemente claro: mantenemos el ritmo.",
  "decision.maintain.provider_unavailable": "El proveedor de decisiones no está disponible: mantenemos el ritmo y la carrera continúa.",
  "decision.maintain.cooldown_no_opposite_change":
    "Periodo de espera tras un cambio de ritmo: mantenemos el ritmo actual.",
  "decision.maintain.increase_not_easy_block": "Los aumentos solo se permiten en bloques easy: mantenemos.",
  "decision.maintain.increase_blocked_by_safety": "La política de seguridad no permite subir el ritmo: mantenemos.",
  "decision.maintain.disproportionate_effort_risk":
    "El esfuerzo parece desproporcionado para el objetivo actual: mantenemos el ritmo.",

  // increase_gently
  "decision.increase_gently":
    "Puedes subir el ritmo con suavidad: {increaseSecPerKm} s/km durante los próximos 60 s.",
  "decision.increase_gently.increase_adjustment_limited_5_10_sec_per_km":
    "Subida suave: ajusta entre 5 y 10 s/km más rápido durante los próximos 60 s.",

  // decrease_gently
  "decision.decrease_gently":
    "Bajamos el ritmo con suavidad: {decreaseSecPerKm} s/km durante los próximos 60 s.",
  "decision.decrease_gently.likely_heat_or_fatigue":
    "La FC va en aumento: bajamos el ritmo entre 5 y 15 s/km más lento.",
  "decision.decrease_gently.decrease_adjustment_limited_5_15_sec_per_km":
    "Bajada suave: ajusta entre 5 y 15 s/km más lento durante los próximos 60 s.",

  // recover
  "decision.recover":
    "Pasamos a recuperar: reduce el esfuerzo y camina si lo necesitas.",
  "decision.recover.likely_heat_or_fatigue":
    "La FC es muy alta para el objetivo: pasamos a recuperar.",
  "decision.recover.recover_reevaluation_pending":
    "Seguimos en recuperación; reevaluamos a los 90 s.",

  // safety transparency (never a runner instruction on its own)
  "decision.safety.no_increase_in_block":
    "En calentamiento o vuelta a la calma no se sube el ritmo.",
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
