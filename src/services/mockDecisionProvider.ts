import type { TrainingBlock } from "../domain/types";
import type {
  DecisionProvider,
  DecideInput,
  ProviderResult,
  ProviderContextExplanation,
  ProviderAction,
  ProviderInterpretability,
} from "./provider";

/** Context keys the mock reads. Everything else in the context is ignored. */
export const MOCK_THRESHOLDS = {
  /** RPE at or above this suggests recovery. */
  rpeRecover: 7,
  /** RPE at or above this suggests easing off. */
  rpeDecrease: 6,
  /** Current HR above historical easy HR baseline by this much suggests fatigue/heat. */
  hrDeltaDecrease: 12,
  /** HR rising at least this many bpm/min suggests sustained drift. */
  hrTrendDecrease: 5,
  /** Current pace slower than target range by this many s/km suggests headroom. */
  paceVsTargetIncrease: 6,
  /** Positive grade at or above this is treated as meaningful terrain. */
  gradeUphill: 2,
  /** Historical HR delta at or above this ( bpm over easy baseline ) forces recovery. */
  historicalHrDeltaRecover: 20,
  /** Minimum seconds into the session before the mock will suggest an increase. */
  increaseMinSecond: 60,
} as const;

export const MOCK_CONFIDENCE = {
  increase: 0.85,
  maintain: 0.9,
  decrease: 0.82,
  recover: 0.86,
  insufficientData: 0.5,
} as const;

export const MOCK_DISPROPORTIONATE_EFFORT_PROBABILITY: Record<ProviderAction, number> = {
  increase_gently: 0.1,
  maintain: 0.15,
  decrease_gently: 0.55,
  recover: 0.7,
  insufficient_data: 0.5,
};

export const MOCK_MATURITY_CONFIDENCE_FACTOR: Record<string, number> = {
  none: 0.6,
  early: 0.8,
  established: 1,
};

export const MOCK_INTERPRETABILITY = {
  clear: {
    score: 2,
    probabilities: { 0: 0.02, 1: 0.08, 2: 0.9 } as Record<number, number>,
  },
  limited: {
    score: 1,
    probabilities: { 0: 0.2, 1: 0.6, 2: 0.2 } as Record<number, number>,
  },
  confidenceByMaturity: {
    clear: { none: 0.7, early: 0.8, established: 0.9 } as Record<string, number>,
    limited: 0.6,
  },
} as const;

