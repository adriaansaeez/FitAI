/**
 * Route tests for POST /api/decide (createDecideHandler).
 *
 * Focus: the callJev=false fallback in jev server mode. Every evaluated
 * second must reach a provider — when the client does not ask for Jev the
 * mock provider runs instead of composing a "provider unavailable" trace.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createDecideHandler } from "../src/app/api/decide/handler";
import type { DecisionTrace, RunningSample } from "../src/domain/types";

/** Minimal valid current sample for a safe easy second. */
function easySample(second = 120): RunningSample {
  return {
    second,
    timestamp: "2025-01-01T00:02:00.000Z",
    paceSecPerKm: 338,
    heartRateBpm: 140,
    distanceM: 350 + second * 3,
    elevationM: 10,
    gradePct: 0,
    cadenceSpm: 170,
    signalQuality: "high",
    dataAgeSeconds: 0,
    autoPaused: false,
    rpe: 3,
    symptomsReported: false,
  };
}

/** Builds a route POST Request with a JSON body. */
function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/decide", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validRouteBody(): Record<string, unknown> {
  return {
    sample: easySample(120),
    block: "easy",
    paceTargetSecPerKm: { min: 315, max: 330 },
    recentSamples: [easySample(118), easySample(119)],
    historyCount: 10,
    previousDecision: null,
    callJev: true,
  };
}

describe("POST /api/decide — callJev=false provider fallback", () => {
  const ORIGINAL = process.env.TYPESAFE_API_KEY;

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.TYPESAFE_API_KEY;
    } else {
      process.env.TYPESAFE_API_KEY = ORIGINAL;
    }
    vi.unstubAllEnvs();
  });

  it("jev server mode + callJev=false + policyMode raw reaches the mock provider, not the composer", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key-not-real");
    const handler = createDecideHandler();

    const response = await handler(
      postRequest({ ...validRouteBody(), callJev: false, policyMode: "raw" }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { trace: DecisionTrace; mode: string };
    expect(payload.mode).toBe("jev");
    // The fallback provider ran: no provider_unavailable composer trace.
    expect(payload.trace.source).toBe("mock");
    expect(payload.trace.reasonCodes).not.toContain("provider_unavailable");
  });

  it("mock server mode keeps evaluating every second regardless of callJev", async () => {
    delete process.env.TYPESAFE_API_KEY;
    const handler = createDecideHandler();

    const response = await handler(postRequest({ ...validRouteBody(), callJev: false }));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { trace: DecisionTrace; mode: string };
    expect(payload.mode).toBe("mock");
    expect(payload.trace.reasonCodes).not.toContain("provider_unavailable");
  });
});
