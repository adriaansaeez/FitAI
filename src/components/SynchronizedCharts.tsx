"use client";

/**
 * Synchronized Recharts view with a common vertical cursor at the selected
 * second. Clicking any chart moves the cursor (charts + table + audit sync).
 *
 * Charts:
 * 1. Pace vs target range band.
 * 2. HR vs historical reference when available.
 * 3. Elevation + grade (dual axis).
 * 4. RPE when available.
 * 5. Decision ladder colored by action (computed seconds only).
 * 6. Pace per 60 s segment vs historical median (established maturity only).
 *
 * Render performance: each chart body is a memoized component whose only
 * per-tick prop is `selectedSecond`; every other prop (series data, domains,
 * toggles) is referentially stable across ticks. All recharts formatters are
 * module-level constants so axis/tooltip props never change identity.
 */

import { memo, useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DecisionAction, PaceTargetSecPerKm, RunningSample } from "@/domain/types";
import type { AthleteBaseline } from "@/domain/metrics";
import type { DecisionEntry } from "./useRaceSimulation";
import {
  ACTION_COLORS,
  ACTION_LABELS,
  ACTION_LEVELS,
  formatPace,
  formatSecondTick,
} from "./labels";

const AXIS_TICK = { fontSize: 10, fill: "#43423f" } as const;

interface SeriesPoint {
  second: number;
  pace: number | null;
  targetMin: number | null;
  targetMax: number | null;
  hr: number | null;
  elevation: number;
  grade: number;
  rpe: number | null;
}

interface SegmentPoint {
  second: number;
  pace: number | null;
  medianPace: number | null;
}

interface DecisionPoint {
  second: number;
  level: number;
  action: DecisionAction;
  reused: boolean;
}

function onClickToSecond(handler: (second: number) => void) {
  return (state: unknown) => {
    const label = (state as { activeLabel?: unknown } | null)?.activeLabel;
    const value = typeof label === "number" ? label : Number(label);
    if (Number.isFinite(value) && value >= 1) {
      handler(Math.round(value));
    }
  };
}

const cursorProps = { stroke: "#000000", strokeWidth: 1, strokeDasharray: "4 3" };

// Module-level constants shared by every chart: stable identities across
// ticks, identical values to the previous inline literals.
const CHART_MARGIN = { top: 5, right: 10, bottom: 0, left: 0 };
const RPE_DOT = { r: 2 };
const SEGMENT_DOT = { r: 3 };
const HR_REFERENCE_LABEL = {
  value: "historical ref.",
  fontSize: 10,
  position: "insideTopLeft",
} as const;

// Hoisted recharts formatters. None capture component-scope values, so each
// is a stable module-level constant (previously recreated every render).
const paceYTickFormatter = (value: number) => formatSecondTick(value).replace(" ", "");

const secondLabelFormatter = (label: unknown) => `Second ${String(label)}`;
const segmentLabelFormatter = (label: unknown) => `Segment from second ${String(label)}`;

const paceTooltipFormatter = (value: unknown) => formatPace(Number(value));
const bpmTooltipFormatter = (value: unknown) => `${Math.round(Number(value))} bpm`;

const DECISION_LEVEL_LABELS: Record<number, string> = {
  [-1]: "Stop",
  0: "Low",
  1: "Recover",
  2: "Down",
  3: "Hold",
  4: "Up",
};
const decisionTickFormatter = (value: number) => DECISION_LEVEL_LABELS[value] ?? "";

const decisionTooltipFormatter = (
  _value: unknown,
  _name: unknown,
  item: unknown,
): [React.ReactNode, React.ReactNode] => {
  const action = (item as { payload?: { action?: DecisionAction } } | null | undefined)?.payload
    ?.action;
  return [action !== undefined ? `${ACTION_LABELS[action]}` : "—", "Decision"];
};

const ChartFrame = memo(function ChartFrame({
  title,
  children,
  onSelect,
  selectedSecond,
}: {
  title: string;
  children: React.ReactNode;
  onSelect: (second: number) => void;
  selectedSecond: number;
}) {
  return (
    <div className="chart-block">
      <h3 className="chart-title">{title}</h3>
      <div
        className="chart-box"
        role="img"
        aria-label={`${title}. Cursor at second ${selectedSecond}.`}
        onClick={onClickToSecond(onSelect)}
      >
        {children}
      </div>
    </div>
  );
});

