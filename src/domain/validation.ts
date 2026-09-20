/**
 * Zod schemas for runtime validation of the domain types,
 * used to validate simulation output and provider input/output.
 */

import { z } from "zod";

export const trainingBlockSchema = z.enum([
  "warmup",
  "easy",
  "tempo",
  "interval",
  "recovery",
]);

export const signalQualitySchema = z.enum(["high", "medium", "low"]);

export const runningSampleSchema = z.object({
  second: z.number().int().nonnegative(),
  timestamp: z.string().min(1),
  paceSecPerKm: z.number().nullable(),
  heartRateBpm: z.number().nullable(),
  distanceM: z.number().nonnegative(),
  elevationM: z.number(),
  gradePct: z.number(),
  cadenceSpm: z.number().nullable(),
  signalQuality: signalQualitySchema,
  dataAgeSeconds: z.number().nonnegative(),
  autoPaused: z.boolean(),
  rpe: z.number().min(0).max(10).optional(),
  symptomsReported: z.boolean(),
});

export const athleteSessionSummarySchema = z.object({
  id: z.string().min(1),
  date: z.string().min(1),
  workoutType: trainingBlockSchema,
  durationSeconds: z.number().nonnegative(),
  distanceM: z.number().nonnegative(),
  averagePaceSecPerKm: z.number().positive(),
  averageHeartRateBpm: z.number().positive().optional(),
  rpe: z.number().min(0).max(10).optional(),
  completedAsPlanned: z.boolean(),
  notes: z.string().optional(),
  symptomsReported: z.boolean().optional(),
});

export const athleteBaselineSchema = z.object({
  typicalEasyPaceSecPerKm: z.number().positive().optional(),
  typicalEasyHrBpm: z.number().positive().optional(),
  typicalEasyRpe: z.number().min(0).max(10).optional(),
});

export const athleteProfileSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  sessions: z.array(athleteSessionSummarySchema),
  baseline: athleteBaselineSchema,
});

export const historyMaturitySchema = z.enum(["none", "early", "established"]);

export const derivedMetricsSchema = z.object({
  paceWindowSecPerKm: z.number().nullable(),
  heartRateWindowBpm: z.number().nullable(),
  hrTrendBpmPerMin: z.number().nullable(),
  paceVsTargetSeconds: z.number().nullable(),
  comparableHistoryCount: z.number().int().nonnegative(),
  historicalPaceDeltaSeconds: z.number().nullable(),
  historicalHrDeltaBpm: z.number().nullable(),
  historyMaturity: historyMaturitySchema,
});

export const safetyResultSchema = z.object({
  hardStop: z.boolean(),
  mayIncreaseIntensity: z.boolean(),
  missingRequiredMetric: z.boolean(),
  reasonCodes: z.array(z.string()),
});

export const decisionActionSchema = z.enum([
  "increase_gently",
  "maintain",
  "decrease_gently",
  "recover",
  "insufficient_data",
  "stop_and_escalate",
]);

export const decisionSourceSchema = z.enum(["safety", "mock", "jev", "composer"]);

export const decisionTraceSchema = z.object({
  second: z.number().int().nonnegative(),
  action: decisionActionSchema,
  source: decisionSourceSchema,
  confidence: z.number().min(0).max(1).optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
  reasonCodes: z.array(z.string()),
  explanationKey: z.string().min(1),
  derivedMetrics: derivedMetricsSchema,
  safety: safetyResultSchema,
});

export type RunningSampleInput = z.infer<typeof runningSampleSchema>;
export type AthleteProfileInput = z.infer<typeof athleteProfileSchema>;
export type DerivedMetricsInput = z.infer<typeof derivedMetricsSchema>;
export type SafetyResultInput = z.infer<typeof safetyResultSchema>;
export type DecisionTraceInput = z.infer<typeof decisionTraceSchema>;
