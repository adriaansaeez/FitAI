/**
 * T3 tests: real Jev integration (server-only adapter, provider selection,
 * and the /api/decide route contract).
 *
 * The TypeSafe client is injected (never constructed from a real env key),
 * so no test touches the network or a real TYPESAFE_API_KEY.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  JevDecisionProvider,
  JEVD_DEFAULT_TIMEOUT_MS,
  buildJevState,
  type JevClientLike,
} from "../src/services/jevDecisionProvider";
import { MockDecisionProvider } from "../src/services/mockDecisionProvider";
import type { DecisionProvider, DecideInput, ProviderResult } from "../src/services/provider";
import {
  composeDecision,
  decideSecond,
  COMPOSER_REASON_CODES,
} from "../src/domain/composer";
import type { DecisionTrace, RunningSample } from "../src/domain/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safe easy-second context, mirroring buildDecisionContext output. */
function safeEasyContext(): Record<string, unknown> {
  return {
    block: "easy",
    second: 120,
    paceSecPerKm: 338,
    heartRateBpm: 140,
    gradePct: 0,
    signalQuality: "high",
    dataAgeSeconds: 0,
    autoPaused: false,
    rpe: 3,
    symptomsReported: false,
    paceWindowSecPerKm: 338,
    heartRateWindowBpm: 140,
    hrTrendBpmPerMin: 1,
    paceVsTargetSeconds: 8,
    comparableHistoryCount: 10,
    historicalPaceDeltaSeconds: 8,
    historicalHrDeltaBpm: 0,
    historyMaturity: "established",
    mayIncreaseIntensity: true,
    safetyReasonCodes: [],
  };
}

type FakeAnswer = Record<string, unknown>;

interface CapturedRequest {
  state: unknown;
  questions: Record<string, unknown>;
}

