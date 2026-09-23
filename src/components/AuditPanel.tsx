"use client";

/**
 * Audit panel for the selected second: derived metrics, safety guard results,
 * the four Jev questions with probabilities when present in the trace, the
 * final rule, the "reused decision" mark, and the real-race data origin
 * card (spec: real-race validation, item 6).
 */

import { memo } from "react";

import type { AthleteBaseline } from "@/domain/metrics";
import type { RaceDecisionEvaluation } from "@/domain/evaluation";
import type { RunningSample } from "@/domain/types";
import type { DecisionEntry } from "./useRaceSimulation";
import { heartRateZoneLabel } from "@/domain/heartRateZones";
import type { DataSource, RealRaceWindowPayload } from "./useRaceSimulation";
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

function Metric({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="audit-metric">
      <dt>{label}</dt>
      <dd title={title}>{value}</dd>
    </div>
  );
}

/** SHA-256 rendered truncated; the full hash stays in the title attribute. */
function formatSha256(sha256: string): string {
  return `${sha256.slice(0, 12)}…`;
}

/** Known actions get their runner-facing label; unknown strings stay verbatim. */
function evaluationActionLabel(action: string): string {
  return (ACTION_LABELS as Record<string, string>)[action] ?? action;
}

/** Format an HR trend in bpm/min, em dash when unavailable. */
function formatHrTrend(bpmPerMin: number | null): string {
  return bpmPerMin === null ? "—" : `${bpmPerMin.toFixed(2)} bpm/min`;
}

/**
 * Sixth audit card: the decision compared against the telemetry that followed
 * it (spec: "What is compared and what is not"). Observational only — the human
 * videoReview/assessment labels are never inferred nor rendered as assigned.
 */
function ObservedComparisonCard({ evaluation }: { evaluation: RaceDecisionEvaluation }) {
  return (
    <div className="audit-card">
      <h3>Observed comparison</h3>
      <dl className="audit-metrics">
        <Metric
          label="Decision evaluated"
          value={`${evaluationActionLabel(evaluation.action)} · s ${evaluation.decisionSecond}`}
        />
        <Metric
          label="Mean pace next 60 s"
          value={formatPace(evaluation.observedNext60s?.meanPaceSecPerKm ?? null)}
        />
        <Metric
          label="Mean HR next 60 s"
          value={formatBpm(evaluation.observedNext60s?.meanHeartRateBpm ?? null)}
        />
        <Metric
          label="HR trend next 60 s"
          value={formatHrTrend(evaluation.observedNext60s?.hrTrendBpmPerMin ?? null)}
        />
        <Metric
          label="Mean pace next 90 s"
          value={formatPace(evaluation.observedNext90s?.meanPaceSecPerKm ?? null)}
        />
        <Metric
          label="Mean HR next 90 s"
          value={formatBpm(evaluation.observedNext90s?.meanHeartRateBpm ?? null)}
        />
        <Metric
          label="HR trend next 90 s"
          value={formatHrTrend(evaluation.observedNext90s?.hrTrendBpmPerMin ?? null)}
        />
        <Metric
          label="Elevation delta (next 90 s)"
          value={
            evaluation.terrainDelta.elevationDeltaM === null
              ? "—"
              : `${evaluation.terrainDelta.elevationDeltaM.toFixed(1)} m`
          }
        />
        <Metric
          label="Mean grade (next 90 s)"
          value={
            evaluation.terrainDelta.meanGradePct === null
              ? "—"
              : `${evaluation.terrainDelta.meanGradePct.toFixed(1)} %`
          }
        />
      </dl>
      <p className="note">
        Observation only: video and the human assessment label are assigned
        outside the app; a later acceleration never validates an increase.
      </p>
    </div>
  );
}

function RealOriginCard({ realWindow }: { realWindow: RealRaceWindowPayload }) {
  return (
    <div className="audit-card">
      <h3>Data origin</h3>
      <dl className="audit-metrics">
        <Metric label="Athlete" value={realWindow.source.athlete} />
        <Metric label="Event" value={realWindow.source.event} />
        <Metric label="License" value={realWindow.source.license} />
        <Metric
          label="SHA-256"
          value={formatSha256(realWindow.source.sha256)}
          title={realWindow.source.sha256}
        />
        <Metric label="Seed" value={String(realWindow.seed)} />
        <Metric label="Start source index" value={String(realWindow.startSourceIndex)} />
        <Metric label="Preroll" value={`${realWindow.prerollSeconds} s`} />
        <Metric label="Visible duration" value={`${realWindow.visibleDurationSeconds} s`} />
        <Metric
          label="Window"
          value={`${realWindow.startTimestamp} → ${realWindow.endTimestamp}`}
        />
      </dl>
      <p className="note">Cadence: {realWindow.cadenceSemantics}</p>
      <p className="note">Symptoms: {realWindow.symptomsSource}</p>
    </div>
  );
}