function readNumber(context: Record<string, unknown>, key: string): number | null {
  const value = context[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(context: Record<string, unknown>, key: string): boolean {
  return context[key] === true;
}

function readString(context: Record<string, unknown>, key: string): string | null {
  const value = context[key];
  return typeof value === "string" ? value : null;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function pickExplanation(
  gradePct: number | null,
  hrDeltaBpm: number | null,
  hrTrendBpmPerMin: number | null,
  paceVsTargetSeconds: number | null,
): ProviderContextExplanation {
  if (gradePct !== null && gradePct >= MOCK_THRESHOLDS.gradeUphill) {
    return "uphill_or_terrain";
  }
  if (
    (hrDeltaBpm !== null && hrDeltaBpm >= MOCK_THRESHOLDS.hrDeltaDecrease) ||
    (hrTrendBpmPerMin !== null && hrTrendBpmPerMin >= MOCK_THRESHOLDS.hrTrendDecrease)
  ) {
    return "likely_heat_or_fatigue";
  }
  if (paceVsTargetSeconds !== null && paceVsTargetSeconds >= MOCK_THRESHOLDS.paceVsTargetIncrease) {
    return "pace_below_target";
  }
  return "normal_variation";
}

function pickAction(context: Record<string, unknown>): ProviderAction {
  const rpe = readNumber(context, "rpe");
  const hrDeltaBpm = readNumber(context, "historicalHrDeltaBpm");
  const paceVsTargetSeconds = readNumber(context, "paceVsTargetSeconds");
  const hrTrendBpmPerMin = readNumber(context, "hrTrendBpmPerMin");
  const gradePct = readNumber(context, "gradePct");
  const block = readString(context, "block");
  const second = readNumber(context, "second") ?? 0;
  const mayIncreaseIntensity = readBoolean(context, "mayIncreaseIntensity");
  const historyMaturity = readString(context, "historyMaturity") ?? "none";

  // Strong fatigue signals first.
  if (rpe !== null && rpe >= MOCK_THRESHOLDS.rpeRecover) {
    return "recover";
  }
  if (hrDeltaBpm !== null && hrDeltaBpm >= MOCK_THRESHOLDS.historicalHrDeltaRecover) {
    return "recover";
  }

  // Moderate fatigue signals suggest easing off.
  if (
    (rpe !== null && rpe >= MOCK_THRESHOLDS.rpeDecrease) ||
    (hrDeltaBpm !== null && hrDeltaBpm >= MOCK_THRESHOLDS.hrDeltaDecrease) ||
    (hrTrendBpmPerMin !== null && hrTrendBpmPerMin >= MOCK_THRESHOLDS.hrTrendDecrease)
  ) {
    return "decrease_gently";
  }

  // Uphill: slow pace is terrain, not lack of effort. Hold.
  if (gradePct !== null && gradePct >= MOCK_THRESHOLDS.gradeUphill) {
    return "maintain";
  }

  // Enough steady headroom under target on an easy block -> limited increase.
  if (
    block === "easy" &&
    mayIncreaseIntensity &&
    second >= MOCK_THRESHOLDS.increaseMinSecond &&
    paceVsTargetSeconds !== null &&
    paceVsTargetSeconds >= MOCK_THRESHOLDS.paceVsTargetIncrease &&
    (rpe === null || rpe <= 5) &&
    historyMaturity !== "none"
  ) {
    return "increase_gently";
  }

  return "maintain";
}

/**
 * Pure deterministic mock decision from a prepared context.
 * No randomness, no clocks: same context always yields the same result.
 */
export function decideMockFromContext(context: Record<string, unknown>): ProviderResult {
  const action = pickAction(context);
  const historyMaturity = readString(context, "historyMaturity") ?? "none";
  const signalQuality = readString(context, "signalQuality");
  const dataAgeSeconds = readNumber(context, "dataAgeSeconds");

  const freshAndClean =
    (signalQuality === "high" || signalQuality === "medium") &&
    (dataAgeSeconds === null || dataAgeSeconds <= 15);

  const interpretability: ProviderInterpretability = freshAndClean
    ? {
        score: MOCK_INTERPRETABILITY.clear.score,
        confidence:
          MOCK_INTERPRETABILITY.confidenceByMaturity.clear[historyMaturity] ??
          MOCK_INTERPRETABILITY.confidenceByMaturity.limited,
        probabilities: MOCK_INTERPRETABILITY.clear.probabilities,
      }
    : {
        score: MOCK_INTERPRETABILITY.limited.score,
        confidence: MOCK_INTERPRETABILITY.confidenceByMaturity.limited,
        probabilities: MOCK_INTERPRETABILITY.limited.probabilities,
      };

  const baseConfidence =
    action === "increase_gently"
      ? MOCK_CONFIDENCE.increase
      : action === "decrease_gently"
        ? MOCK_CONFIDENCE.decrease
        : action === "recover"
          ? MOCK_CONFIDENCE.recover
          : action === "insufficient_data"
            ? MOCK_CONFIDENCE.insufficientData
            : MOCK_CONFIDENCE.maintain;

  const factor = MOCK_MATURITY_CONFIDENCE_FACTOR[historyMaturity] ?? 1;

  const disproportionate = MOCK_DISPROPORTIONATE_EFFORT_PROBABILITY[action];

  return {
    action,
    actionConfidence: clamp01(baseConfidence * factor),
    disproportionateEffortProbability: disproportionate,
    contextExplanation: pickExplanation(
      readNumber(context, "gradePct"),
      readNumber(context, "historicalHrDeltaBpm"),
      readNumber(context, "hrTrendBpmPerMin"),
      readNumber(context, "paceVsTargetSeconds"),
    ),
    interpretability,
    raw: { provider: "mock" },
  };
}

/**
 * Deterministic mock provider. Implements the same DecisionProvider contract
 * as the future Jev provider but is a pure function of the context.
 */
export class MockDecisionProvider implements DecisionProvider {
  async decide(input: DecideInput): Promise<ProviderResult> {
    const result = decideMockFromContext(input.context);
    return { ...result, source: "mock" };
  }
}
