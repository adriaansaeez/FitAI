"use client";

/**
 * Client-side race simulation runner for the demo screen.
 *
 * - Samples and athlete history are generated client-side (pure, seeded).
 * - Every evaluated second POSTs /api/decide (server-side decideSecond);
 *   TYPESAFE_API_KEY never reaches the browser.
 * - Mock evaluates every second. Jev evaluates at the configured interval;
 *   skipped seconds reuse the last decision trace, marked "reused".
 * - Symptom seconds always force a server evaluation (callJev=false: safety
 *   dominates and the provider is never consulted on a symptom).
 * - Network/provider failure -> maintain + sticky failure note; the run
 *   continues (composer-equivalent fallback computed client-side from the
 *   pure domain modules).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DecisionTrace,
  PaceTargetSecPerKm,
  RunningSample,
  TrainingBlock,
} from "@/domain/types";
import { computeDerivedMetrics, type AthleteBaseline } from "@/domain/metrics";
import { evaluateSafety } from "@/domain/safety";
import {
  generateScenarioSamples,
  SCENARIOS,
  type ScenarioId,
} from "@/simulation/scenarios";
import {
  generateAthleteHistory,
  type AthleteHistory,
  type HistoryCount,
} from "@/simulation/history";

export const SIMULATION_SECONDS = 600;
export const SPEED_OPTIONS = [1, 5, 20] as const;
export const JEVI_INTERVAL_OPTIONS = [1, 5, 15] as const;
export type Speed = (typeof SPEED_OPTIONS)[number];
export type JevInterval = (typeof JEVI_INTERVAL_OPTIONS)[number];
export type ProviderChoice = "mock" | "jev";

/** Fixed demo seed: same scenario -> identical race. */
const SEED = 42;
/** Route-level bound on carried history (mirrors the API contract). */
const MAX_RECENT_SAMPLES = 120;
const DECIDE_TIMEOUT_MS = 10_000;

export interface DecisionEntry {
  second: number;
  trace: DecisionTrace;
  /** True when this second reused the previous decision (Jev interval skip). */
  reused: boolean;
  /** True when the server was asked to call the real provider (Jev mode). */
  calledJev: boolean;
  /** True when the client could not reach /api/decide for this second. */
  fetchFailed: boolean;
}

/** Body for POST /api/decide (mirrors the route schema; no route import). */
interface DecideBody {
  sample: RunningSample;
  block: TrainingBlock;
  paceTargetSecPerKm: PaceTargetSecPerKm;
  recentSamples: RunningSample[];
  historyCount: HistoryCount;
  previousDecision: DecisionTrace | null;
  callJev: boolean;
}

async function decideApi(body: DecideBody): Promise<{
  trace: DecisionTrace;
  mode: "mock" | "jev";
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DECIDE_TIMEOUT_MS);
  try {
    const res = await fetch("/api/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`decide_failed_${res.status}`);
    }
    return (await res.json()) as { trace: DecisionTrace; mode: "mock" | "jev" };
  } finally {
    clearTimeout(timer);
  }
}

export interface RaceSimulation {
  // configuration
  scenarioId: ScenarioId;
  setScenarioId: (id: ScenarioId) => void;
  historyCount: HistoryCount;
  setHistoryCount: (count: HistoryCount) => void;
  provider: ProviderChoice;
  setProvider: (provider: ProviderChoice) => void;
  jevInterval: JevInterval;
  setJevInterval: (interval: JevInterval) => void;
  speed: Speed;
  setSpeed: (speed: Speed) => void;

  // data
  samples: RunningSample[];
  history: AthleteHistory;
  block: TrainingBlock;
  paceTarget: PaceTargetSecPerKm;
  baseline: AthleteBaseline;

  // playback
  playing: boolean;
  togglePlay: () => void;
  restart: () => void;
  stepOneSecond: () => void;
  targetSecond: number;
  completed: boolean;

  // decisions
  entries: DecisionEntry[];
  selectedSecond: number;
  selectSecond: (second: number) => void;

  // status
  apiMode: "mock" | "jev";
  failureNote: string | null;
  totalSeconds: number;
}

