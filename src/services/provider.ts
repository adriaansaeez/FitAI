import type { DecisionAction } from "../domain/types";

export type ProviderContextExplanation =
  | "uphill_or_terrain"
  | "pace_below_target"
  | "likely_heat_or_fatigue"
  | "normal_variation"
  | "not_enough_context";

export type ProviderAction = Exclude<DecisionAction, "stop_and_escalate">;

export type ProviderInterpretability = {
  score: number;
  confidence: number;
  probabilities: Record<number, number>;
};

export type ProviderResult = {
  action: ProviderAction;
  actionConfidence?: number;
  disproportionateEffortProbability?: number;
  contextExplanation: ProviderContextExplanation;
  interpretability?: ProviderInterpretability;
  raw?: unknown;
  source?: "mock" | "jev";
};

export type DecideInput = {
  context: Record<string, unknown>;
  previousDecision?: DecisionTraceLike;
};

/**
 * Structural subset of DecisionTrace used by providers. Declared locally so
 * this module does not need a runtime dependency on domain types beyond the
 * DecisionAction union above.
 */
type DecisionTraceLike = {
  second: number;
  action: DecisionAction;
  source: "safety" | "mock" | "jev" | "composer";
  confidence?: number;
  probabilities?: Record<string, number>;
  reasonCodes: string[];
  explanationKey: string;
};

export interface DecisionProvider {
  decide(input: DecideInput): Promise<ProviderResult>;
}
