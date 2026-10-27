# FitAI — Simulated Race Demo with Jev

![FitAI](docs/logo.png)

A local, self-contained web demo: a simulated 10-minute (600-second) run,
second by second, showing how **Jev** (TypeSafe System One) interprets the
athlete's training state to decide between *increase gently*, *maintain*,
*decrease gently*, *recover*, *insufficient data*, and *stop and escalate*.

## Cómo funciona (resumen en español)

FitAI simula una carrera de **10 minutos, segundo a segundo**. En cada segundo
se generan métricas ficticias (ritmo, pulsaciones, RPE, calidad de señal) a
partir de un escenario con semilla fija, y una política de seguridad decide si
es seguro pedir una recomendación:

1. **Generación de métricas** — `src/simulation` crea la ruta, el histórico del
   atleta y las muestras por segundo de forma determinista (misma semilla →
   misma carrera).
2. **Seguridad primero** — `src/domain/safety.ts` bloquea cualquier incremento
   si hay un síntoma reportado, señal degradada, cooldown activo o datos
   insuficientes. Un síntoma **nunca** llega al modelo.
3. **Decisión** — si la seguridad lo permite, `POST /api/decide` consulta al
   proveedor: **Jev** (TypeSafe, solo en el servidor con `TYPESAFE_API_KEY`) o
   el **MockProvider** determinista si no hay clave. Ambos devuelven una
   decisión tipada (`increase_gently`, `maintain`, `decrease_gently`,
   `recover`, `insufficient_data`, `stop_and_escalate`) — nunca texto libre.
4. **Composición del mensaje** — `src/domain/composer.ts` combina seguridad +
   decisión + confianza y la UI lo muestra con plantillas fijas en español.

**Para ejecutarla:** `npm install && npm run dev` y abrir
`http://localhost:3000`. Sin `TYPESAFE_API_KEY` funciona igual en modo
simulación (badge "Modo simulación"); con la clave en tu `.env.local` se usan
las decisiones reales de Jev. La clave vive solo en el servidor.

## Medical-safety disclaimer

This is a **demo with fictional, seeded data**. It performs **no diagnosis, no
injury prevention, and no medical advice** of any kind. All decision
thresholds (confidence gates, adjustment limits of 5–10 / 5–15 s/km, RPE and
HR deltas, 60 s cooldown, 90 s recover re-evaluation) are **pilot values, not
physiological thresholds**. Deterministic safety guards always dominate any
provider output, and a reported symptom stops the session and escalates
without ever calling Jev. No real devices (WHOOP, Amazfit, Xiaomi) and no
Strava integration are connected in this phase.

## Quickstart

```bash
npm install
npm run dev
# open http://localhost:3000
```

## Environment variables

- `TYPESAFE_API_KEY` — **server-only**. When present (non-empty), the real
  `JevDecisionProvider` is used; when absent, the deterministic
  `MockDecisionProvider` runs and the UI shows the **"Modo simulación"**
  badge (this is a default, not an error). The key never reaches the browser:
  all provider calls happen inside `POST /api/decide` on the server.
- No `.env.example` is created intentionally; document the variable inline
  (here or in your shell) and never commit real keys.

Other scripts: `npm run build` (production build), `npm test` (Vitest),
`npm run typecheck` (strict TypeScript).

## Controls

- **Escenario** — one of the five seeded scenarios (see below).
- **Sesiones históricas** — 0 / 1 / 3 / 5 / 10 previous athlete sessions.
- **Proveedor** — Mock or Jev. Selecting Jev only has effect when the server
  has `TYPESAFE_API_KEY`; otherwise every response reports `mode: "mock"`.
- **Intervalo Jev** — 1 / 5 / 15 s. With Jev selected, only seconds at the
  interval (plus the first second and any symptom second) hit the API; other
  seconds **reuse** the previous decision trace, marked *decisión
  reutilizada* (↻ in the table). The interval is demo cadence, not production
  cadence — the UI says so when Jev is selected.
- **Reiniciar / Reproducir / Pausar / Avanzar 1 s / velocidad 1x–5x–20x** —
  playback; scrubbing by clicking any chart or table row jumps the cursor
  without altering decision history.

## Scenarios (fixed seed → reproducible runs)

| Id | Description | Expected outcome |
|---|---|---|
| `easy-under-target` | Stable easy run below target pace, low HR/RPE | After enough evidence, a limited gentle increase (5–10 s/km, 60 s) |
| `cardiac-drift` | Same pace, HR rises steadily, RPE reaches 7 | Decrease gently or recover; never increase |
| `uphill` | Pace slows on climbs, HR rises explainably | Maintain or decrease gently; slow pace is not read as lack of effort |
| `poor-signal` | HR gaps/spikes, low-quality or stale GPS/pace | Insufficient data or maintain; never increase |
| `symptom-stop` | A symptom is reported at second 360 | Stop and escalate without calling Jev |

## History maturity

The personal reference uses only **comparable sessions** (easy type, roughly
compatible duration, no symptoms, completed as planned):

- **none** (0 sessions) — plan + safety only; reduced confidence, no easy
  increases; UI shows "sin referencia personal; confianza limitada".
- **early** (1–3) — provisional reference, cautious comparison.
- **established** (4–10) — comparison against the median pace/HR/RPE of
  comparable sessions; the per-segment median chart becomes available.

History changes **confidence and explanation only**; it never infers a health
condition.

## Error states

- No API key → mock provider by default, "Modo simulación" badge, no error.
- Jev error or timeout (10 s client abort) → decision degrades to *maintain*
  with a visible failure banner; the simulation continues.
- No HR/pace → explicit *insufficient_data* from the safety policy.
- History 0 → "sin referencia personal; confianza limitada".
- The whole simulation completes offline with the mock provider.

## Architecture

```
scenarios + athlete history        (src/simulation: seeded route, samples, history)
        ↓
decision adapter: mock or Jev      (src/services; Jev only on the server)
        ↓
decideSecond: metrics → safety →   (src/domain/composer.ts, called by
provider → composer                 POST /api/decide in src/app/api/decide)
        ↓
timeline, charts, table, audit     (src/components, composed in src/app/page.tsx)
```

- `src/domain` — pure types, metric engine, safety policy, composer, Spanish
  message templates (no free model text ever reaches the runner).
- `src/simulation` — seeded route/scenario/history generators (deterministic).
- `src/services` — `MockDecisionProvider`, `JevDecisionProvider`, env-based
  provider selection (`TYPESAFE_API_KEY` stays server-side).
- `src/app/api/decide/route.ts` — single server endpoint: validates with Zod,
  runs `decideSecond` (metrics → safety → provider → composer), returns
  `{ trace, mode }`. Safety runs first; a symptom never reaches a provider.
- `src/components` — React UI: playback hook, controls, summary cards,
  synchronized Recharts view, windowed decision table, audit panel.
- `src/app/page.tsx` — single sober accessible screen (semantic HTML, labels
  for every control, visible focus styles; plain CSS in `globals.css`).

## Tests

```bash
npm test          # 144 Vitest tests: determinism, safety, composer, scenarios
npm run typecheck # strict TypeScript, no emit
npm run build     # validates page + API route compilation
```

## Limitations

- No real devices and no Strava; all metrics are seeded, fictional data.
- No free-text output from Jev: decisions are classified against fixed
  questions and rendered through fixed Spanish templates.
- Safety always dominates: providers can never override hard stops, degraded
  data, cooldowns, or block restrictions.
- Single-user local demo: no authentication, no database, no persistence.