function decisionDot(props: unknown) {
  const { cx, cy, payload } = (props ?? {}) as {
    cx?: number;
    cy?: number;
    payload?: { action?: DecisionAction };
  };
  if (cx === undefined || cy === undefined || payload?.action === undefined) {
    return <g key={`dot-${cx ?? "x"}-${cy ?? "y"}`} />;
  }
  return (
    <circle
      key={`dot-${cx}-${cy}`}
      cx={cx}
      cy={cy}
      r={3.5}
      fill={ACTION_COLORS[payload.action]}
    />
  );
}

const PaceChart = memo(function PaceChart({
  series,
  xDomain,
  paceYDomain,
  targetPaceSecPerKm,
  selectedSecond,
}: {
  series: SeriesPoint[];
  xDomain: [number, number];
  paceYDomain: [number, number];
  targetPaceSecPerKm: PaceTargetSecPerKm | null;
  selectedSecond: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={150}>
      <ComposedChart data={series} margin={CHART_MARGIN}>
        <CartesianGrid stroke="#f2f2f0" />
        <XAxis dataKey="second" type="number" domain={xDomain} tick={AXIS_TICK} tickFormatter={formatSecondTick} />
        <YAxis domain={paceYDomain} tick={AXIS_TICK} width={38} tickFormatter={paceYTickFormatter} />
        <Tooltip labelFormatter={secondLabelFormatter} formatter={paceTooltipFormatter} />
        {targetPaceSecPerKm !== null ? (
          <ReferenceArea
            y1={targetPaceSecPerKm.min}
            y2={targetPaceSecPerKm.max}
            fill="#fc5200"
            fillOpacity={0.6}
          />
        ) : null}
        <ReferenceLine x={selectedSecond} {...cursorProps} />
        <Line type="monotone" dataKey="pace" stroke="#fc5200" dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
});

const HeartRateChart = memo(function HeartRateChart({
  series,
  xDomain,
  hrReferenceBpm,
  selectedSecond,
}: {
  series: SeriesPoint[];
  xDomain: [number, number];
  hrReferenceBpm: number | undefined;
  selectedSecond: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={150}>
      <ComposedChart data={series} margin={CHART_MARGIN}>
        <CartesianGrid stroke="#f2f2f0" />
        <XAxis dataKey="second" type="number" domain={xDomain} tick={AXIS_TICK} tickFormatter={formatSecondTick} />
        <YAxis domain={["auto", "auto"]} tick={AXIS_TICK} width={38} />
        <Tooltip labelFormatter={secondLabelFormatter} formatter={bpmTooltipFormatter} />
        {hrReferenceBpm !== undefined ? (
          <ReferenceLine
            y={hrReferenceBpm}
            stroke="#0060d0"
            strokeDasharray="5 4"
            label={HR_REFERENCE_LABEL}
          />
        ) : null}
        <ReferenceLine x={selectedSecond} {...cursorProps} />
        <Line type="monotone" dataKey="hr" stroke="#fc5200" dot={false} connectNulls isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
});

const ElevationGradeChart = memo(function ElevationGradeChart({
  series,
  xDomain,
  selectedSecond,
}: {
  series: SeriesPoint[];
  xDomain: [number, number];
  selectedSecond: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={150}>
      <ComposedChart data={series} margin={CHART_MARGIN}>
        <CartesianGrid stroke="#f2f2f0" />
        <XAxis dataKey="second" type="number" domain={xDomain} tick={AXIS_TICK} tickFormatter={formatSecondTick} />
        <YAxis yAxisId="elev" tick={AXIS_TICK} width={38} />
        <YAxis yAxisId="grade" orientation="right" tick={AXIS_TICK} width={38} />
        <Tooltip labelFormatter={secondLabelFormatter} />
        <ReferenceLine x={selectedSecond} {...cursorProps} />
        <Area yAxisId="elev" type="monotone" dataKey="elevation" stroke="#0060d0" fill="#0060d0" fillOpacity={0.16} isAnimationActive={false} />
        <Line yAxisId="grade" type="monotone" dataKey="grade" stroke="#fc5200" dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
});

const RpeChart = memo(function RpeChart({
  series,
  xDomain,
  hasRpe,
  selectedSecond,
}: {
  series: SeriesPoint[];
  xDomain: [number, number];
  hasRpe: boolean;
  selectedSecond: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={hasRpe ? 120 : 60}>
      {hasRpe ? (
        <ComposedChart data={series} margin={CHART_MARGIN}>
          <CartesianGrid stroke="#f2f2f0" />
          <XAxis dataKey="second" type="number" domain={xDomain} tick={AXIS_TICK} tickFormatter={formatSecondTick} />
          <YAxis domain={[0, 10]} tick={AXIS_TICK} width={38} />
          <Tooltip labelFormatter={secondLabelFormatter} />
          <ReferenceLine x={selectedSecond} {...cursorProps} />
          <Line type="stepAfter" dataKey="rpe" stroke="#0060d0" dot={RPE_DOT} connectNulls isAnimationActive={false} />
        </ComposedChart>
      ) : (
        <p className="note">This scenario does not generate RPE values.</p>
      )}
    </ResponsiveContainer>
  );
});

const DecisionChart = memo(function DecisionChart({
  decisionSeries,
  xDomain,
  selectedSecond,
}: {
  decisionSeries: DecisionPoint[];
  xDomain: [number, number];
  selectedSecond: number;
}) {
  return (
    <>
      <ResponsiveContainer width="100%" height={170}>
        <ComposedChart data={decisionSeries} margin={CHART_MARGIN}>
          <CartesianGrid stroke="#f2f2f0" />
          <XAxis dataKey="second" type="number" domain={xDomain} tick={AXIS_TICK} tickFormatter={formatSecondTick} />
          <YAxis
            domain={[-1, 4]}
            ticks={[-1, 0, 1, 2, 3, 4]}
            tickFormatter={decisionTickFormatter}
            tick={AXIS_TICK}
            width={68}
          />
          <Tooltip
            labelFormatter={secondLabelFormatter}
            formatter={decisionTooltipFormatter}
          />
          <ReferenceLine x={selectedSecond} {...cursorProps} />
          <Line type="stepAfter" dataKey="level" stroke="#43423f" dot={false} isAnimationActive={false} />
          <Scatter dataKey="level" shape={decisionDot} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="legend-row" aria-hidden="true">
        {(Object.keys(ACTION_COLORS) as DecisionAction[]).map((action) => (
          <span key={action} className="legend-item">
            <span className="legend-swatch" style={{ backgroundColor: ACTION_COLORS[action] }} />
            {ACTION_LABELS[action]}
          </span>
        ))}
      </div>
    </>
  );
});

const SegmentChart = memo(function SegmentChart({
  segmentSeries,
  xDomain,
  historyEstablished,
  selectedSecond,
}: {
  segmentSeries: SegmentPoint[];
  xDomain: [number, number];
  historyEstablished: boolean;
  selectedSecond: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={historyEstablished ? 150 : 60}>
      {historyEstablished ? (
        <ComposedChart data={segmentSeries} margin={CHART_MARGIN}>
          <CartesianGrid stroke="#f2f2f0" />
          <XAxis dataKey="second" type="number" domain={xDomain} tick={AXIS_TICK} tickFormatter={formatSecondTick} />
          <YAxis domain={["auto", "auto"]} tick={AXIS_TICK} width={38} tickFormatter={paceYTickFormatter} />
          <Tooltip labelFormatter={segmentLabelFormatter} formatter={paceTooltipFormatter} />
          <ReferenceLine x={selectedSecond} {...cursorProps} />
          <Line type="monotone" dataKey="pace" stroke="#fc5200" dot={SEGMENT_DOT} isAnimationActive={false} />
          <Line type="monotone" dataKey="medianPace" stroke="#0060d0" strokeDasharray="5 4" dot={false} isAnimationActive={false} />
        </ComposedChart>
      ) : (
        <p className="note">
          The historical median comparison is shown only with established
          maturity (4–10 comparable sessions).
        </p>
      )}
    </ResponsiveContainer>
  );
});

export function SynchronizedCharts({
  samples,
  baseline,
  historyEstablished,
  entries,
  selectedSecond,
  onSelect,
  targetPaceSecPerKm,
  totalSeconds,
}: {
  samples: RunningSample[];
  baseline: AthleteBaseline;
  historyEstablished: boolean;
  entries: DecisionEntry[];
  selectedSecond: number;
  onSelect: (second: number) => void;
  /** Published pace target; null in real-race mode (no verifiable target). */
  targetPaceSecPerKm: PaceTargetSecPerKm | null;
  /** Session length in seconds (equals samples.length; one sample per second). */
  totalSeconds: number;
}) {
  const series = useMemo<SeriesPoint[]>(
    () =>
      samples.map((sample) => ({
        second: sample.second,
        pace: sample.paceSecPerKm,
        targetMin: targetPaceSecPerKm?.min ?? null,
        targetMax: targetPaceSecPerKm?.max ?? null,
        hr: sample.heartRateBpm,
        elevation: sample.elevationM,
        grade: sample.gradePct,
        rpe: sample.rpe ?? null,
      })),
    [samples, targetPaceSecPerKm],
  );

  // Session-length X domain (spec: real-race validation, item 4). Guard so
  // recharts never receives an empty/invalid [1, 0] domain.
  const xDomain = useMemo<[number, number]>(
    () => [1, Math.max(totalSeconds, 1)],
    [totalSeconds],
  );

  // Pace Y range from the session's actual pace samples with ±10 s/km padding,
  // floored at a sensible lower bound; fixed fallback when there is no data.
  const paceYDomain = useMemo<[number, number]>(() => {
    const paces = samples
      .map((sample) => sample.paceSecPerKm)
      .filter((pace): pace is number => pace !== null);
    if (paces.length === 0) {
      return [290, 370];
    }
    const min = Math.max(60, Math.min(...paces) - 10);
    const max = Math.max(min + 1, Math.max(...paces) + 10);
    return [min, max];
  }, [samples]);

  // entries is append-only (useRaceSimulation only ever builds
  // [...prev, entry]; no other mutation exists), so content changes are fully
  // covered by the length plus the identity of the newest entry. Without this
  // the chart-5 series would be rebuilt on every tick even when no new
  // decision entry was appended.
  const lastEntry = entries[entries.length - 1];
  const decisionSeries = useMemo<DecisionPoint[]>(
    () =>
      entries.map((entry) => ({
        second: entry.second,
        level: ACTION_LEVELS[entry.trace.action],
        action: entry.trace.action,
        reused: entry.reused,
      })),
    // append-only deps by design (see comment above): entries.length + lastEntry
    [entries.length, lastEntry],
  );

  const segmentSeries = useMemo<SegmentPoint[]>(() => {
    const points: SegmentPoint[] = [];
    for (let start = 1; start <= samples.length; start += 60) {
      const window = samples.slice(start - 1, start - 1 + 60);
      const paces = window
        .map((sample) => sample.paceSecPerKm)
        .filter((pace): pace is number => pace !== null);
      const average =
        paces.length > 0 ? paces.reduce((sum, pace) => sum + pace, 0) / paces.length : null;
      points.push({
        second: start,
        pace: average,
        medianPace: baseline.typicalEasyPaceSecPerKm ?? null,
      });
    }
    return points;
  }, [samples, baseline]);

  const hasRpe = samples.some((sample) => sample.rpe !== undefined);

  return (
    <section className="charts" aria-label="Synchronized charts">
      <p className="note">
        Selected second: <strong>{selectedSecond}</strong>. Click any chart to
        move the cursor and sync the table and audit panel.
      </p>

      <ChartFrame title="1 · Pace vs target range" onSelect={onSelect} selectedSecond={selectedSecond}>
        <PaceChart
          series={series}
          xDomain={xDomain}
          paceYDomain={paceYDomain}
          targetPaceSecPerKm={targetPaceSecPerKm}
          selectedSecond={selectedSecond}
        />
      </ChartFrame>

      <ChartFrame title="2 · Heart rate" onSelect={onSelect} selectedSecond={selectedSecond}>
        <HeartRateChart
          series={series}
          xDomain={xDomain}
          hrReferenceBpm={baseline.typicalEasyHrBpm}
          selectedSecond={selectedSecond}
        />
      </ChartFrame>

      <ChartFrame title="3 · Elevation and grade" onSelect={onSelect} selectedSecond={selectedSecond}>
        <ElevationGradeChart
          series={series}
          xDomain={xDomain}
          selectedSecond={selectedSecond}
        />
      </ChartFrame>

      <ChartFrame title="4 · RPE" onSelect={onSelect} selectedSecond={selectedSecond}>
        <RpeChart
          series={series}
          xDomain={xDomain}
          hasRpe={hasRpe}
          selectedSecond={selectedSecond}
        />
      </ChartFrame>

      <ChartFrame title="5 · Decisions per second" onSelect={onSelect} selectedSecond={selectedSecond}>
        <DecisionChart
          decisionSeries={decisionSeries}
          xDomain={xDomain}
          selectedSecond={selectedSecond}
        />
      </ChartFrame>

      <ChartFrame title="6 · Pace per segment (60 s) vs historical median" onSelect={onSelect} selectedSecond={selectedSecond}>
        <SegmentChart
          segmentSeries={segmentSeries}
          xDomain={xDomain}
          historyEstablished={historyEstablished}
          selectedSecond={selectedSecond}
        />
      </ChartFrame>
    </section>
  );
}
