"use client";

/**
 * Audit panel for the selected second: derived metrics, safety guard results,
 * the four Jev questions with probabilities when present in the trace, the
 * final rule, and the "decisión reutilizada" mark.
 */

import type { AthleteBaseline } from "@/domain/metrics";
import type { DecisionTrace, RunningSample } from "@/domain/types";
import type { DecisionEntry } from "./useRaceSimulation";
import {
  ACTION_COLORS,
  ACTION_LABELS,
  MATURITY_LABELS,
  SOURCE_LABELS,
  finalRuleMessage,
  formatBpm,
  formatConfidence,
  formatPace,
  formatPaceVsTarget,
  reasonLabel,
} from "./labels";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="audit-metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function AuditPanel({
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
      <section className="audit" aria-label="Auditoría de la decisión">
        <p className="note">Selecciona un segundo en las gráficas o en la tabla para auditar su decisión.</p>
      </section>
    );
  }

  const { trace } = entry;
  const metrics = trace.derivedMetrics;
  const probabilities = trace.probabilities;

  // The four Jev questions; only what the trace carries is shown, never free
  // text. Interpretability probabilities arrive as string keys "0" | "1" | "2".
  const interpretabilityText =
    probabilities === undefined
      ? "No disponible en esta decisión"
      : `p(inutilizable)=${(probabilities["0"] ?? 0).toFixed(2)} · p(limitado)=${(probabilities["1"] ?? 0).toFixed(2)} · p(claro)=${(probabilities["2"] ?? 0).toFixed(2)}`;

  const jevQuestions: Array<{ question: string; answer: string; present: boolean }> = [
    {
      question: "1 · effort_action (elección de acción)",
      answer: `${ACTION_LABELS[trace.action]} · confianza ${formatConfidence(trace.confidence)}`,
      present: true,
    },
    {
      question: "2 · effort_disproportionate (esfuerzo desproporcionado)",
      answer: "No registrado en la traza; la guarda del compositor la aplica antes",
      present: false,
    },
    {
      question: "3 · context_explanation (explicación del contexto)",
      answer: "No registrado en la traza; ver códigos de razón",
      present: false,
    },
    {
      question: "4 · context_interpretability (interpretabilidad del contexto)",
      answer: interpretabilityText,
      present: probabilities !== undefined,
    },
  ];

  return (
    <section className="audit" aria-label={`Auditoría de la decisión del segundo ${entry.second}`}>
      <h2 className="section-title">
        Auditoría · segundo {entry.second}
        {entry.reused ? <span className="badge badge-reused">decisión reutilizada</span> : null}
        {entry.fetchFailed ? <span className="badge badge-failed">fallo de red</span> : null}
      </h2>

      <div className="audit-grid">
        <div className="audit-card">
          <h3>Decisión</h3>
          <p className="audit-action" style={{ color: ACTION_COLORS[trace.action] }}>
            {ACTION_LABELS[trace.action]}
          </p>
          <p>
            Origen: {SOURCE_LABELS[trace.source]} · Confianza: {formatConfidence(trace.confidence)}
          </p>
          <p className="audit-rule">
            <strong>Regla final:</strong> {finalRuleMessage(trace)}
          </p>
          {trace.reasonCodes.length > 0 ? (
            <ul className="reason-list">
              {trace.reasonCodes.map((code) => (
                <li key={code}>{reasonLabel(code)}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="audit-card">
          <h3>Métricas derivadas</h3>
          <dl className="audit-metrics">
            <Metric label="Ritmo (ventana)" value={formatPace(metrics.paceWindowSecPerKm)} />
            <Metric label="FC (ventana)" value={formatBpm(metrics.heartRateWindowBpm)} />
            <Metric
              label="Tendencia FC"
              value={metrics.hrTrendBpmPerMin === null ? "—" : `${metrics.hrTrendBpmPerMin.toFixed(2)} ppm/min`}
            />
            <Metric label="Ritmo vs objetivo" value={formatPaceVsTarget(metrics.paceVsTargetSeconds)} />
            <Metric label="Sesiones comparables" value={String(metrics.comparableHistoryCount)} />
            <Metric label="Madurez del historial" value={MATURITY_LABELS[metrics.historyMaturity]} />
            <Metric
              label="Delta ritmo vs histórico"
              value={metrics.historicalPaceDeltaSeconds === null ? "—" : `${metrics.historicalPaceDeltaSeconds.toFixed(1)} s/km`}
            />
            <Metric
              label="Delta FC vs histórico"
              value={metrics.historicalHrDeltaBpm === null ? "—" : `${metrics.historicalHrDeltaBpm.toFixed(1)} ppm`}
            />
          </dl>
        </div>

        <div className="audit-card">
          <h3>Guardas de seguridad</h3>
          <ul className="reason-list">
            <li>Parada dura: {trace.safety.hardStop ? "sí" : "no"}</li>
            <li>Permitido subir intensidad: {trace.safety.mayIncreaseIntensity ? "sí" : "no"}</li>
            <li>Faltan métricas requeridas: {trace.safety.missingRequiredMetric ? "sí" : "no"}</li>
          </ul>
          {trace.safety.reasonCodes.length > 0 ? (
            <ul className="reason-list">
              {trace.safety.reasonCodes.map((code) => (
                <li key={code}>{reasonLabel(code)}</li>
              ))}
            </ul>
          ) : (
            <p className="note">Sin códigos de seguridad activos.</p>
          )}
        </div>

        <div className="audit-card">
          <h3>Preguntas de Jev</h3>
          <ul className="jev-questions">
            {jevQuestions.map((item) => (
              <li key={item.question} className={item.present ? undefined : "jev-question-missing"}>
                <span className="jev-question">{item.question}</span>
                <span className="jev-answer">{item.answer}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