/** Deterministic fake System One client; records requests, returns canned answers. */
function fakeJevClient(
  answers: Record<string, FakeAnswer>,
): { client: JevClientLike; requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  const client: JevClientLike = {
    async systemOne(request) {
      requests.push({
        state: request.state,
        questions: request.questions as Record<string, unknown>,
      });
      return {
        model: "jev-latest",
        answers: answers as never,
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    },
  };
  return { client, requests };
}

/** Full well-formed Jev answer set for a safe easy second. */
function fullAnswers(overrides: Record<string, FakeAnswer> = {}): Record<string, FakeAnswer> {
  return {
    effort_action: {
      type: "choice",
      choice: "increase_gently",
      confidence: 0.9,
      probabilities: {
        increase_gently: 0.7,
        maintain: 0.2,
        decrease_gently: 0.05,
        recover: 0.03,
        insufficient_evidence: 0.02,
      },
    },
    effort_disproportionate: { type: "noul", noul: 0.1 },
    context_explanation: {
      type: "choice",
      choice: "pace_below_target",
      confidence: 0.88,
      probabilities: { pace_below_target: 0.8, normal_variation: 0.2 },
    },
    context_interpretability: {
      type: "score",
      score: 1.9,
      confidence: 0.9,
      legend: { 0: "unusable", 1: "limited", 2: "clear" },
      probabilities: { 0: 0.05, 1: 0.1, 2: 0.85 },
    },
    ...overrides,
  };
}

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

function makeTrace(action: DecisionTrace["action"], second: number): DecisionTrace {
  return {
    second,
    action,
    source: "composer",
    reasonCodes: [],
    explanationKey: `decision.${action}`,
    derivedMetrics: {
      paceWindowSecPerKm: 338,
      heartRateWindowBpm: 140,
      hrTrendBpmPerMin: 0,
      paceVsTargetSeconds: 8,
      comparableHistoryCount: 10,
      historicalPaceDeltaSeconds: null,
      historicalHrDeltaBpm: null,
      historyMaturity: "established",
    },
    safety: {
      hardStop: false,
      mayIncreaseIntensity: true,
      missingRequiredMetric: false,
      reasonCodes: [],
    },
  };
}

/** Builds a route POST Request with a JSON body. */
function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/decide", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
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

// ---------------------------------------------------------------------------
// (a) Response mapping and request shape
// ---------------------------------------------------------------------------

describe("JevDecisionProvider", () => {
  it("sends exactly four questions in one systemOne request with a reduced running state", async () => {
    const { client, requests } = fakeJevClient(fullAnswers());
    const provider = new JevDecisionProvider(client);

    await provider.decide({ context: safeEasyContext() });

    expect(requests).toHaveLength(1);
    const request = requests[0] as CapturedRequest;
    expect(Object.keys(request.questions).sort()).toEqual([
      "context_explanation",
      "context_interpretability",
      "effort_action",
      "effort_disproportionate",
    ]);
    // SDK default model ('jev-latest'): no model override in the request.
    expect("model" in request).toBe(false);
    expect(request.questions.effort_action).toMatchObject({ type: "choice" });
    expect(request.questions.effort_disproportionate).toMatchObject({ type: "noul" });
    expect(request.questions.context_explanation).toMatchObject({ type: "choice" });
    expect(request.questions.context_interpretability).toMatchObject({ type: "score" });

    const state = request.state as Record<string, unknown>;
    expect(state.sport).toBe("running");
    expect(state.block).toBe("easy");
    const win = state.window as Record<string, unknown>;
    expect(win).toMatchObject({
      paceSecPerKm: 338,
      paceVsTargetSeconds: 8,
      heartRateBpm: 140,
      hrTrendBpmPerMin: 1,
      gradePct: 0,
      stoppedOrAutoPaused: false,
      signalQuality: "high",
      dataAgeSeconds: 0,
    });
    const athlete = state.athlete as Record<string, unknown>;
    expect(athlete).toMatchObject({ rpe: 3, symptomsReported: false });
    const safety = state.safety as Record<string, unknown>;
    expect(safety).toMatchObject({ mayIncreaseIntensity: true });
  });

  it("maps choice/noul/choice/score answers to ProviderResult, including insufficient_evidence", async () => {
    const { client } = fakeJevClient(
      fullAnswers({
        effort_action: {
          type: "choice",
          choice: "insufficient_evidence",
          confidence: 0.75,
          probabilities: { insufficient_evidence: 0.9 },
        },
      }),
    );
    const provider = new JevDecisionProvider(client);

    const result = await provider.decide({ context: safeEasyContext() });

    expect(result.source).toBe("jev");
    expect(result.action).toBe("insufficient_data");
    expect(result.actionConfidence).toBe(0.75);
    expect(result.disproportionateEffortProbability).toBe(0.1);
    expect(result.contextExplanation).toBe("pace_below_target");
    expect(result.interpretability).toEqual({
      score: 1.9,
      confidence: 0.9,
      probabilities: { 0: 0.05, 1: 0.1, 2: 0.85 },
    });
  });

  it("never produces stop_and_escalate for any Jev action label; safety owns that action", async () => {
    const provider = new JevDecisionProvider(
      fakeJevClient(fullAnswers()).client,
    );
    const labels = [
      "increase_gently",
      "maintain",
      "decrease_gently",
      "recover",
      "insufficient_evidence",
    ];
    for (const label of labels) {
      const { client } = fakeJevClient(
        fullAnswers({ effort_action: { type: "choice", choice: label, confidence: 0.9 } }),
      );
      const result = await new JevDecisionProvider(client).decide({
        context: safeEasyContext(),
      });
      expect(result.action).not.toBe("stop_and_escalate");
      void provider;
    }
    // And with a symptomatic sample, the composer (not any provider) stops.
    const symptomatic: RunningSample = {
      ...easySample(),
      symptomsReported: true,
    };
    const metrics = (await decideSecond({ samples: [symptomatic], block: "easy" })).safety;
    expect(metrics.hardStop).toBe(true);
    const composed = composeDecision(
      symptomatic,
      (makeTrace("maintain", 120)).derivedMetrics,
      metrics,
      { action: "increase_gently", contextExplanation: "normal_variation", source: "jev" },
      null,
      "easy",
    );
    expect(composed.action).toBe("stop_and_escalate");
  });

  it("propagates client failures (no silent mock substitution)", async () => {
    const failingClient: JevClientLike = {
      async systemOne() {
        throw new Error("APITimeoutError: request timed out");
      },
    };
    const provider = new JevDecisionProvider(failingClient);
    await expect(provider.decide({ context: safeEasyContext() })).rejects.toThrow(
      /timed out/,
    );

    const abortingClient: JevClientLike = {
      async systemOne() {
        throw new Error("aborted");
      },
    };
    await expect(
      new JevDecisionProvider(abortingClient).decide({ context: safeEasyContext() }),
    ).rejects.toThrow(/aborted/);
  });

  it("throws on an unknown choice label (fail closed, never guessed)", async () => {
    const { client } = fakeJevClient(
      fullAnswers({
        effort_action: { type: "choice", choice: "sprint_all_out", confidence: 0.99 },
      }),
    );
    const provider = new JevDecisionProvider(client);
    await expect(provider.decide({ context: safeEasyContext() })).rejects.toThrow(
      /unknown/i,
    );
  });

  it("buildJevState omits undefined metrics and keeps the state JSON-safe", () => {
    const context: Record<string, unknown> = {
      ...safeEasyContext(),
      paceSecPerKm: null,
      heartRateBpm: null,
      rpe: undefined,
      hrTrendBpmPerMin: null,
      paceVsTargetSeconds: null,
    };
    const state = buildJevState(context);
    const json = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    expect(json.sport).toBe("running");
    const win = json.window as Record<string, unknown>;
    expect("paceSecPerKm" in win).toBe(false);
    expect("heartRateBpm" in win).toBe(false);
    const athlete = json.athlete as Record<string, unknown>;
    expect("rpe" in athlete).toBe(false);
    expect(athlete.symptomsReported).toBe(false);
  });

  it("passes through the target pace range when supplied and omits target otherwise", () => {
    const withTarget = buildJevState({
      ...safeEasyContext(),
      targetPaceSecPerKm: { min: 315, max: 330 },
    });
    expect(
      (withTarget.target as { paceSecPerKm: { min: number; max: number } }).paceSecPerKm,
    ).toEqual({ min: 315, max: 330 });

    const withoutTarget = buildJevState(safeEasyContext());
    expect("target" in withoutTarget).toBe(false);
  });

  it("maps history maturity and comparable history count to top-level state", () => {
    const state = buildJevState(safeEasyContext());
    expect(state.historyMaturity).toBe("established");
    expect(state.comparableHistoryCount).toBe(10);

    const bare = buildJevState({ block: "easy", second: 0 });
    expect("historyMaturity" in bare).toBe(false);
    expect("comparableHistoryCount" in bare).toBe(false);
  });

  it("every question instruction references concrete state paths; option sets unchanged", async () => {
    const { client, requests } = fakeJevClient(fullAnswers());
    await new JevDecisionProvider(client).decide({ context: safeEasyContext() });

    const q = (requests[0] as CapturedRequest)
      .questions as Record<string, { instructions?: unknown; criteria?: unknown }>;
    const text = (value: unknown): string =>
      typeof value === "string" ? value : JSON.stringify(value);

    const effortAction = text(q.effort_action?.instructions);
    expect(effortAction).toContain("`window.paceVsTargetSeconds`");
    expect(effortAction).toContain("`window.hrTrendBpmPerMin`");
    expect(effortAction).toContain("`athlete.rpe`");
    expect(effortAction).toContain("`safety.mayIncreaseIntensity`");
    expect(effortAction).toContain("conservative");
    expect(effortAction).toContain("insufficient_evidence");

    const disproportionate = text(q.effort_disproportionate?.instructions);
    expect(disproportionate).toContain("`athlete.rpe`");
    expect(disproportionate).toContain("`window.paceSecPerKm`");
    expect(disproportionate).toContain("`window.heartRateBpm`");
    expect(disproportionate).toContain("`block`");

    const explanation = text(q.context_explanation?.instructions);
    for (const path of [
      "`window.gradePct`",
      "`window.paceVsTargetSeconds`",
      "`window.heartRateBpm`",
      "`window.hrTrendBpmPerMin`",
      "`window.signalQuality`",
    ]) {
      expect(explanation).toContain(path);
    }

    const interpretability = text(q.context_interpretability?.instructions);
    expect(interpretability).toContain("`target.paceSecPerKm`");
    expect(interpretability).toContain("`window.paceSecPerKm`");
    expect(interpretability).toContain("`athlete.rpe`");
    expect(interpretability).toContain("`historyMaturity`");

    // Same question IDs and option sets as before the rewrite.
    expect(Object.keys(q.effort_action?.criteria as object).sort()).toEqual([
      "decrease_gently",
      "increase_gently",
      "insufficient_evidence",
      "maintain",
      "recover",
    ]);
    expect(Object.keys(q.effort_disproportionate?.criteria as object).sort()).toEqual([
      "false",
      "true",
    ]);
    expect(Object.keys(q.context_explanation?.criteria as object).sort()).toEqual([
      "likely_heat_or_fatigue",
      "normal_variation",
      "not_enough_context",
      "pace_below_target",
      "uphill_or_terrain",
    ]);
    expect(q.context_interpretability?.criteria).toHaveLength(3);
  });

  it("exposes the default 5s timeout constant", () => {
    expect(JEVD_DEFAULT_TIMEOUT_MS).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// (b) Provider failure at the pipeline/route level: maintain, never increase
// ---------------------------------------------------------------------------

describe("Jev failure path", () => {
  it("pipeline yields maintain with provider_unavailable when Jev throws", async () => {
    const failingProvider: DecisionProvider = {
      async decide(): Promise<ProviderResult> {
        throw new Error("APITimeoutError");
      },
    };
    const samples = [easySample(119), easySample(120)];
    const trace = await decideSecond({
      samples,
      block: "easy",
      targetPaceSecPerKm: { min: 315, max: 330 },
      comparableHistoryCount: 10,
      provider: failingProvider,
      previousDecision: null,
    });
    expect(trace.action).toBe("maintain");
    expect(trace.action).not.toBe("increase_gently");
    expect(trace.source).toBe("composer");
    expect(trace.reasonCodes).toContain(COMPOSER_REASON_CODES.providerUnavailable);
  });
});

// ---------------------------------------------------------------------------
// (c) Provider selection by env
// ---------------------------------------------------------------------------

describe("providerSelection", () => {
  const ORIGINAL = process.env.TYPESAFE_API_KEY;

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.TYPESAFE_API_KEY;
    } else {
      process.env.TYPESAFE_API_KEY = ORIGINAL;
    }
  });

  it("returns the mock provider and simulation mode without a key", async () => {
    const { getDecisionProvider, getProviderMode, isSimulationMode } = await import(
      "../src/services/providerSelection"
    );
    vi.stubEnv("TYPESAFE_API_KEY", "");
    expect(getProviderMode()).toBe("mock");
    expect(isSimulationMode()).toBe(true);
    expect(getDecisionProvider()).toBeInstanceOf(MockDecisionProvider);
    vi.unstubAllEnvs();
  });

  it("returns the Jev provider when TYPESAFE_API_KEY is set", async () => {
    const { getDecisionProvider, getProviderMode, isSimulationMode } = await import(
      "../src/services/providerSelection"
    );
    vi.stubEnv("TYPESAFE_API_KEY", "test-key-not-real");
    expect(getProviderMode()).toBe("jev");
    expect(isSimulationMode()).toBe(false);
    expect(getDecisionProvider()).toBeInstanceOf(JevDecisionProvider);
    vi.unstubAllEnvs();
  });
});

// ---------------------------------------------------------------------------
// (d) Route: Zod validation and happy path
// ---------------------------------------------------------------------------

describe("POST /api/decide", () => {
  it("rejects malformed bodies with 400", async () => {
    const { createDecideHandler } = await import("../src/app/api/decide/handler");
    const handler = createDecideHandler();

    const cases: unknown[] = [
      {}, // empty
      { ...validRouteBody(), block: "sprint" }, // bad enum
      { ...validRouteBody(), historyCount: 2 }, // not in 0|1|3|5|10
      { ...validRouteBody(), paceTargetSecPerKm: { min: "low" } }, // bad target
      { ...validRouteBody(), sample: { ...easySample(), signalQuality: "excellent" } },
      { ...validRouteBody(), recentSamples: Array.from({ length: 121 }, (_, i) => easySample(i)) },
      { ...validRouteBody(), callJev: "yes" },
    ];
    for (const body of cases) {
      const response = await handler(postRequest(body));
      expect(response.status).toBe(400);
    }

    const notJson = await handler(postRequest("not json at all"));
    expect(notJson.status).toBe(400);
  });

  it("returns trace and mode on a valid body, using the injected provider", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key-not-real");
    const { client, requests } = fakeJevClient(fullAnswers());
    const provider = new JevDecisionProvider(client);
    const { createDecideHandler } = await import("../src/app/api/decide/handler");
    const handler = createDecideHandler({ getProvider: () => provider });

    const response = await handler(postRequest(validRouteBody()));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { trace: DecisionTrace; mode: string };
    expect(payload.mode).toBe("jev");
    expect(payload.trace.second).toBe(120);
    // The provider was actually reached through the pipeline.
    expect(requests.length).toBeGreaterThanOrEqual(1);
    vi.unstubAllEnvs();
  });

  it("route with a failing Jev provider yields maintain and never increase", async () => {
    const failingProvider: DecisionProvider = {
      async decide(): Promise<ProviderResult> {
        throw new Error("APITimeoutError");
      },
    };
    const { createDecideHandler } = await import("../src/app/api/decide/handler");
    const handler = createDecideHandler({ getProvider: () => failingProvider });

    const response = await handler(postRequest(validRouteBody()));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { trace: DecisionTrace };
    expect(payload.trace.action).toBe("maintain");
    expect(payload.trace.action).not.toBe("increase_gently");
    expect(payload.trace.reasonCodes).toContain(COMPOSER_REASON_CODES.providerUnavailable);
  });

  it("never calls the injected provider when safety hard-stops (symptoms)", async () => {
    let calls = 0;
    const countingProvider: DecisionProvider = {
      async decide(_input: DecideInput): Promise<ProviderResult> {
        calls += 1;
        return {
          action: "increase_gently",
          actionConfidence: 0.95,
          contextExplanation: "normal_variation",
          source: "jev",
        };
      },
    };
    const { createDecideHandler } = await import("../src/app/api/decide/handler");
    const handler = createDecideHandler({ getProvider: () => countingProvider });

    const body = {
      ...validRouteBody(),
      sample: { ...easySample(), symptomsReported: true },
    };
    const response = await handler(postRequest(body));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { trace: DecisionTrace };
    expect(payload.trace.action).toBe("stop_and_escalate");
    expect(payload.trace.source).toBe("safety");
    expect(calls).toBe(0);
  });
});
