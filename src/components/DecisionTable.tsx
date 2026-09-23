"use client";

/**
 * Decision history table with plain windowing (60 rows at a time over the
 * 600-second run). Clicking a row syncs the charts and opens the audit panel.
 */

import { memo, useEffect, useRef, useState } from "react";
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

export const DecisionTable = memo(function DecisionTable({
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

  // Follow the frontier while the user is watching the latest window. The
  // effect only records the entry count the last committed render saw; the
  // following window itself is derived during render (see below), so a per-tick
  // frontier change no longer needs a follow-up state update (and its extra
  // render of this subtree).
  useEffect(() => {
    prevEntryCountRef.current = entries.length;
  }, [entries.length]);

  if (entries.length === 0) {
    return (
      <section className="table-section" aria-label="Decision history">
        <p className="note">No decisions yet; start the simulation.</p>
      </section>
    );
  }

  // Same follow-the-frontier condition the previous effect applied (the pinned
  // windowEnd has not fallen behind the frontier), derived during render so the
  // window already includes the newest entries in the tick's own commit without
  // a second render pass. Reading the ref here is safe: it is only written
  // post-commit by the effect above.
  const isFollowingFrontier = windowEnd >= prevEntryCountRef.current;
  const effectiveWindowEnd = isFollowingFrontier ? entries.length : windowEnd;

  const start = Math.max(0, Math.min(effectiveWindowEnd - WINDOW_SIZE, entries.length - 1));
  const end = Math.min(effectiveWindowEnd, entries.length);
  const visible = entries.slice(start, end);

  return (
    <section className="table-section" aria-label="Decision history">
      <div className="table-header-row">
        <h2 className="section-title">Decision history</h2>
        <div className="pager">
          <button
            type="button"
            className="btn"
            onClick={() => setWindowEnd(Math.max(WINDOW_SIZE, effectiveWindowEnd - WINDOW_SIZE))}
            disabled={start === 0}
          >
            ← Previous
          </button>
          <span className="pager-label">
            {start + 1}–{end} de {entries.length}
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => setWindowEnd(Math.min(entries.length, effectiveWindowEnd + WINDOW_SIZE))}
            disabled={end >= entries.length}
          >
            Next →
          </button>
        </div>
      </div>

      <div className="table-scroll">
        <table className="decision-table">
          <thead>
            <tr>
              <th scope="col">Second</th>
              <th scope="col">Action</th>
              <th scope="col">Source</th>
              <th scope="col">Confidence</th>
              <th scope="col">Pace</th>
              <th scope="col">HR</th>
              <th scope="col">Grade</th>
              <th scope="col">History</th>
              <th scope="col">Reason</th>
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
      <p className="note">↻ marks a decision reused from the previous second.</p>
    </section>
  );
});
