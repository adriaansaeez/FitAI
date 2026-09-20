import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMPARABLE_CRITERIA,
  computeBaseline,
  deriveHistoryMaturity,
  filterComparableSessions,
  generateAthleteHistory,
  median,
  type HistoryCount,
} from "../src/simulation/history";
import type { AthleteSessionSummary } from "../src/domain/types";

function session(overrides: Partial<AthleteSessionSummary>): AthleteSessionSummary {
  return {
    id: "s1",
    date: "2024-12-01T08:00:00.000Z",
    workoutType: "easy",
    durationSeconds: 1800,
    distanceM: 5500,
    averagePaceSecPerKm: 330,
    averageHeartRateBpm: 140,
    rpe: 3,
    completedAsPlanned: true,
    ...overrides,
  };
}

describe("history comparability filter", () => {
  it("keeps easy sessions of compatible duration, completed as planned, without symptoms", () => {
    const s = session({});
    expect(filterComparableSessions([s])).toEqual([s]);
    expect(DEFAULT_COMPARABLE_CRITERIA.workoutType).toBe("easy");
  });

  it("rejects different workout types", () => {
    const tempo = session({ workoutType: "tempo", averagePaceSecPerKm: 290 });
    expect(filterComparableSessions([tempo])).toEqual([]);
  });

  it("rejects incompatible durations", () => {
    const short = session({ durationSeconds: 600 });
    const long = session({ durationSeconds: 7200 });
    expect(filterComparableSessions([short, long])).toEqual([]);
  });

  it("rejects sessions not completed as planned", () => {
    const incomplete = session({ completedAsPlanned: false });
    expect(filterComparableSessions([incomplete])).toEqual([]);
  });

  it("rejects sessions with reported symptoms", () => {
    const symptomatic = session({ symptomsReported: true });
    expect(filterComparableSessions([symptomatic])).toEqual([]);
  });
});

describe("baseline computation", () => {
  it("computes the median pace/HR/RPE of comparable sessions (odd count)", () => {
    const sessions = [
      session({ id: "a", averagePaceSecPerKm: 320, averageHeartRateBpm: 138, rpe: 2 }),
      session({ id: "b", averagePaceSecPerKm: 330, averageHeartRateBpm: 140, rpe: 3 }),
      session({ id: "c", averagePaceSecPerKm: 340, averageHeartRateBpm: 142, rpe: 4 }),
    ];
    expect(computeBaseline(sessions)).toEqual({
      typicalEasyPaceSecPerKm: 330,
      typicalEasyHrBpm: 140,
      typicalEasyRpe: 3,
    });
  });

  it("computes the median for an even count as the mean of the middle values", () => {
    const sessions = [
      session({ id: "a", averagePaceSecPerKm: 320 }),
      session({ id: "b", averagePaceSecPerKm: 330 }),
      session({ id: "c", averagePaceSecPerKm: 340 }),
      session({ id: "d", averagePaceSecPerKm: 350 }),
    ];
    const baseline = computeBaseline(sessions);
    expect(baseline.typicalEasyPaceSecPerKm).toBe(335);
  });

  it("returns an empty baseline for no sessions and omits HR when missing", () => {
    expect(computeBaseline([])).toEqual({});
    const noHr = [session({ averageHeartRateBpm: undefined })];
    const baseline = computeBaseline(noHr);
    expect(baseline.typicalEasyPaceSecPerKm).toBeDefined();
    expect(baseline.typicalEasyHrBpm).toBeUndefined();
  });

  it("median handles unsorted input", () => {
    expect(median([30, 10, 20])).toBe(20);
    expect(median([40, 10, 30, 20])).toBe(25);
    expect(median([])).toBeNull();
  });
});

describe("history maturity mapping", () => {
  it.each<[HistoryCount, "none" | "early" | "established"]>([
    [0, "none"],
    [1, "early"],
    [3, "early"],
    [5, "established"],
    [10, "established"],
  ])("history count %i maps to %s", (count, expected) => {
    const history = generateAthleteHistory(count, 42);
    expect(history.historyMaturity).toBe(expected);
    expect(deriveHistoryMaturity(history.comparableCount)).toBe(expected);
  });

  it("deriveHistoryMaturity follows the spec table directly", () => {
    expect(deriveHistoryMaturity(0)).toBe("none");
    expect(deriveHistoryMaturity(1)).toBe("early");
    expect(deriveHistoryMaturity(3)).toBe("early");
    expect(deriveHistoryMaturity(4)).toBe("established");
    expect(deriveHistoryMaturity(10)).toBe("established");
  });
});

describe("generated athlete history", () => {
  it("generates deterministic history for the same seed", () => {
    const a = generateAthleteHistory(10, 42);
    const b = generateAthleteHistory(10, 42);
    expect(b).toEqual(a);
  });

  it("generates no sessions for count 0", () => {
    const history = generateAthleteHistory(0, 42);
    expect(history.profile.sessions).toEqual([]);
    expect(history.comparableSessions).toEqual([]);
    expect(history.comparableCount).toBe(0);
    expect(history.historyMaturity).toBe("none");
  });

  it("count 10 includes non-comparable sessions so filtering is testable", () => {
    const history = generateAthleteHistory(10, 42);
    expect(history.profile.sessions).toHaveLength(10);
    expect(history.comparableCount).toBeLessThan(10);
    expect(history.comparableCount).toBeGreaterThan(0);
    // Every comparable session truly passes the filter.
    expect(filterComparableSessions(history.profile.sessions)).toEqual(
      history.comparableSessions,
    );
    // The baseline is derived from comparable sessions only.
    expect(history.profile.baseline.typicalEasyPaceSecPerKm).toBe(
      computeBaseline(history.comparableSessions).typicalEasyPaceSecPerKm,
    );
  });

  it("non-comparable distractors cover the spec categories", () => {
    const history = generateAthleteHistory(10, 42);
    const nonComparable = history.profile.sessions.filter(
      (s) => !history.comparableSessions.includes(s),
    );
    expect(nonComparable.length).toBeGreaterThan(0);
    expect(nonComparable.some((s) => s.workoutType !== "easy")).toBe(true);
    expect(nonComparable.some((s) => !s.completedAsPlanned)).toBe(true);
    expect(nonComparable.some((s) => s.symptomsReported === true)).toBe(true);
  });

  it("counts 1, 3 and 5 produce the requested total of sessions", () => {
    expect(generateAthleteHistory(1, 42).profile.sessions).toHaveLength(1);
    expect(generateAthleteHistory(3, 42).profile.sessions).toHaveLength(3);
    expect(generateAthleteHistory(5, 42).profile.sessions).toHaveLength(5);
  });
});
