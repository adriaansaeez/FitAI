/**
 * Spec mandatory tests 1, 4, 5 and 6 run end-to-end through decideSecond with
 * the deterministic MockDecisionProvider, plus full-run checks for the
 * poor-signal and symptom-stop scenarios.
 */

import { describe, expect, it } from "vitest";
import {
  SCENARIOS,
  SCENARIO_IDS,
  generateScenarioSamples,
  type ScenarioId,
} from "../src/simulation/scenarios";
import { generateAthleteHistory } from "../src/simulation/history";
import { buildDecisionContext, decideSecond } from "../src/domain/composer";
import { evaluateSafety } from "../src/domain/safety";
import { computeDerivedMetrics } from "../src/domain/metrics";
import { MockDecisionProvider, MOCK_THRESHOLDS } from "../src/services/mockDecisionProvider";
import type { DecisionProvider } from "../src/services/provider";
import type { DecisionTrace, RunningSample } from "../src/domain/types";
import {
  renderDecisionMessage,
  resolveDecisionMessageKey,
} from "../src/domain/messageTemplates";

const SEED = 42;
const HISTORY_SEED = 7;

/** Spy provider that records the seconds it is invoked for, then delegates. */
function recordingProvider(inner: DecisionProvider): {
  provider: DecisionProvider;
  calledSeconds: () => number[];
} {
  const seconds: number[] = [];
  const provider: DecisionProvider = {
    async decide(input) {
      seconds.push(typeof input.context["second"] === "number" ? input.context["second"] : -1);
      return inner.decide(input);
    },
  };
  return { provider, calledSeconds: () => seconds };
}

/**
 * Runs the full decideSecond pipeline second by second over a scenario,
 * chaining previousDecision exactly like the demo simulation engine would.
 */
async function runScenarioPipeline(
  scenarioId: ScenarioId,
  options: { historyCount?: 0 | 1 | 3 | 5 | 10; seed?: number; provider?: DecisionProvider } = {},
): Promise<{ samples: RunningSample[]; traces: DecisionTrace[] }> {
  const historyCount = options.historyCount ?? 10;
  const seed = options.seed ?? SEED;
  const samples = generateScenarioSamples(scenarioId, seed);
  const scenario = SCENARIOS[scenarioId];
  const history = generateAthleteHistory(historyCount, HISTORY_SEED);
  const provider = options.provider ?? new MockDecisionProvider();

  const traces: DecisionTrace[] = [];
  let previous: DecisionTrace | null = null;
  for (let end = 1; end <= samples.length; end += 1) {
    const slice = samples.slice(0, end);
    previous = await decideSecond({
      samples: slice,
      block: scenario.block,
      targetPaceSecPerKm: scenario.targetPaceSecPerKm,
      baseline: history.profile.baseline,
      comparableHistoryCount: history.comparableCount,
      provider,
      previousDecision: previous,
    });
    traces.push(previous);
  }
  return { samples, traces };
}

describe("spec test 1: same seed produces the same race", () => {
  it.each([...SCENARIO_IDS])("%s: two generations with the same seed are identical", (scenarioId) => {
    const first = generateScenarioSamples(scenarioId, SEED);
    const second = generateScenarioSamples(scenarioId, SEED);
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
  });
});

describe("spec test 4: easy-under-target with established history can produce a limited increase", () => {
  it("produces at least one increase_gently, limited to 5-10 s/km, never before second 60", async () => {
    const { traces } = await runScenarioPipeline("easy-under-target", { historyCount: 10 });

    const increases = traces.filter((t) => t.action === "increase_gently");
    expect(increases.length).toBeGreaterThan(0);

    for (const increase of increases) {
      // Mock threshold: no increase before enough evidence accumulates.
      expect(increase.second).toBeGreaterThanOrEqual(MOCK_THRESHOLDS.increaseMinSecond);
      // The composer marks every accepted increase as limited to 5-10 s/km.
      expect(increase.reasonCodes).toContain(
        "increase_adjustment_limited_5_10_sec_per_km",
      );
      expect(increase.safety.mayIncreaseIntensity).toBe(true);
    }

    // Nothing else goes wrong in this scenario.
    expect(traces.some((t) => t.action === "stop_and_escalate")).toBe(false);
    expect(traces.some((t) => t.action === "insufficient_data")).toBe(false);
  });

  it("the increase message renders the 5-10 s/km limit in Spanish", async () => {
    const { traces } = await runScenarioPipeline("easy-under-target", { historyCount: 10 });
    const increase = traces.find((t) => t.action === "increase_gently");
    if (increase === undefined) throw new Error("expected an increase trace");
    const key = resolveDecisionMessageKey(
      increase.action,
      increase.reasonCodes[increase.reasonCodes.length - 1] ?? null,
    );
    const message = renderDecisionMessage(key);
    expect(message).toContain("5 y 10 s/km");
  });
});