// Memoized: the panel's props (selection, baseline, data source, real window,
// evaluation) keep their identity across page renders that don't touch the
// selection (e.g. the per-tick targetSecond ticker render), so the subtree is
// skipped. Rendered output is unchanged.
export const AuditPanel = memo(function AuditPanel({
  entry,
  sample,
  baseline: _baseline,
  dataSource = "synthetic",
  realWindow = null,
  evaluation = null,
}: {
  entry: DecisionEntry | null;
  sample: RunningSample | null;
  /** Unused today; kept so the panel API stays stable for future audit cards. */
  baseline: AthleteBaseline;
  dataSource?: DataSource;
  realWindow?: RealRaceWindowPayload | null;
  /** Real mode only: evaluation of the selected decision vs the observed next 60/90 s. */
  evaluation?: RaceDecisionEvaluation | null;
}) {
  if (entry === null || sample === null) {
    return (
      <section className="audit" aria-label="Decision audit">
        <p className="note">Select a second in the charts or in the table to audit its decision.</p>
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
      ? "Not available for this decision"
      : `p(unusable)=${(probabilities["0"] ?? 0).toFixed(2)} · p(limited)=${(probabilities["1"] ?? 0).toFixed(2)} · p(clear)=${(probabilities["2"] ?? 0).toFixed(2)}`;

  const jevQuestions: Array<{ question: string; answer: string; present: boolean }> = [
    {
      question: "1 · effort_action (action choice)",
      answer: `${ACTION_LABELS[trace.action]} · confidence ${formatConfidence(trace.confidence)}`,
      present: true,
    },
    {
      question: "2 · effort_disproportionate (disproportionate effort)",
      answer: "Not recorded in the trace; the composer guard applies it earlier",
      present: false,
    },
    {
      question: "3 · context_explanation (context explanation)",
      answer: "Not recorded in the trace; see reason codes",
      present: false,
    },
    {
      question: "4 · context_interpretability (context interpretability)",
      answer: interpretabilityText,
      present: probabilities !== undefined,
    },
  ];

  return (
    <section className="audit" aria-label={`Decision audit for second ${entry.second}`}>
      <h2 className="section-title">
        Audit · second {entry.second}
        {entry.reused ? <span className="badge badge-reused">reused decision</span> : null}
        {entry.fetchFailed ? <span className="badge badge-failed">network failure</span> : null}
      </h2>

      <div className="audit-grid">
        <div className="audit-card">
          <h3>Decision</h3>
          <p className="audit-action" style={{ color: ACTION_COLORS[trace.action] }}>
            {ACTION_LABELS[trace.action]}
          </p>
          <p>
            Source: {SOURCE_LABELS[trace.source]} · Confidence: {formatConfidence(trace.confidence)}
          </p>
          <p className="audit-rule">
            <strong>Final rule:</strong> {finalRuleMessage(trace)}
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
          <h3>Derived metrics</h3>
          <dl className="audit-metrics">
            <Metric label="Pace (window)" value={formatPace(metrics.paceWindowSecPerKm)} />
            <Metric label="HR (window)" value={formatBpm(metrics.heartRateWindowBpm)} />
            <Metric label="Current HR zone" value={heartRateZoneLabel(metrics.heartRateZonePosition ?? null)} />
            <Metric label="Target HR zone" value={metrics.targetHeartRateZoneMin == null ? "—" : `Z${metrics.targetHeartRateZoneMin}–Z${metrics.targetHeartRateZoneMax}`} />
            <Metric label="Time above zone ceiling" value={`${metrics.consecutiveSecondsAboveHeartRateZone ?? 0} s`} />
            <Metric
              label="HR trend"
              value={metrics.hrTrendBpmPerMin === null ? "—" : `${metrics.hrTrendBpmPerMin.toFixed(2)} ppm/min`}
            />
            <Metric label="Pace vs target" value={formatPaceVsTarget(metrics.paceVsTargetSeconds)} />
            <Metric label="Comparable sessions" value={String(metrics.comparableHistoryCount)} />
            <Metric label="History maturity" value={MATURITY_LABELS[metrics.historyMaturity]} />
            <Metric
              label="Pace delta vs history"
              value={metrics.historicalPaceDeltaSeconds === null ? "—" : `${metrics.historicalPaceDeltaSeconds.toFixed(1)} s/km`}
            />
            <Metric
              label="HR delta vs history"
              value={metrics.historicalHrDeltaBpm === null ? "—" : `${metrics.historicalHrDeltaBpm.toFixed(1)} ppm`}
            />
          </dl>
        </div>

        <div className="audit-card">
          <h3>Safety guards</h3>
          <ul className="reason-list">
            <li>Hard stop: {trace.safety.hardStop ? "yes" : "no"}</li>
            <li>May increase intensity: {trace.safety.mayIncreaseIntensity ? "yes" : "no"}</li>
            <li>Missing required metrics: {trace.safety.missingRequiredMetric ? "yes" : "no"}</li>
          </ul>
          {trace.safety.reasonCodes.length > 0 ? (
            <ul className="reason-list">
              {trace.safety.reasonCodes.map((code) => (
                <li key={code}>{reasonLabel(code)}</li>
              ))}
            </ul>
          ) : (
            <p className="note">No active safety codes.</p>
          )}
        </div>

        <div className="audit-card">
          <h3>Jev questions</h3>
          <ul className="jev-questions">
            {jevQuestions.map((item) => (
              <li key={item.question} className={item.present ? undefined : "jev-question-missing"}>
                <span className="jev-question">{item.question}</span>
                <span className="jev-answer">{item.answer}</span>
              </li>
            ))}
          </ul>
        </div>

        {dataSource === "real" && evaluation !== null ? (
          <ObservedComparisonCard evaluation={evaluation} />
        ) : null}

        {dataSource === "real" && realWindow !== null ? (
          <RealOriginCard realWindow={realWindow} />
        ) : (
          <div className="audit-card">
            <h3>Data origin</h3>
            <p className="note">Synthetic scenario</p>
          </div>
        )}
      </div>
    </section>
  );
});
