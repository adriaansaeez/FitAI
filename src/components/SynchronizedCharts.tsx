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
 */

import { useMemo } from "react";
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
import type { DecisionAction, RunningSample } from "@/domain/types";
import type { AthleteBaseline } from "@/domain/metrics";
import type { DecisionEntry } from "./useRaceSimulation";
import {
  ACTION_COLORS,
  ACTION_LABELS,
  ACTION_LEVELS,
  formatPace,
  formatSecondTick,
} from "./labels";

const AXIS_TICK = { fontSize: 10, fill: "#555" } as const;

interface SeriesPoint {
  second: number;
  pace: number | null;
  targetMin: number;
  targetMax: number;
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

const cursorProps = { stroke: "#1a1a1a", strokeWidth: 1, strokeDasharray: "4 3" };

function ChartFrame({
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
        aria-label={`${title}. Cursor en el segundo ${selectedSecond}.`}
        onClick={onClickToSecond(onSelect)}
      >
        {children}
      </div>
    </div>
  );
}

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

export function SynchronizedCharts({
  samples,
  baseline,
  historyEstablished,
  entries,
  selectedSecond,
  onSelect,
}: {
  samples: RunningSample[];
  baseline: AthleteBaseline;
  historyEstablished: boolean;
  entries: DecisionEntry[];
  selectedSecond: number;
  onSelect: (second: number) => void;
}) {
  const series = useMemo<SeriesPoint[]>(
    () =>
      samples.map((sample) => ({
        second: sample.second,
        pace: sample.paceSecPerKm,
        targetMin: 315,
        targetMax: 330,
        hr: sample.heartRateBpm,
        elevation: sample.elevationM,
        grade: sample.gradePct,
        rpe: sample.rpe ?? null,
      })),
    [samples],
  );

  const decisionSeries = useMemo<DecisionPoint[]>(
    () =>
      entries.map((entry) => ({
        second: entry.second,
        level: ACTION_LEVELS[entry.trace.action],
        action: entry.trace.action,
        reused: entry.reused,
      })),
    [entries],
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
  const hasHrReference = baseline.typicalEasyHrBpm !== undefined;

  return (
    <section className="charts" aria-label="Gráficas sincronizadas">
      <p className="note">
        Segundo seleccionado: <strong>{selectedSecond}</strong>. Haz clic en cualquier gráfica
        para mover el cursor y sincronizar tabla y auditoría.
      </p>

      <ChartFrame title="1 · Ritmo vs rango objetivo" onSelect={onSelect} selectedSecond={selectedSecond}>
        <ResponsiveContainer width="100%" height={150}>
          <ComposedChart data={series} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#eee" />
            <XAxis dataKey="second" type="number" domain={[1, 600]} tick={AXIS_TICK} tickFormatter={formatSecondTick} />
            <YAxis domain={[290, 370]} tick={AXIS_TICK} width={38} tickFormatter={(v: number) => formatSecondTick(v).replace(" ", "")} />
            <Tooltip labelFormatter={(label) => `Segundo ${String(label)}`} formatter={(value) => formatPace(Number(value))} />
            <ReferenceArea y1={315} y2={330} fill="#dfe7df" fillOpacity={0.6} />
            <ReferenceLine x={selectedSecond} {...cursorProps} />
            <Line type="monotone" dataKey="pace" stroke="#2b4a6f" dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartFrame>

      <ChartFrame title="2 · Frecuencia cardíaca" onSelect={onSelect} selectedSecond={selectedSecond}>
        <ResponsiveContainer width="100%" height={150}>
          <ComposedChart data={series} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#eee" />
            <XAxis dataKey="second" type="number" domain={[1, 600]} tick={AXIS_TICK} tickFormatter={formatSecondTick} />
            <YAxis domain={["auto", "auto"]} tick={AXIS_TICK} width={38} />
            <Tooltip labelFormatter={(label) => `Segundo ${String(label)}`} formatter={(value) => `${Math.round(Number(value))} ppm`} />
            {hasHrReference ? (
              <ReferenceLine
                y={baseline.typicalEasyHrBpm}
                stroke="#8d6e63"
                strokeDasharray="5 4"
                label={{ value: "ref. histórica", fontSize: 10, position: "insideTopLeft" }}
              />
            ) : null}
            <ReferenceLine x={selectedSecond} {...cursorProps} />
            <Line type="monotone" dataKey="hr" stroke="#a13d3d" dot={false} connectNulls isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartFrame>

      <ChartFrame title="3 · Elevación y pendiente" onSelect={onSelect} selectedSecond={selectedSecond}>
        <ResponsiveContainer width="100%" height={150}>
          <ComposedChart data={series} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#eee" />
            <XAxis dataKey="second" type="number" domain={[1, 600]} tick={AXIS_TICK} tickFormatter={formatSecondTick} />
            <YAxis yAxisId="elev" tick={AXIS_TICK} width={38} />
            <YAxis yAxisId="grade" orientation="right" tick={AXIS_TICK} width={38} />
            <Tooltip labelFormatter={(label) => `Segundo ${String(label)}`} />
            <ReferenceLine x={selectedSecond} {...cursorProps} />
            <Area yAxisId="elev" type="monotone" dataKey="elevation" stroke="#5c7a5c" fill="#cfe0cf" fillOpacity={0.5} isAnimationActive={false} />
            <Line yAxisId="grade" type="monotone" dataKey="grade" stroke="#7a6a3d" dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartFrame>

      <ChartFrame title="4 · RPE" onSelect={onSelect} selectedSecond={selectedSecond}>
        <ResponsiveContainer width="100%" height={hasRpe ? 120 : 60}>
          {hasRpe ? (
            <ComposedChart data={series} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#eee" />
              <XAxis dataKey="second" type="number" domain={[1, 600]} tick={AXIS_TICK} tickFormatter={formatSecondTick} />
              <YAxis domain={[0, 10]} tick={AXIS_TICK} width={38} />
              <Tooltip labelFormatter={(label) => `Segundo ${String(label)}`} />
              <ReferenceLine x={selectedSecond} {...cursorProps} />
              <Line type="stepAfter" dataKey="rpe" stroke="#5b4a7a" dot={{ r: 2 }} connectNulls isAnimationActive={false} />
            </ComposedChart>
          ) : (
            <p className="note">Este escenario no genera valores de RPE.</p>
          )}
        </ResponsiveContainer>
      </ChartFrame>

      <ChartFrame title="5 · Decisiones por segundo" onSelect={onSelect} selectedSecond={selectedSecond}>
        <ResponsiveContainer width="100%" height={170}>
          <ComposedChart data={decisionSeries} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#eee" />
            <XAxis dataKey="second" type="number" domain={[1, 600]} tick={AXIS_TICK} tickFormatter={formatSecondTick} />
            <YAxis
              domain={[-1, 4]}
              ticks={[-1, 0, 1, 2, 3, 4]}
              tickFormatter={(value: number) => {
                const map: Record<number, string> = {
                  [-1]: "Detener",
                  0: "Insuf.",
                  1: "Recuperar",
                  2: "Bajar",
                  3: "Mantener",
                  4: "Subir",
                };
                return map[value] ?? "";
              }}
              tick={AXIS_TICK}
              width={68}
            />
            <Tooltip
              labelFormatter={(label) => `Segundo ${String(label)}`}
              formatter={(_value, _name, item) => {
                const action = (item?.payload as { action?: DecisionAction } | undefined)?.action;
                return [action !== undefined ? `${ACTION_LABELS[action]}` : "—", "Decisión"];
              }}
            />
            <ReferenceLine x={selectedSecond} {...cursorProps} />
            <Line type="stepAfter" dataKey="level" stroke="#b9b9b9" dot={false} isAnimationActive={false} />
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
      </ChartFrame>

      <ChartFrame title="6 · Ritmo por segmento (60 s) vs mediana histórica" onSelect={onSelect} selectedSecond={selectedSecond}>
        <ResponsiveContainer width="100%" height={historyEstablished ? 150 : 60}>
          {historyEstablished ? (
            <ComposedChart data={segmentSeries} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#eee" />
              <XAxis dataKey="second" type="number" domain={[1, 600]} tick={AXIS_TICK} tickFormatter={formatSecondTick} />
              <YAxis domain={["auto", "auto"]} tick={AXIS_TICK} width={38} tickFormatter={(v: number) => formatSecondTick(v).replace(" ", "")} />
              <Tooltip labelFormatter={(label) => `Segmento desde el segundo ${String(label)}`} formatter={(value) => formatPace(Number(value))} />
              <ReferenceLine x={selectedSecond} {...cursorProps} />
              <Line type="monotone" dataKey="pace" stroke="#2b4a6f" dot={{ r: 3 }} isAnimationActive={false} />
              <Line type="monotone" dataKey="medianPace" stroke="#8d6e63" strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            </ComposedChart>
          ) : (
            <p className="note">
              La comparación con la mediana histórica se muestra solo con madurez
              establecida (4–10 sesiones comparables).
            </p>
          )}
        </ResponsiveContainer>
      </ChartFrame>
    </section>
  );
}
