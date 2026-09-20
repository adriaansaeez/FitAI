"use client";

/**
 * Decision history table with plain windowing (60 rows at a time over the
 * 600-second run). Clicking a row syncs the charts and opens the audit panel.
 */

import { useEffect, useRef, useState } from "react";
import type { RunningSample } from "@/domain/types";
import type { DecisionEntry } from "./useRaceSimulation";
import {
  ACTION_COLORS,
  ACTION_LABELS,
  MATURITY_SHORT_LABELS,
  SOURCE_LABELS,
  formatConfidence,
  formatPace,
  reasonLabel,
} from "./labels";

const WINDOW_SIZE = 60;

export function DecisionTable({
  entries,
  samples,
  selectedSecond,
  onSelect,
}: {
  entries: DecisionEntry[];
  samples: RunningSample[];
  selectedSecond: number;
  onSelect: (second: number) => void;
}) {
  const [windowEnd, setWindowEnd] = useState(WINDOW_SIZE);
  const prevEntryCountRef = useRef(0);

  // Follow the frontier while the user is watching the latest window.
  useEffect(() => {
    if (windowEnd >= prevEntryCountRef.current) {
      setWindowEnd(entries.length);
    }
    prevEntryCountRef.current = entries.length;
  }, [entries.length, windowEnd]);

  if (entries.length === 0) {
    return (
      <section className="table-section" aria-label="Historial de decisiones">
        <p className="note">Aún no hay decisiones; inicia la simulación.</p>
      </section>
    );
  }

  const start = Math.max(0, Math.min(windowEnd - WINDOW_SIZE, entries.length - 1));
  const end = Math.min(windowEnd, entries.length);
  const visible = entries.slice(start, end);

  return (
    <section className="table-section" aria-label="Historial de decisiones">
      <div className="table-header-row">
        <h2 className="section-title">Historial de decisiones</h2>
        <div className="pager">
          <button
            type="button"
            className="btn"
            onClick={() => setWindowEnd((current) => Math.max(WINDOW_SIZE, current - WINDOW_SIZE))}
            disabled={start === 0}
          >
            ← Anteriores
          </button>
          <span className="pager-label">
            {start + 1}–{end} de {entries.length}
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => setWindowEnd((current) => Math.min(entries.length, current + WINDOW_SIZE))}
            disabled={end >= entries.length}
          >
            Siguientes →
          </button>
        </div>
      </div>

      <div className="table-scroll">
        <table className="decision-table">
          <thead>
            <tr>
              <th scope="col">Segundo</th>
              <th scope="col">Acción</th>
              <th scope="col">Origen</th>
              <th scope="col">Confianza</th>
              <th scope="col">Ritmo</th>
              <th scope="col">FC</th>
              <th scope="col">Pendiente</th>
              <th scope="col">Historial</th>
              <th scope="col">Razón</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((entry) => {
              const sample = samples[entry.second - 1];
              const reason = entry.trace.reasonCodes[entry.trace.reasonCodes.length - 1] ?? null;
              const isSelected = entry.second === selectedSecond;
              return (
                <tr
                  key={entry.second}
                  className={isSelected ? "row-selected" : undefined}
                  onClick={() => onSelect(entry.second)}
                >
                  <td>{entry.second}</td>
                  <td>
                    <span className="action-chip" style={{ borderLeftColor: ACTION_COLORS[entry.trace.action] }}>
                      {ACTION_LABELS[entry.trace.action]}
                      {entry.reused ? " ↻" : ""}
                    </span>
                  </td>
                  <td>{SOURCE_LABELS[entry.trace.source]}</td>
                  <td>{formatConfidence(entry.trace.confidence)}</td>
                  <td>{sample !== undefined ? formatPace(sample.paceSecPerKm) : "—"}</td>
                  <td>{sample?.heartRateBpm !== null && sample?.heartRateBpm !== undefined ? `${sample.heartRateBpm}` : "—"}</td>
                  <td>{sample !== undefined ? `${sample.gradePct.toFixed(1)}%` : "—"}</td>
                  <td>{MATURITY_SHORT_LABELS[entry.trace.derivedMetrics.historyMaturity]}</td>
                  <td>{reason !== null ? reasonLabel(reason) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="note">↻ marca una decisión reutilizada del segundo anterior.</p>
    </section>
  );
}
