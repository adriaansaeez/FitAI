/**
 * Athlete history generation and comparability logic.
 *
 * The personal reference uses only comparable sessions:
 * - same workout type (easy);
 * - approximately compatible duration;
 * - no symptoms reported;
 * - completed as planned.
 *
 * historyMaturity (from the spec): none (0) / early (1-3) / established (4-10).
 */

import type { AthleteProfile, AthleteSessionSummary, TrainingBlock } from "../domain/types";
import { deriveHistoryMaturity } from "../domain/metrics";
import { createRng, rngGauss, rngInt } from "./rng";

export { deriveHistoryMaturity };

export const HISTORY_COUNT_OPTIONS: readonly HistoryCount[] = [0, 1, 3, 5, 10];

export type HistoryCount = 0 | 1 | 3 | 5 | 10;

export interface ComparableCriteria {
  workoutType: TrainingBlock;
  referenceDurationSeconds: number;
  durationToleranceSeconds: number;
}

export const DEFAULT_COMPARABLE_CRITERIA: ComparableCriteria = {
  workoutType: "easy",
  referenceDurationSeconds: 1800,
  durationToleranceSeconds: 600,
};

export function isComparableSession(
  session: AthleteSessionSummary,
  criteria: ComparableCriteria = DEFAULT_COMPARABLE_CRITERIA,
): boolean {
  return (
    session.workoutType === criteria.workoutType &&
    session.completedAsPlanned &&
    session.symptomsReported !== true &&
    Math.abs(session.durationSeconds - criteria.referenceDurationSeconds) <=
      criteria.durationToleranceSeconds
  );
}

export function filterComparableSessions(
  sessions: readonly AthleteSessionSummary[],
  criteria: ComparableCriteria = DEFAULT_COMPARABLE_CRITERIA,
): AthleteSessionSummary[] {
  return sessions.filter((session) => isComparableSession(session, criteria));
}

/** Median of a numeric list; the mean of the two middle values for even counts. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] as number;
  }
  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

export type AthleteBaseline = AthleteProfile["baseline"];

/**
 * Baseline from comparable sessions: median pace, HR and RPE.
 * Each metric is omitted when no comparable session provides it.
 */
export function computeBaseline(
  sessions: readonly AthleteSessionSummary[],
): AthleteBaseline {
  const comparable = filterComparableSessions(sessions);
  const baseline: AthleteBaseline = {};

  const pace = median(comparable.map((s) => s.averagePaceSecPerKm));
  if (pace !== null) {
    baseline.typicalEasyPaceSecPerKm = pace;
  }

  const hrValues = comparable
    .map((s) => s.averageHeartRateBpm)
    .filter((v): v is number => v !== undefined);
  const hr = median(hrValues);
  if (hr !== null) {
    baseline.typicalEasyHrBpm = hr;
  }

  const rpeValues = comparable
    .map((s) => s.rpe)
    .filter((v): v is number => v !== undefined);
  const rpe = median(rpeValues);
  if (rpe !== null) {
    baseline.typicalEasyRpe = rpe;
  }

  return baseline;
}

export interface AthleteHistory {
  profile: AthleteProfile;
  comparableSessions: AthleteSessionSummary[];
  comparableCount: number;
  historyMaturity: "none" | "early" | "established";
}

/** Fixed base date so generated history is fully deterministic. */
const HISTORY_BASE_DATE_MS = Date.parse("2024-11-01T08:00:00.000Z");

/** How many of the requested sessions are comparable easy runs, per count. */
const COMPARABLE_COUNTS: Record<HistoryCount, number> = {
  0: 0,
  1: 1,
  3: 3,
  5: 4,
  10: 7,
};

/** Order of non-comparable distractor categories appended after comparables. */
const NON_COMPARABLE_CATEGORIES = ["tempo", "incomplete", "symptoms"] as const;
type NonComparableCategory = (typeof NON_COMPARABLE_CATEGORIES)[number];