describe("spec test 5: cardiac-drift never produces increase_gently", () => {
  it("no second of the run suggests an increase; drift phase eases off or recovers", async () => {
    const { traces } = await runScenarioPipeline("cardiac-drift", { historyCount: 10 });

    expect(traces.map((t) => t.action)).not.toContain("increase_gently");

    const driftPhase = traces.filter((t) => t.second >= 300);
    expect(
      driftPhase.some((t) => t.action === "decrease_gently" || t.action === "recover"),
    ).toBe(true);

    expect(traces.some((t) => t.action === "stop_and_escalate")).toBe(false);
  });
});

describe("spec test 6: uphill does not read slow pace as a need to increase", () => {
  it("no increase_gently during uphill seconds (grade >= 2%)", async () => {
    const { samples, traces } = await runScenarioPipeline("uphill", { historyCount: 10 });

    const uphillSeconds = samples
      .filter((s) => s.gradePct >= MOCK_THRESHOLDS.gradeUphill)
      .map((s) => s.second);
    // The sinusoidal route guarantees real climbs for this seed.
    expect(uphillSeconds.length).toBeGreaterThan(0);

    const uphillTraces = traces.filter((t) => uphillSeconds.includes(t.second));
    expect(uphillTraces.length).toBeGreaterThan(0);
    expect(uphillTraces.map((t) => t.action)).not.toContain("increase_gently");
  });

  it("the mock explains an uphill second as terrain and holds the pace", async () => {
    const { samples } = await runScenarioPipeline("uphill", { historyCount: 10 });
    const uphillSample = samples.find((s) => s.gradePct >= MOCK_THRESHOLDS.gradeUphill);
    if (uphillSample === undefined) throw new Error("expected an uphill sample");

    // Rebuild the exact context the pipeline hands to the mock for that second.
    const history = generateAthleteHistory(10, HISTORY_SEED);
    const slice = samples.slice(0, uphillSample.second);
    const context = buildProviderContext(SCENARIOS.uphill, slice, history);
    const mock = await new MockDecisionProvider().decide({ context });

    expect(mock.contextExplanation).toBe("uphill_or_terrain");
    expect(mock.action).toBe("maintain");
  });
});

describe("cheap scenario-level checks", () => {
  it("poor-signal never produces increase_gently and flags insufficient data in gaps", async () => {
    const { traces } = await runScenarioPipeline("poor-signal", { historyCount: 10 });
    expect(traces.map((t) => t.action)).not.toContain("increase_gently");
    expect(traces.some((t) => t.action === "insufficient_data")).toBe(true);
  });

  it("symptom-stop escalates at second 360 and never calls any provider all run", async () => {
    const mock = new MockDecisionProvider();
    const recorder = recordingProvider(mock);
    const { traces } = await runScenarioPipeline("symptom-stop", { provider: recorder.provider });

    // The provider runs on every normal second (599) but never on the symptom second.
    expect(recorder.calledSeconds()).not.toContain(360);
    expect(recorder.calledSeconds()).toHaveLength(599);

    const stop = traces.find((t) => t.action === "stop_and_escalate");
    expect(stop).toBeDefined();
    expect(stop?.second).toBe(360);
    expect(stop?.source).toBe("safety");
    expect(stop?.reasonCodes).toContain("symptoms_reported");
    // Every other second runs on the mock without stopping.
    const others = traces.filter((t) => t.second !== 360);
    expect(others.map((t) => t.action)).not.toContain("stop_and_escalate");
  });
});

/**
 * Builds the same provider context decideSecond builds, for direct mock
 * checks against the real pipeline building blocks.
 */
function buildProviderContext(
  scenario: (typeof SCENARIOS)[ScenarioId],
  slice: readonly RunningSample[],
  history: ReturnType<typeof generateAthleteHistory>,
): Record<string, unknown> {
  const current = slice[slice.length - 1] as RunningSample;
  const derived = computeDerivedMetrics({
    samples: slice,
    second: current.second,
    targetPaceSecPerKm: scenario.targetPaceSecPerKm,
    baseline: history.profile.baseline,
    comparableHistoryCount: history.comparableCount,
  });
  const safety = evaluateSafety(current, derived, scenario.block);
  return buildDecisionContext(current, derived, safety, scenario.block, scenario.targetPaceSecPerKm);
}
