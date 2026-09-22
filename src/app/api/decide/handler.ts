/**
 * Handler logic for POST /api/decide.
 *
 * Kept out of route.ts because Next.js type-checks Route exports strictly:
 * only runtime/dynamic/POST (and friends) may be exported from route.ts.
 *
 * One evaluation per call: validate -> decideSecond (metrics -> safety ->
 * provider -> composer) -> { trace, mode }.
 *
 * Provider rules:
 * - Mock mode ("Modo simulación"): the mock may evaluate every second.
 * - Jev mode: the real provider is called when the client asks for it
 *   (callJev); seconds without a call fall back to the mock provider, so
 *   every evaluated second reaches a provider instead of composing
 *   "provider unavailable" (the UI reuses non-evaluated seconds).
 * - Safety always runs first inside decideSecond; the provider is never
 *   consulted when safety dictates the outcome (e.g. symptoms).
 */

import { z } from "zod";
import { decideSecond } from "../../../domain/composer";
import {
  runningSampleSchema,
  trainingBlockSchema,
  decisionTraceSchema,
  heartRateZonesSchema,
} from "../../../domain/validation";
import { DEFAULT_HEART_RATE_ZONES } from "../../../domain/heartRateZones";
import type { DecisionProvider } from "../../../services/provider";
import { getDecisionProvider, getProviderMode } from "../../../services/providerSelection";
import { MockDecisionProvider } from "../../../services/mockDecisionProvider";

/** Route-level bound on carried history, per the demo contract. */
export const MAX_RECENT_SAMPLES = 120;

export const decideRequestBodySchema = z.object({
  sample: runningSampleSchema,
  block: trainingBlockSchema,
  /** Optional since the fail-closed guard (Kona 2022): increases are denied
   *  when absent, but maintain/decrease/recover remain valid outputs. */
  paceTargetSecPerKm: z.object({ min: z.number(), max: z.number() }).optional(),
  /** Samples BEFORE `sample`, oldest first (exclusive of the current second). */
  recentSamples: z.array(runningSampleSchema).max(MAX_RECENT_SAMPLES),
  historyCount: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(3),
    z.literal(5),
    z.literal(10),
  ]),
  previousDecision: decisionTraceSchema.nullable(),
  callJev: z.boolean(),
  /** Composer bypass toggle: "raw" accepts the provider decision verbatim.
   *  Optional; absent = "guarded" (all composer veto rules active). */
  policyMode: z.enum(["guarded", "raw"]).optional(),
  /** Kept optional for backwards-compatible demo callers; UI always sends it. */
  heartRateZones: heartRateZonesSchema.optional().default(DEFAULT_HEART_RATE_ZONES.map((zone) => ({ ...zone }))),
});

export type DecideRequestBody = z.infer<typeof decideRequestBodySchema>;

export type DecideHandlerDeps = {
  /** Injectable for tests; defaults to the env-based selection. */
  getProvider?: () => DecisionProvider | undefined;
};

function badRequest(code: string, details?: unknown): Response {
  return Response.json({ error: code, details }, { status: 400 });
}

function defaultGetProvider(mode: "jev" | "mock"): DecisionProvider | undefined {
  if (mode === "jev") {
    return getDecisionProvider();
  }
  return getDecisionProvider(); // mock mode: evaluate every second
}

/**
 * Factory so tests can inject providers (e.g. a failing Jev client) without
 * touching the environment or the network.
 */
export function createDecideHandler(deps: DecideHandlerDeps = {}) {
  return async function decide(request: Request): Promise<Response> {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return badRequest("invalid_json");
    }

    const parsed = decideRequestBodySchema.safeParse(raw);
    if (!parsed.success) {
      return badRequest("invalid_request", parsed.error.flatten());
    }
    const body = parsed.data;

    const mode = getProviderMode();
    let provider: DecisionProvider | undefined;
    if (mode === "jev") {
      provider =
        body.callJev
          ? (deps.getProvider?.() ?? getDecisionProvider())
          : (deps.getProvider?.() ?? new MockDecisionProvider());
    } else {
      provider = deps.getProvider?.() ?? defaultGetProvider(mode);
    }

    const trace = await decideSecond({
      samples: [...body.recentSamples, body.sample],
      block: body.block,
      targetPaceSecPerKm: body.paceTargetSecPerKm,
      comparableHistoryCount: body.historyCount,
      provider,
      previousDecision: body.previousDecision,
      heartRateZones: body.heartRateZones,
      policyMode: body.policyMode,
    });

    return Response.json({ trace, mode }, { status: 200 });
  };
}
