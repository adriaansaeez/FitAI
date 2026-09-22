"use client";

import {
  IconAlertTriangle,
  IconArrowDown,
  IconArrowUp,
  IconArrowsDown,
  IconArrowsUp,
  IconEqual,
  IconHeartRateMonitor,
  IconPlayerStop,
  IconRun,
} from "@tabler/icons-react";
import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceArea,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DecisionAction, PaceTargetSecPerKm, RunningSample } from "@/domain/types";
import type { DecisionEntry } from "./useRaceSimulation";
import {
  ACTION_LABELS,
  SOURCE_LABELS,
  formatBpm,
  formatConfidence,
  formatPace,
  formatSecondTick,
  reasonLabel,
} from "./labels";

type LivePoint = {
  second: number;
  pace: number | null;
  decisionPace: number | null;
  action?: DecisionAction;
};

function formatElapsed(second: number): string {
  const minutes = Math.floor(second / 60);
  return `${String(minutes).padStart(2, "0")}:${String(second % 60).padStart(2, "0")}`;
}

function ActionIcon({ action, size = 22 }: { action: DecisionAction; size?: number }) {
  const props = { size, stroke: 2.2, "aria-hidden": true } as const;
  switch (action) {
    case "increase_gently":
      return <IconArrowUp {...props} />;
    case "maintain":
      return <IconEqual {...props} />;
    case "decrease_gently":
      return <IconArrowDown {...props} />;
    case "recover":
      return <IconArrowsDown {...props} />;
    case "insufficient_data":
      return <IconAlertTriangle {...props} />;
    case "stop_and_escalate":
      return <IconPlayerStop {...props} />;
  }
}

function decisionMarker(props: unknown) {
  const { cx, cy } = (props ?? {}) as { cx?: number; cy?: number };
  if (cx === undefined || cy === undefined) return <g />;
  return <circle cx={cx} cy={cy} r={4} fill="#0060d0" stroke="#ffffff" strokeWidth={2} />;
}

export function latestEvaluations(entries: readonly DecisionEntry[]): DecisionEntry[] {
  return entries.filter((entry) => !entry.reused).slice(-5).reverse();
}

export function LiveSimulationPanel({
  entries,
  samples,
  targetPaceSecPerKm,
}: {
  entries: DecisionEntry[];
  samples: RunningSample[];
  targetPaceSecPerKm: PaceTargetSecPerKm | null;
}) {
  const current = entries[entries.length - 1] ?? null;
  const liveSecond = current?.second ?? 0;
  const liveSample = liveSecond > 0 ? samples[liveSecond - 1] ?? null : null;

  const chartData = useMemo<LivePoint[]>(() => {
    const evaluated = new Map(
      entries.filter((entry) => !entry.reused).map((entry) => [entry.second, entry.trace.action]),
    );
    return samples.slice(0, liveSecond).map((sample) => {
      const action = evaluated.get(sample.second);
      return {
        second: sample.second,
        pace: sample.paceSecPerKm,
        decisionPace: action === undefined ? null : sample.paceSecPerKm,
        ...(action === undefined ? {} : { action }),
      };
    });
  }, [entries, liveSecond, samples]);

  const recent = useMemo(() => latestEvaluations(entries), [entries]);
  const paceValues = chartData
    .map((point) => point.pace)
    .filter((pace): pace is number => pace !== null);
  const paceDomain: [number, number] =
    paceValues.length === 0
      ? [280, 380]
      : [Math.max(60, Math.min(...paceValues) - 10), Math.max(...paceValues) + 10];

  return (
    <section className="live-panel" aria-label="Real-time simulation">
      <div className="simulated-watch">
        <div className="watch-crown" aria-hidden="true" />
        <div className="watch-screen">
          <div className="watch-topline">
            <span>SIMULATION</span>
            <IconRun size={16} stroke={2.2} aria-hidden="true" />
          </div>
          <strong className="watch-timer">{formatElapsed(liveSecond)}</strong>
          <div className="watch-metric watch-pace">
            <span>RITMO</span>
            <strong>{liveSample === null ? "--:--" : formatPace(current?.trace.derivedMetrics.paceWindowSecPerKm)}</strong>
          </div>
          <div className="watch-metric">
            <span><IconHeartRateMonitor size={15} stroke={2.2} aria-hidden="true" /> HEART RATE</span>
            <strong>{liveSample === null ? "---" : formatBpm(current?.trace.derivedMetrics.heartRateWindowBpm)}</strong>
          </div>
          <div className="watch-decision" aria-label={current === null ? "No decision" : ACTION_LABELS[current.trace.action]}>
            {current === null ? <IconArrowsUp size={23} stroke={2.2} aria-hidden="true" /> : <ActionIcon action={current.trace.action} size={24} />}
            <span>{current === null ? "STANDBY" : ACTION_LABELS[current.trace.action].toUpperCase()}</span>
          </div>
        </div>
      </div>

      <div className="live-analysis">
        <div className="live-chart-heading">
          <div>
            <h2>Live performance</h2>
            <p>Processed pace and decision signals.</p>
          </div>
          <span className="live-status">{liveSecond === 0 ? "Ready" : `s ${liveSecond}`}</span>
        </div>
        <div className="live-chart" aria-label="Real-time pace and decision chart">
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chartData} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#f2f2f0" vertical={false} />
              <XAxis dataKey="second" tick={{ fontSize: 11, fill: "#43423f" }} tickFormatter={formatSecondTick} />
              <YAxis domain={paceDomain} width={42} tick={{ fontSize: 11, fill: "#43423f" }} tickFormatter={(value: number) => formatSecondTick(value)} />
              <Tooltip
                labelFormatter={(label) => `Second ${String(label)}`}
                formatter={(value) => [formatPace(typeof value === "number" ? value : null), "Pace"]}
              />
              {targetPaceSecPerKm !== null ? (
                <ReferenceArea y1={targetPaceSecPerKm.min} y2={targetPaceSecPerKm.max} fill="#fc5200" fillOpacity={0.1} />
              ) : null}
              <Area type="monotone" dataKey="pace" stroke="#fc5200" strokeWidth={2.5} fill="#fc5200" fillOpacity={0.16} connectNulls isAnimationActive={false} />
              <Scatter dataKey="decisionPace" shape={decisionMarker} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="live-log" aria-label="Latest five evaluations">
          <div className="live-log-heading">
            <h3>Latest decisions</h3>
            <span>Confidence</span>
          </div>
          {recent.length === 0 ? (
            <p className="note">Start the simulation to see decisions.</p>
          ) : (
            <ol>
              {recent.map((entry) => {
                const reason = entry.trace.reasonCodes.at(-1);
                return (
                  <li key={entry.second}>
                    <span className="decision-log-icon"><ActionIcon action={entry.trace.action} size={18} /></span>
                    <span className="decision-log-copy">
                      <strong>{ACTION_LABELS[entry.trace.action]}</strong>
                      <small>s {entry.second} · {SOURCE_LABELS[entry.trace.source]}{reason === undefined ? "" : ` · ${reasonLabel(reason)}`}</small>
                    </span>
                    <strong className="decision-log-confidence">{formatConfidence(entry.trace.confidence)}</strong>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}
