# UI English Translation

**Feature:** ui-english
**Branch:** feature/jev-race-demo
**Created:** 2026-09-21
**Status:** in_progress

## Goal

Translate the entire demo web UI to English (demo will be presented in English).
All user-facing copy: page text, component copy, labels, aria-labels, runner-facing
decision messages. Keep reason codes, scenario ids, API contracts, and identifiers
untouched.

## Constraints

- No behavioral changes; copy-only (plus `<html lang>`).
- Reason codes (e.g. `increase_adjustment_limited_5_10_sec_per_km`), scenario ids,
  and action ids stay exactly as-is.
- Tests currently assert no Spanish strings (verified: no test references Spanish copy).
- Gates: `npx vitest run` 265 green + `npx tsc --noEmit` clean.

## Tasks

- [x] T1 — App shell + small components (page, layout lang=en, labels,
      LiveSimulationPanel, SummaryCards, DecisionTable) — 265 tests green
- [x] T2 — Big components (ControlsBar, AuditPanel, SynchronizedCharts) —
      terminology aligned with T1
- [x] T3 — Runner messages (27 templates), validation zod messages, remaining
      failure notes in useRaceSimulation; 2 test assertions updated ("5 y 10
      s/km" → "5 to 10 s/km")
- [x] T4 — Gates: vitest 265/265, tsc clean, dev-server render smoke: lang=en,
      title "Race demo with Jev", 0 Spanish characters in rendered HTML

## Evidence

(recorded per task at close)
