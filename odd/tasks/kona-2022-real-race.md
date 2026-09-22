# Feature: kona-2022-real-race — Validación con datos reales (Gustav Iden, Kona 2022)

Source spec: `docs/research/validacion-carrera-real-kona-2022.md` (authoritative; do not contradict).
Branch: `feature/jev-race-demo`. Baseline at start: commit 250e07d, 148/148 tests green, tsc clean.

## Goal

Reproducible real-race validation mode: deterministic seeded 10–30 min window
(+90 s hidden preroll) of Gustav Iden's 2022 Kona marathon telemetry (Entalpi
CSV, CC BY-NC 4.0), played through the existing pipeline alongside the 5
synthetic scenarios (unchanged). Coherence/prudence validation — never
`increase_gently` without published target+plan (fail-closed).

## Decisions

- Acquisition route 1 (dev/non-commercial): versioned download script → ignored
  dir + derived local fixture; attribution + license shown in UI/docs.
- Download script as plain `.mjs` in `scripts/` (no tsx/ts-node dep; scripts not
  in tsconfig include). Raw CSV ignored via `.gitignore` (`data/kona-2022/`).
- Real window served by a server-only API route (`/api/race-window`) that runs
  the importer module `src/simulation/realRace/kona2022.ts`; client never
  imports raw CSV.
- Real mode: historyCount 0, no RPE, symptomsSource "not_reported_by_dataset",
  no target → composer gates `increase_gently` (new blocker).
- Decision cadence real mode: first visible second after preroll + every 60 s +
  forced on data discontinuity; reuse between evals.
- Ambiguous cadence semantics kept as metadata
  (`cadenceSemantics: "source_per_min_unknown"`), not a V1 trigger.

## Tasks

- [x] T1 — Download/verification script: `scripts/download-kona-2022.mjs` (URL + dest
  args, header check fail, sha256, provenance JSON with sourceUrl/downloadedAt/sha256/
  license/athlete/event), `.gitignore` entry, derived fixture in ignored dir.
- [x] T2 — Importer module `src/simulation/realRace/kona2022.ts`: parse/validate CSV
  (exact header, valid monotonic timestamps, >=690 rows), normalize per source-doc mapping
  table (nulls not zeros, local distanceM, gradePct, signalQuality/dataAge rules,
  autoPaused false), `RealRaceWindow` type, `selectWindow` with createRng/rngInt
  (600–1800 s, preroll 90, durationSeconds override validated).
- [x] T3 — Source abstraction + dynamic length: session descriptor { samples,
  totalSeconds, metadata } consumed by useRaceSimulation; replace all SIMULATION_SECONDS=600
  usages (L38/289/335/350/351/356/380/386); scenario path unchanged (600 default).
- [x] T4 — SynchronizedCharts dynamic domains: replace 7× `[1,600]` domains, YAxis pace
  range, hardcoded 315–330 target band/borders with descriptor values (no target band in
  real mode).
- [x] T5 — Fail-closed gating: paceTargetSecPerKm optional in /api/decide zod schema;
  composer hasIncreaseBlockers gains "no target OR comparableHistoryCount too low"
  blocker (increaseWithoutTarget reason); real mode can only maintain/decrease_gently/
  recover/insufficient_data.
- [x] T6 — Real-mode wiring in hook: source selector state (scenario vs real),
  seed control, fetch /api/race-window, 60 s cadence + first-second-after-preroll eval +
  forced eval on discontinuity, zero-history profile (no generateAthleteHistory),
  status text without 600 assumption.
- [x] T7 — UI disclosure: "Carrera real: Kona 2022 / Gustav Iden" selector, seed input,
  optional duration control, attribution/license/limitations panel ("telemetría real;
  RPE, síntomas y plan no publicados"), audit metadata (source/license/hash/seed/window
  timestamps/preroll) in AuditPanel; no GPS/identifiers sent to Jev.
- [x] T8 — Evaluation rows + minimum test cases: decision evaluation rows
  (observedNext60s/90s pace+HR, terrainDelta) in audit data; tests for all source-doc
  minimum cases (parser rejects, determinism, bounds, preroll metrics, distance/grade,
  gap→degraded→never increase, no-target→never increase, synthetic suite untouched,
  UI attribution).

## Evidence log

(completed per task below — commit hash + gate results)

- T1 commit `e065e16` — download script + lib + 14 tests (162 total), tsc clean.
- T2 commit `034b354` — importer + 42 tests (204 total), tsc clean. Resolved ambiguities: distance
  right-Riemann (matches accumulateDistance); context-less first sample degrades to medium
  (irrelevant in windows — preroll provides context); missing elevation carries last known value
  forward (RunningSample.elevationM non-nullable).
- T3 commit `c6793f1` — SessionDescriptor type; hook fully dynamic (totalSecondsRef, clampSecond,
  isCompleted); SIMULATION_SECONDS export removed; session exposed on RaceSimulation; vitest
  @ alias added (214 tests green, tsc clean).
- T4 commit `ff7a804` — charts: xDomain from totalSeconds, pace YAxis from samples, conditional
  target band; page.tsx gates target on session source kind (214 green, tsc clean).
- T5 commit `492bada` — increaseWithoutTarget blocker (target absent OR history 0) + optional
  paceTargetSecPerKm in /api/decide schema (223 green, tsc clean). Pending: explanationKey
  increase_without_target has no message template (falls back to generic maintain).
- T6 commit `2435d81` — /api/race-window (400/409/422/500 mapping) + hook real-mode wiring
  (isIntervalHit 60s cadence, zero-history stub, tempo block, no target) (240 green, tsc clean).
  Pending manual check: browser playback once T7 UI lands.
- T8 commit `28ad2c4` — evaluation.ts (observedNext60/90 + terrainDelta), evaluationForSelected
  in hook + Comparación observada audit card (254 green, tsc clean). Nuance preserved: demo metric
  windows at second 1 use visible data only (preroll backs the dataset, not the pipeline).
- T7 commit `17a17e6` — Fuente selector + seed/duration inputs, 60 s interval note, history
  disabled, Origen de datos audit card, attribution banner + dataset-missing hint (240 green,
  tsc clean). Note: first T7 attempt timed out; resumed via resumeFrom, no work lost.

## Status

Completed 2026-09-20. Gates at close: vitest 148→254 green (15 files), tsc clean.
Live smoke 2026-09-21 — ALL PASS:
1. Dataset downloaded: data/kona-2022/gustav_iden.csv (9342 rows, sha256 cbac5d42…, provenance
   CC BY-NC 4.0 written).
2. API: /api/race-window?seed=42 → 1722 s window, seconds 1..1722, 0 gaps, 0 nulls, preroll
   absorbed; seed=7 → different window (deterministic); seed="abc" → 400; duration=5000 → 400.
3. Decision invariants on the real window (mock provider, no target): 29 decisions (s=1 + every
   60 s) → 29× maintain, 0 increase_gently. With target+history @300 s → recover conf 0.86.
4. Browser UI (localhost:3001): real-mode selector, disabled Escenario/históricas, "Historial no
   publicado", fixed 60 s interval note, seed 42 / dynamic 1722 s, attribution banner. Decision
   at s=1: Mantener · Compositor · 54% · 3:48/km · 158 ppm · pendiente -4.6%. Audit: 0 comparables,
   madurez sin referencia, guardas "Permitido subir intensidad: no" (fail-closed), Comparación
   observada card present.
