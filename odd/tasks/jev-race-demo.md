# Feature: jev-race-demo

Source docs:
- docs/prompts/desarrollar-demo-carrera-jev.md (spec, types, scenarios, tests, acceptance)
- docs/research/implementacion-jev-carrera.md (Jev responsibilities, context shape)
- docs/research/wearables-entrenamiento-tiempo-real.md (metrics policy)
- .pi/skills/typesafe-ai/SKILL.md + https://docs.typesafe.ai (SDK contract)

TypeSafe SDK contract (verified 2026-09-20, docs v0.6.0):
- npm i @typesafe-ai/sdk; import { TypeSafeClient, choice } from "@typesafe-ai/sdk"
- const client = new TypeSafeClient() — reads TYPESAFE_API_KEY env
- await client.systemOne({ state, questions: { id: choice("instructions", { opt: "desc" | null }) } })
- answers[id]: { choice, confidence, probabilities }; Score: { score, confidence, probabilities (keyed by level, int in TS), legend }; Noul: probability of yes, no confidence field
- model field: selectedModels: ['jev-latest']; HTTP fallback: POST https://api.typesafe.ai/v1/systemone
- Worker must verify noul/score helper names against node_modules/@typesafe-ai/sdk type declarations after install.

## Tasks

- [x] T1: Scaffold Next.js (App Router) + TS + Vitest + Recharts + Zod; domain types + simulation engine (seeded route, 5 scenarios) + athlete history generator (0/1/3/5/10 sessions, comparability filter) + metric engine (smoothing windows, hr trend, history baseline/median)
- [x] T2: Safety policy + DecisionProvider interface + MockDecisionProvider (deterministic) + composer (guardas, confidence thresholds, cooldown, limits) + all 10 mandatory domain tests green
- [x] T3: JevDecisionProvider (server-only, 4 questions per call, API route, timeout/error fallback to maintain) + provider selection (mock without key, "Modo simulación")
- [x] T4: UI single page (controls, summary cards, synchronized charts with cursor, decision table, audit panel, playback 1x/5x/20x) + README (install, env, controls, medical limits)
- [ ] T5: Full test run, build check, acceptance walkthrough per scenario, close-out

Constraints (from spec):
- Server-only Jev access; no TYPESAFE_API_KEY client-side; no auth/DB; deterministic seeded simulation; safety overrides mock & Jev; Spanish UI messages as templates (not free text from Jev); no medical claims.

## Evidence
- T1: commit 8a2b79c-ish (feat: scaffold Next.js app with domain and simulation layers) — 69 tests green, tsc clean. Pending: .env.example blocked by .env* safety policy (agent writes denied); document TYPESAFE_API_KEY in README instead, user may create file manually.
- T2: safety/composer/mock provider + 10 mandatory tests (130 tests green, tsc clean). Fail-closed fix in composer (undefined block denies increase). Note: T2 worker stalled twice (240s stall, 20m timeout) leaving source-only partial work; parent verified partial state and delegated the test battery separately.
- T3: Jev provider + selection + /api/decide route (144 tests green, tsc clean). Known follow-up: pace target not yet included in Jev state (composer buildDecisionContext outside surfaces; UI wiring may supply it via context).
- T4: UI page + charts + decision table + audit + README (144 tests, tsc clean, next build OK). Refactor: handler.ts extracted from route.ts for Next build validation. Commits: feat demo UI + handler extraction.
- T6: Enrich JevDecisionProvider state (nested RunningContext per docs/research, include target pace range) and rewrite the four question instructions to reference state fields with backticked paths per TypeSafe docs guidance. Live smoke at 5s showed Jev returning insufficient_evidence/not_enough_context with interpretability unusable because the flat state lacks semantics. Re-validate with /tmp/jev-smoke.mts (5s interval) afterwards.