export function generateAthleteHistory(
  count: HistoryCount,
  seed: number,
): AthleteHistory {
  const rng = createRng(seed);
  const athletePaceBase = 330 + rngGauss(rng, 0, 8);
  const athleteHrBase = 140 + rngGauss(rng, 0, 3);

  const comparableCount = COMPARABLE_COUNTS[count];
  const sessions: AthleteSessionSummary[] = [];

  for (let i = 0; i < comparableCount; i += 1) {
    sessions.push(
      comparableSession(rng, i, count, athletePaceBase, athleteHrBase),
    );
  }

  let distractorIndex = 0;
  for (let i = comparableCount; i < count; i += 1) {
    const category = NON_COMPARABLE_CATEGORIES[
      distractorIndex % NON_COMPARABLE_CATEGORIES.length
    ] as NonComparableCategory;
    distractorIndex += 1;
    sessions.push(nonComparableSession(rng, i, count, category, athletePaceBase));
  }

  const comparableSessions = filterComparableSessions(sessions);
  return {
    profile: {
      id: "athlete-jev",
      displayName: "Jev",
      sessions,
      baseline: computeBaseline(comparableSessions),
    },
    comparableSessions,
    comparableCount: comparableSessions.length,
    historyMaturity: deriveHistoryMaturity(comparableSessions.length),
  };
}

function sessionDate(index: number, total: number): string {
  const daysAgo = total - index;
  return new Date(HISTORY_BASE_DATE_MS - daysAgo * 86400000).toISOString();
}

function comparableSession(
  rng: ReturnType<typeof createRng>,
  index: number,
  total: number,
  paceBase: number,
  hrBase: number,
): AthleteSessionSummary {
  const durationSeconds = 1800 + rngInt(rng, -240, 240);
  const pace = paceBase + rngGauss(rng, 0, 6);
  return {
    id: `session-${index + 1}`,
    date: sessionDate(index, total),
    workoutType: "easy",
    durationSeconds,
    distanceM: Math.round((durationSeconds / pace) * 1000),
    averagePaceSecPerKm: Math.round(pace * 10) / 10,
    averageHeartRateBpm: Math.round(hrBase + rngGauss(rng, 0, 3)),
    rpe: rngInt(rng, 2, 4),
    completedAsPlanned: true,
    symptomsReported: false,
  };
}

function nonComparableSession(
  rng: ReturnType<typeof createRng>,
  index: number,
  total: number,
  category: NonComparableCategory,
  paceBase: number,
): AthleteSessionSummary {
  switch (category) {
    case "tempo":
      // Different workout type.
      return {
        id: `session-${index + 1}`,
        date: sessionDate(index, total),
        workoutType: "tempo",
        durationSeconds: 1800,
        distanceM: Math.round((1800 / 290) * 1000),
        averagePaceSecPerKm: Math.round((290 + rngGauss(rng, 0, 3)) * 10) / 10,
        averageHeartRateBpm: Math.round(165 + rngGauss(rng, 0, 3)),
        rpe: 7,
        completedAsPlanned: true,
        symptomsReported: false,
      };
    case "incomplete":
      // Same type but not completed as planned and too short.
      return {
        id: `session-${index + 1}`,
        date: sessionDate(index, total),
        workoutType: "easy",
        durationSeconds: 900,
        distanceM: Math.round((900 / paceBase) * 1000),
        averagePaceSecPerKm: Math.round(paceBase * 10) / 10,
        averageHeartRateBpm: Math.round(138 + rngGauss(rng, 0, 3)),
        rpe: 3,
        completedAsPlanned: false,
        notes: "stopped early",
        symptomsReported: false,
      };
    case "symptoms":
      // Same type and duration but with a reported symptom.
      return {
        id: `session-${index + 1}`,
        date: sessionDate(index, total),
        workoutType: "easy",
        durationSeconds: 1800,
        distanceM: Math.round((1800 / paceBase) * 1000),
        averagePaceSecPerKm: Math.round((paceBase + rngGauss(rng, 0, 4)) * 10) / 10,
        averageHeartRateBpm: Math.round(148 + rngGauss(rng, 0, 3)),
        rpe: 6,
        completedAsPlanned: true,
        notes: "reported dizziness",
        symptomsReported: true,
      };
  }
}