export function useRaceSimulation(): RaceSimulation {
  const [scenarioId, setScenarioIdState] = useState<ScenarioId>("easy-under-target");
  const [historyCount, setHistoryCountState] = useState<HistoryCount>(10);
  const [provider, setProviderState] = useState<ProviderChoice>("mock");
  const [jevInterval, setJevIntervalState] = useState<JevInterval>(5);
  const [speed, setSpeedState] = useState<Speed>(1);

  const [playing, setPlaying] = useState(false);
  const [targetSecond, setTargetSecond] = useState(0);
  const [entries, setEntries] = useState<DecisionEntry[]>([]);
  const [selectedSecond, setSelectedSecond] = useState(0);
  const [apiMode, setApiMode] = useState<"mock" | "jev">("mock");
  const [failureNote, setFailureNote] = useState<string | null>(null);

  const samples = useMemo(() => generateScenarioSamples(scenarioId, SEED), [scenarioId]);
  const history = useMemo(() => generateAthleteHistory(historyCount, SEED), [historyCount]);

  const definition = SCENARIOS[scenarioId];
  const block = definition.block;
  const paceTarget = definition.targetPaceSecPerKm;
  const baseline = history.profile.baseline;

  // Mutable mirrors for the async pump; assigned on every render.
  const configRef = useRef({ scenarioId, historyCount, provider, jevInterval, block, paceTarget, baseline, samples });
  configRef.current = { scenarioId, historyCount, provider, jevInterval, block, paceTarget, baseline, samples };

  const entriesRef = useRef<DecisionEntry[]>(entries);
  entriesRef.current = entries;
  const targetSecondRef = useRef(targetSecond);
  targetSecondRef.current = targetSecond;
  const runIdRef = useRef(0);
  const pumpRunningRef = useRef(false);
  const autoFollowRef = useRef(true);

  const resetRun = useCallback(() => {
    runIdRef.current += 1;
    setPlaying(false);
    setTargetSecond(0);
    setEntries([]);
    setSelectedSecond(0);
    setFailureNote(null);
    autoFollowRef.current = true;
  }, []);

  // Changing scenario or history invalidates the whole run.
  useEffect(() => {
    resetRun();
  }, [scenarioId, historyCount, resetRun]);

  const computeEntry = useCallback(async (second: number, runId: number): Promise<DecisionEntry> => {
    const cfg = configRef.current;
    const idx = second - 1;
    const sample = cfg.samples[idx];
    if (sample === undefined) {
      throw new Error(`sample out of range: ${second}`);
    }
    const prev = entriesRef.current[entriesRef.current.length - 1] ?? null;

    const intervalHit =
      cfg.provider === "mock" || second % cfg.jevInterval === 0;
    // First second, interval hits and symptom seconds are always evaluated
    // server-side (safety dominates; a symptom never reaches a provider).
    const mustEvaluate = intervalHit || prev === null || sample.symptomsReported;
    if (!mustEvaluate && prev !== null) {
      return {
        second,
        trace: { ...prev.trace, second },
        reused: true,
        calledJev: false,
        fetchFailed: false,
      };
    }

    const callJev = cfg.provider === "jev" && intervalHit;
    try {
      const data = await decideApi({
        sample,
        block: cfg.block,
        paceTargetSecPerKm: cfg.paceTarget,
        recentSamples: cfg.samples.slice(Math.max(0, idx - MAX_RECENT_SAMPLES), idx),
        historyCount: cfg.historyCount,
        previousDecision: prev?.trace ?? null,
        callJev,
      });
      if (runId !== runIdRef.current) {
        // Run was reset while the request was in flight.
        return { second, trace: data.trace, reused: false, calledJev: callJev, fetchFailed: false };
      }
      setApiMode(data.mode);
      return { second, trace: data.trace, reused: false, calledJev: callJev, fetchFailed: false };
    } catch {
      if (runId !== runIdRef.current) {
        throw new Error("run_reset_during_fetch");
      }
      setFailureNote(
        `Fallo al contactar el proveedor de decisiones en el segundo ${second}: se mantiene el ritmo y la simulación continúa.`,
      );
      // Composer-equivalent fallback computed from the pure domain modules.
      const metrics = computeDerivedMetrics({
        samples: cfg.samples.slice(0, second),
        second,
        targetPaceSecPerKm: cfg.paceTarget,
        baseline: cfg.baseline,
        comparableHistoryCount: cfg.historyCount,
      });
      const safety = evaluateSafety(sample, metrics, cfg.block);
      const trace: DecisionTrace = {
        second,
        action: "maintain",
        source: "composer",
        reasonCodes: ["provider_unavailable"],
        explanationKey: "decision.maintain.provider_unavailable",
        derivedMetrics: metrics,
        safety,
      };
      return { second, trace, reused: false, calledJev: callJev, fetchFailed: true };
    }
  }, []);

  // Sequential decision pump: processes every pending second up to the
  // playback target, one fetch at a time, in order.
  useEffect(() => {
    if (pumpRunningRef.current) {
      return;
    }
    pumpRunningRef.current = true;
    const runId = runIdRef.current;
    void (async () => {
      try {
        while (
          runId === runIdRef.current &&
          entriesRef.current.length < targetSecondRef.current
        ) {
          const nextSecond = entriesRef.current.length + 1;
          const entry = await computeEntry(nextSecond, runId);
          if (runId !== runIdRef.current) {
            return;
          }
          entriesRef.current = [...entriesRef.current, entry];
          setEntries(entriesRef.current);
        }
      } finally {
        pumpRunningRef.current = false;
      }
    })();
  }, [targetSecond, computeEntry]);

  // Playback ticker: advances the target at the selected speed.
  useEffect(() => {
    if (!playing) {
      return;
    }
    const intervalMs = 1000 / speed;
    const timer = setInterval(() => {
      setTargetSecond((current) => {
        if (current >= SIMULATION_SECONDS) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [playing, speed]);

  // Follow the frontier while playing unless the user picked a second.
  useEffect(() => {
    if (!autoFollowRef.current || entries.length === 0) {
      return;
    }
    const last = entries[entries.length - 1];
    if (last !== undefined) {
      setSelectedSecond(last.second);
    }
  }, [entries]);

  const setScenarioId = useCallback(
    (id: ScenarioId) => {
      setScenarioIdState(id);
    },
    [],
  );

  const setHistoryCount = useCallback((count: HistoryCount) => {
    setHistoryCountState(count);
  }, []);

  const setProvider = useCallback((choice: ProviderChoice) => {
    setProviderState(choice);
  }, []);

  const setJevInterval = useCallback((interval: JevInterval) => {
    setJevIntervalState(interval);
  }, []);

  const setSpeed = useCallback((value: Speed) => {
    setSpeedState(value);
  }, []);

  const togglePlay = useCallback(() => {
    setPlaying((wasPlaying) => {
      if (!wasPlaying && targetSecondRef.current >= SIMULATION_SECONDS) {
        return wasPlaying; // completed: use Reiniciar to run again
      }
      return !wasPlaying;
    });
    autoFollowRef.current = true;
  }, []);

  const restart = useCallback(() => {
    resetRun();
  }, [resetRun]);

  const stepOneSecond = useCallback(() => {
    autoFollowRef.current = true;
    setPlaying(false);
    setTargetSecond((current) => Math.min(SIMULATION_SECONDS, current + 1));
    setSelectedSecond((current) => Math.min(SIMULATION_SECONDS, current + 1));
  }, []);

  const selectSecond = useCallback((second: number) => {
    autoFollowRef.current = false;
    setSelectedSecond(Math.max(0, Math.min(SIMULATION_SECONDS, Math.round(second))));
  }, []);

  return {
    scenarioId,
    setScenarioId,
    historyCount,
    setHistoryCount,
    provider,
    setProvider,
    jevInterval,
    setJevInterval,
    speed,
    setSpeed,
    samples,
    history,
    block,
    paceTarget,
    baseline,
    playing,
    togglePlay,
    restart,
    stepOneSecond,
    targetSecond,
    completed: targetSecond >= SIMULATION_SECONDS,
    entries,
    selectedSecond,
    selectSecond,
    apiMode,
    failureNote,
    totalSeconds: SIMULATION_SECONDS,
  };
}
