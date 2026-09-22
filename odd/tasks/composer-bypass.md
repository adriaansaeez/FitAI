# Composer bypass toggle (raw provider mode)

**Feature:** composer-bypass
**Branch:** feature/jev-race-demo
**Created:** 2026-09-21
**Status:** in_progress

## Goal

Add a demo option to disable the composer policy layer so the raw provider
(Jev/mock) decision is accepted as-is. Product decision (user-confirmed):
the symptom hard-stop (safety.hardStop -> stop_and_escalate) REMAINS active
even in bypass mode.

## Design

- `DecideSecondInput.policyMode?: "guarded" | "raw"` (default "guarded").
- In "raw" mode composeDecision skips ALL composer veto rules (low confidence,
  low interpretability, disproportionate risk, zone ceiling, increase validity
  guards, cooldown/adjustment limits): the provider action is accepted verbatim.
- Hard stop, missingRequiredMetric and degraded-safety short-circuits stay.
- Every raw-mode decision appends reason code `composer_bypassed` for audit
  transparency.
- API: `policyMode` optional in decideRequestBodySchema, passed to decideSecond.
- UI: toggle in ControlsBar ("Safety policy: On/Off", default On), wired through
  useRaceSimulation to the API body.

## Constraints

- Default behavior unchanged when the flag is absent (guarded).
- Gates: npx vitest run green + npx tsc --noEmit clean.

## Tasks

- [x] T1 — Domain + API: policyMode "guarded"|"raw" through
      composeDecision/decideSecond, zod, handler, `composer_bypassed` reason
      code; new tests/decision.composer.raw.test.ts (15 tests). RED 9F/6P
      observed, GREEN 280/280, tsc clean. Recover hold NOT skipped in raw mode
      (re-evaluation pacing rule, not a provider veto) — owner may move the
      raw branch above step 3 if wanted.
- [x] T2 — UI: ControlsBar "Safety policy" checkbox (default on, guarded/
      raw state text) + useRaceSimulation policyOn state, configRef wiring,
      fetch body policyMode, hook exposure. Pipeline tests: guarded-vs-raw
      pairs over low-confidence and increase-without-target veto paths,
      hard-stop stays stop_and_escalate/source safety in BOTH modes, schema
      accepts policyMode. 284/284, tsc clean.
- [x] T3 — Gates + smoke: vitest 284/284, tsc clean, dev-server render
      smoke shows the "Safety policy" toggle and lang="en".

## Evidence

- T1: commit fcbc308 (feat(composer): add raw policy mode bypassing veto rules)
- T2+T3: recorded at commit time of the UI work unit
