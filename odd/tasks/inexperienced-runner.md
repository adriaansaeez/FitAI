# Feature: inexperienced-runner (novato irregular)

## Goal

Sixth synthetic demo scenario: an inexperienced runner whose pace and HR are
irregular and uncontrolled, with physiologically realistic values (no
surrealism). Id: `inexperienced-runner`.

## Profile design (realistic bounds)

- Pace: surges and fades between ~4:55 and ~6:50 /km (295–410 s/km), sawtooth:
  starts too fast, fades, surges again (classic novice pacing).
- HR: swings ~132–180 bpm (below max for a 25-30 y/o), lags pace by ~25 s,
  slow recovery after surges, second-to-second noise ±3 bpm.
- RPE: jumps 4–8 at 30 s checkpoints, correlated to recent surges.
- Signal quality stays HIGH (the runner is erratic; the sensors are not).
- Deterministic via existing rng.

## Expected outcome

Never `increase_gently` by default (erratic evidence + HR spikes + RPE
swings); composer/mock may maintain or decrease. Disproportion guard can fire
during surges.

## Tasks

- [x] T1 — Scenario definition + generator in src/simulation/scenarios.ts
  (commit `06499a9`, includes labels.ts + all tests; T2 folded in)
- [x] T2 — Tests: determinism 5→6 ids, pattern test, zod validation list,
  decision pipeline behavior for the new scenario (same commit `06499a9`)
- [x] T3 — Gates (vitest 265 green, tsc clean) + browser smoke (seed 42:
  600 s, HR 131–180, pace 298–408 s/km, 0 increases; UI renders and
  never shows absurd values) — live-checked in Chrome

## Status

Completed 2026-09-21.
