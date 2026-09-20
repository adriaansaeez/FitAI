/**
 * Domain types for the Jev race demo.
 *
 * Copied field-for-field from docs/prompts/desarrollar-demo-carrera-jev.md.
 * Fields may be added but never removed: security-relevant fields must stay.
 */

export type TrainingBlock = "warmup" | "easy" | "tempo" | "interval" | "recovery";

export type RunningSample = {
  second: number;
  timestamp: string;
  paceSecPerKm: number | null;
  heartRateBpm: number | null;
  distanceM: number;
  elevationM: number;
  gradePct: number;
  cadenceSpm: number | null;
  signalQuality: "high" | "medium" | "low";
  dataAgeSeconds: number;
  autoPaused: boolean;
  rpe?: number;
  symptomsReported: boolean;
};

export type AthleteSessionSummary = {
  id: string;
  date: string;
  workoutType: TrainingBlock;
  durationSeconds: number;
  distanceM: number;
  averagePaceSecPerKm: number;
  averageHeartRateBpm?: number;
  rpe?: number;
  completedAsPlanned: boolean;
  notes?: string;
  /** Added (never removed): whether symptoms were reported during the session. */
  symptomsReported?: boolean;
};

export type AthleteProfile = {
  id: string;
  displayName: string;
  sessions: AthleteSessionSummary[];
  baseline: {
    typicalEasyPaceSecPerKm?: number;
    typicalEasyHrBpm?: number;
    typicalEasyRpe?: number;
  };
};

export type DerivedMetrics = {
  paceWindowSecPerKm: number | null;
  heartRateWindowBpm: number | null;
  hrTrendBpmPerMin: number | null;
  paceVsTargetSeconds: number | null;
  comparableHistoryCount: number;
  historicalPaceDeltaSeconds: number | null;
  historicalHrDeltaBpm: number | null;
  historyMaturity: "none" | "early" | "established";
};

export type SafetyResult = {
  hardStop: boolean;
  mayIncreaseIntensity: boolean;
  missingRequiredMetric: boolean;
  reasonCodes: string[];
};

export type DecisionAction =
  | "increase_gently"
  | "maintain"
  | "decrease_gently"
  | "recover"
  | "insufficient_data"
  | "stop_and_escalate";

export type DecisionTrace = {
  second: number;
  action: DecisionAction;
  source: "safety" | "mock" | "jev" | "composer";
  confidence?: number;
  probabilities?: Record<string, number>;
  reasonCodes: string[];
  explanationKey: string;
  derivedMetrics: DerivedMetrics;
  safety: SafetyResult;
};

/** Pace target range for a block, in seconds per kilometer. */
export type PaceTargetSecPerKm = { min: number; max: number };

/**
 * Descriptor of the session that drives a race simulation.
 *
 * Plain discriminated union, deliberately decoupled from the
 * simulation/realRace module: synthetic scenarios keep using
 * `generateScenarioSamples`, while real races carry their own provenance.
 * totalSeconds always equals samples.length (one sample per second).
 */
export type SessionDescriptor = {
  /** One sample per second, 1-indexed. */
  samples: RunningSample[];
  /** Total session duration in seconds; equals samples.length. */
  totalSeconds: number;
  source:
    | { kind: "synthetic-scenario"; scenarioId: string }
    | {
        kind: "real-race";
        id: string;
        seed: number;
        startSourceIndex: number;
        visibleDurationSeconds: number;
        prerollSeconds: number;
      };
};
