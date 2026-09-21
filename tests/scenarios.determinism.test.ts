import { describe, expect, it } from "vitest";
import {
  SCENARIO_IDS,
  generateScenarioSamples,
} from "../src/simulation/scenarios";

describe("scenario determinism", () => {
  it("exposes exactly the six scenario ids from the spec", () => {
    expect([...SCENARIO_IDS].sort()).toEqual([
      "cardiac-drift",
      "easy-under-target",
      "inexperienced-runner",
      "poor-signal",
      "symptom-stop",
      "uphill",
    ]);
  });

  it.each([...SCENARIO_IDS])(
    "%s: same seed produces identical samples",
    (scenarioId) => {
      const first = generateScenarioSamples(scenarioId, 42);
      const second = generateScenarioSamples(scenarioId, 42);
      expect(second).toEqual(first);
    },
  );

  it.each([...SCENARIO_IDS])(
    "%s: different seed produces different samples",
    (scenarioId) => {
      const first = generateScenarioSamples(scenarioId, 42);
      const second = generateScenarioSamples(scenarioId, 43);
      expect(second).not.toEqual(first);
    },
  );

  it("produces 600 one-per-second samples with coherent seconds", () => {
    const samples = generateScenarioSamples("easy-under-target", 7);
    expect(samples).toHaveLength(600);
    samples.forEach((sample, index) => {
      expect(sample.second).toBe(index + 1);
    });
  });

  it("honors a custom duration and start timestamp deterministically", () => {
    const a = generateScenarioSamples("uphill", 7, {
      durationSeconds: 120,
      startTimestamp: "2025-03-01T08:00:00.000Z",
    });
    const b = generateScenarioSamples("uphill", 7, {
      durationSeconds: 120,
      startTimestamp: "2025-03-01T08:00:00.000Z",
    });
    expect(b).toEqual(a);
    expect(a).toHaveLength(120);
    expect(a[0]?.timestamp).toBe("2025-03-01T08:00:01.000Z");
  });
});
