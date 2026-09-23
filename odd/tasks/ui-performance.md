# UI performance during simulation (no style/logic changes)

**Feature:** ui-performance
**Branch:** feature/jev-race-demo
**Created:** 2026-09-23
**Status:** in_progress

## Goal

Eliminate UI lag while the simulation runs so the demo feels smooth and
fluid. Constraint from the user: do NOT change styles or (user-visible)
logic — every fix must keep the rendered DOM output byte-identical.

## Diagnosis (perf scout, verified)

- Zero React.memo in the project; `sim` is a fresh object literal every
  render (useRaceSimulation.ts return) and page.tsx passes it whole to
  ControlsBar -> the entire page tree re-renders on every state change.
- 3-4 UNBATCHED renders per tick:
  1. setTargetSecond (interval ticker, useRaceSimulation.ts:595)
  2. setEntries after the fetch (useRaceSimulation.ts:578-580, O(n) copy)
  3. auto-follow effect setSelectedSecond (useRaceSimulation.ts:607-613)
  4. DecisionTable follow effect setWindowEnd (DecisionTable.tsx:38-42)
- Hotspot 1 - SynchronizedCharts: 6 recharts ComposedCharts re-render per
  tick (ReferenceLine x=selectedSecond changes every tick; decisionSeries
  rebuilds O(n) per tick; inline formatter closures). isAnimationActive
  already false everywhere.
- Hotspot 2 - LiveSimulationPanel: chartData rebuilds a Map over all
  entries + samples.slice(0, liveSecond) every tick; paceValues/paceDomain
  computed OUTSIDE useMemo (O(n) x 3 renders/tick); latestEvaluations
  filter O(n) per render; inline formatters.
- Hotspot 3 - DecisionTable: already windowed (60 rows) but its follow
  effect triggers an extra render per tick; rows re-render on entries
  identity change.
- AuditPanel/SummaryCards: props change per tick only when content actually
  changes (selected second follows the frontier) but they re-render 3x per
  tick due to the cascades.

## Tasks

- [x] T1 - Hook + page: pump batches setEntries+setSelectedSecond under
      auto-follow (one render instead of two); follow effect no-ops when the
      selection already matches the newest entry (selectedSecondRef mirror,
      deps unchanged). ControlsBar narrowed from whole `sim` to 28 individual
      props -> ControlsBar no longer re-renders on frontier updates.
      Render counts reasoned (no render-test lib available): HomePage ~3-4 ->
      ~2 renders/tick, ControlsBar decoupled. 288/288, tsc clean, boot smoke
      OK.
- [x] T2 - LiveSimulationPanel: paceValues/paceDomain into useMemo, 3 inline
      recharts formatters hoisted to module consts, component wrapped in
      React.memo (named fn expression). chartData/recent already memoized.
      Commit 97e8586. 288/288, tsc clean.
- [x] T3 - SynchronizedCharts: 6 chart bodies extracted into React.memo
      components (only selectedSecond changes per tick), ChartFrame memoized,
      all inline formatters + prop literals hoisted to module consts,
      decisionSeries memoized on [entries.length, lastEntry] (append-only
      verified). Commit d97f299. 288/288, tsc clean.
- [ ] T4 - DecisionTable + AuditPanel + SummaryCards: React.memo, remove
      the extra per-tick setWindowEnd render where possible.
- [ ] T5 - Post-change measurement (same instrumentation), full gates
      (vitest, tsc) + dev-server render smoke + visual smoothness check.

## Constraints

- DOM output identical in every state (idle, playing, selected row, done).
- All 288 tests keep passing without weakening assertions.
- Temporary instrumentation never gets committed.

## Evidence

(recorded per task at close)
