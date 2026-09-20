/**
 * POST /api/decide — thin Next.js App Router route (SERVER-ONLY).
 *
 * One evaluation per call: validate -> decideSecond (metrics -> safety ->
 * provider -> composer) -> { trace, mode }.
 *
 * Provider rules:
 * - Mock mode ("Modo simulación"): the mock may evaluate every second.
 * - Jev mode: the real provider is called only when the client asks for it
 *   (callJev); seconds without a call compose "maintain" and the UI reuses
 *   the previous decision.
 * - Safety always runs first inside decideSecond; the provider is never
 *   consulted when safety dictates the outcome (e.g. symptoms).
 */

import { z } from "zod";
import { decideSecond } from "../../../domain/composer";
import {
  runningSampleSchema,
  trainingBlockSchema,
  decisionTraceSchema,
} from "../../../domain/validation";
import type { DecisionProvider } from "../../../services/provider";
import { getDecisionProvider, getProviderMode } from "../../../services/providerSelection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Route-level bound on carried history, per the demo contract. */
export const MAX_RECENT_SAMPLES = 120;

export const decideRequestBodySchema = z.object({
  sample: runningSampleSchema,
  block: trainingBlockSchema,
  paceTargetSecPerKm: z.object({ min: z.number(), max: z.number() }),
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
      provider = body.callJev ? (deps.getProvider?.() ?? getDecisionProvider()) : undefined;
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
    });

    return Response.json({ trace, mode }, { status: 200 });
  };
}

const handler = createDecideHandler();

export async function POST(request: Request): Promise<Response> {
  return handler(request);
}
