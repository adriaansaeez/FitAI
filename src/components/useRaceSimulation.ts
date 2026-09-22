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
  SessionDescriptor,
  TrainingBlock,
} from "@/domain/types";
import { DEFAULT_HEART_RATE_ZONES, type HeartRateZone } from "@/domain/heartRateZones";
import { computeDerivedMetrics, type AthleteBaseline } from "@/domain/metrics";
import {
  evaluateDecisionAgainstObserved,
  type RaceDecisionEvaluation,
} from "@/domain/evaluation";
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

export const SPEED_OPTIONS = [1, 5, 20] as const;
export const JEVI_INTERVAL_OPTIONS = [1, 5, 15] as const;
export type Speed = (typeof SPEED_OPTIONS)[number];
export type JevInterval = (typeof JEVI_INTERVAL_OPTIONS)[number];
export type ProviderChoice = "mock" | "jev";

/** Fixed demo seed: same scenario -> identical race. */
const SEED = 42;
/** Fixed seed for the real-race window request (UI control arrives in T7). */
export const DEFAULT_REAL_SEED = 42;
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
  /** Optional: the real-race mode sends no pre-race target (fail closed). */
  paceTargetSecPerKm?: PaceTargetSecPerKm;
  recentSamples: RunningSample[];
  historyCount: HistoryCount;
  previousDecision: DecisionTrace | null;
  callJev: boolean;
  heartRateZones: HeartRateZone[];
  /** Composer bypass toggle: "raw" accepts the provider decision verbatim;
   *  "guarded" (default, safety policy ON) keeps every veto rule active. */
  policyMode: "guarded" | "raw";
}

/** Where the simulated samples come from. */
export type DataSource = "synthetic" | "real";
/** Load state of the real-race window fetched from /api/race-window. */
export type RealWindowStatus = "idle" | "loading" | "ready" | "error";

/**
 * Shape of GET /api/race-window's `window` payload (structural mirror of
 * RealRaceWindow; the adapter module itself is server-only and is never
 * imported from client code).
 */
export interface RealRaceWindowPayload {
  id: string;
  source: {
    url: string;
    license: string;
    sha256: string;
    athlete: string;
    event: string;
  };
  seed: number;
  startSourceIndex: number;
  visibleDurationSeconds: number;
  prerollSeconds: number;
  samples: RunningSample[];
  unavailable: {
    rpe: boolean;
    symptoms: string;
    personalHistory: boolean;
    plannedTarget: boolean;
  };
  cadenceSemantics: string;
  symptomsSource: string;
  startTimestamp: string;
  endTimestamp: string;
}

export type IntervalHitInput = {
  provider: ProviderChoice;
  second: number;
  isRealMode: boolean;
  jevInterval: JevInterval;
  /** > 0 marks a data discontinuity in the real telemetry. */
  dataAgeSeconds: number;
};

/**
 * Pure decision-cadence rule shared by both data sources.
 *
 * - Mock evaluates every second (demo wiring, both modes).
 * - Synthetic + Jev: the demo interval select (1/5/15 s).
 * - Real race (spec "Ejecución de Jev"): the first visible second, then every
 *   stable 60 s; the jevInterval select is IGNORED. Any data discontinuity
 *   (dataAgeSeconds > 0) forces an evaluation.
 */
export function isIntervalHit(input: IntervalHitInput): boolean {
  if (input.provider === "mock") {
    return true;
  }
  if (input.isRealMode) {
    return (
      input.second === 1 ||
      input.second % 60 === 0 ||
      input.dataAgeSeconds > 0
    );
  }
  return input.second % input.jevInterval === 0;
}

/**
 * Kona 2022 has no published athlete history: zero sessions, empty baseline
 * (spec item 5 — never use generateAthleteHistory for this race).
 */
const REAL_RACE_HISTORY: AthleteHistory = {
  profile: {
    id: "kona-2022-gustav-iden",
    displayName: "Gustav Iden (historial no publicado)",
    sessions: [],
    baseline: {},
  },
  comparableSessions: [],
  comparableCount: 0,
  historyMaturity: "none",
};

/** Training block reported to /api/decide in real mode (no published plan). */
const REAL_RACE_BLOCK: TrainingBlock = "tempo";

/** Clamp any requested second into the valid range [0, totalSeconds]. */
export function clampSecond(totalSeconds: number, second: number): number {
  return Math.max(0, Math.min(totalSeconds, Math.round(second)));
}

/** The run is completed once the playback frontier reached the last second. */
export function isCompleted(totalSeconds: number, targetSecond: number): boolean {
  return targetSecond >= totalSeconds;
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
  /** Safety policy ON (guarded: composer veto rules active) or OFF
   *  (raw: the provider decision is accepted verbatim). Toggling takes
   *  effect from the next decision tick without restarting the run. */
  policyOn: boolean;
  setPolicyOn: (on: boolean) => void;
  speed: Speed;
  setSpeed: (speed: Speed) => void;
  heartRateZones: HeartRateZone[];
  setHeartRateZones: (zones: HeartRateZone[]) => void;

  // data source (synthetic scenarios vs the real Kona 2022 telemetry)
  dataSource: DataSource;
  setDataSource: (source: DataSource) => void;
  realSeed: number;
  setRealSeed: (seed: number) => void;
  realDurationOverride: number | null;
  setRealDurationOverride: (duration: number | null) => void;
  realStatus: RealWindowStatus;
  realWindow: RealRaceWindowPayload | null;

  // session descriptor (source of truth for the session length and origin)
  session: SessionDescriptor;

  // data
  samples: RunningSample[];
  history: AthleteHistory;
  block: TrainingBlock;
  /** Undefined in real-race mode: no published pre-race target. */
  paceTarget: PaceTargetSecPerKm | undefined;
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

  // evaluation (real mode only): coherence view of the selected decision
  // against the telemetry that followed it. Pure client-side recompute,
  // never persisted (spec: evaluation rows incl. human labels are for
  // external review, not client storage).
  evaluationForSelected: RaceDecisionEvaluation | null;

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
  const [policyOn, setPolicyOnState] = useState<boolean>(true);
  const [speed, setSpeedState] = useState<Speed>(1);
  const [heartRateZones, setHeartRateZonesState] = useState<HeartRateZone[]>(
    () => DEFAULT_HEART_RATE_ZONES.map((zone) => ({ ...zone })),
  );

  // Real-race mode (Kona 2022): data source, seed/duration controls and the
  // window fetched from GET /api/race-window.
  const [dataSource, setDataSourceState] = useState<DataSource>("synthetic");
  const [realSeed, setRealSeedState] = useState<number>(DEFAULT_REAL_SEED);
  const [realDurationOverride, setRealDurationOverrideState] = useState<number | null>(null);
  const [realWindow, setRealWindow] = useState<RealRaceWindowPayload | null>(null);
  const [realStatus, setRealStatus] = useState<RealWindowStatus>("idle");

  const [playing, setPlaying] = useState(false);
  const [targetSecond, setTargetSecond] = useState(0);
  const [entries, setEntries] = useState<DecisionEntry[]>([]);
  const [selectedSecond, setSelectedSecond] = useState(0);
  const [apiMode, setApiMode] = useState<"mock" | "jev">("mock");
  const [failureNote, setFailureNote] = useState<string | null>(null);

  const isRealMode = dataSource === "real";
  const realReady = realStatus === "ready";

  const samples = useMemo(() => {
    if (isRealMode) {
      return realWindow?.samples ?? [];
    }
    return generateScenarioSamples(scenarioId, SEED);
  }, [isRealMode, realWindow, scenarioId]);

  // Real race: never generateAthleteHistory (spec item 5) — the published
  // dataset has no athlete history, so the profile is empty and fail-closed.
  const history = useMemo(
    () => (isRealMode ? REAL_RACE_HISTORY : generateAthleteHistory(historyCount, SEED)),
    [isRealMode, historyCount],
  );
  // The history select is ignored in real mode: exactly 0 comparable sessions.
  const effectiveHistoryCount: HistoryCount = isRealMode ? 0 : historyCount;

  // Session descriptor: the single source of truth for the session length and
  // origin (spec: real-race validation, items 2-3).
  const session = useMemo<SessionDescriptor>(() => {
    if (isRealMode) {
      if (realWindow !== null) {
        return {
          samples: realWindow.samples,
          totalSeconds: realWindow.visibleDurationSeconds,
          source: {
            kind: "real-race",
            id: realWindow.id,
            seed: realSeed,
            startSourceIndex: realWindow.startSourceIndex,
            visibleDurationSeconds: realWindow.visibleDurationSeconds,
            prerollSeconds: realWindow.prerollSeconds,
          },
        };
      }
      // Window not loaded yet: empty session, pump is gated on realStatus.
      return {
        samples: [],
        totalSeconds: 0,
        source: {
          kind: "real-race",
          id: "kona-2022-gustav-iden",
          seed: realSeed,
          startSourceIndex: 0,
          visibleDurationSeconds: 0,
          prerollSeconds: 90,
        },
      };
    }
    return {
      samples,
      totalSeconds: samples.length,
      source: { kind: "synthetic-scenario", scenarioId },
    };
  }, [isRealMode, realWindow, realSeed, samples, scenarioId]);

  const definition = SCENARIOS[scenarioId];
  // Real mode has no published plan: report "tempo" with NO pace target and
  // let the fail-closed guard deny increases server-side (spec item 7).
  const block: TrainingBlock = isRealMode ? REAL_RACE_BLOCK : definition.block;
  const paceTarget: PaceTargetSecPerKm | undefined = isRealMode
    ? undefined
    : definition.targetPaceSecPerKm;
  const baseline = isRealMode ? REAL_RACE_HISTORY.profile.baseline : history.profile.baseline;

  // Mutable mirrors for the async pump; assigned on every render.
  const configRef = useRef({
    scenarioId,
    historyCount: effectiveHistoryCount,
    provider,
    jevInterval,
    policyOn,
    block,
    paceTarget,
    baseline,
    heartRateZones,
    samples,
    isRealMode,
    realReady,
  });
  configRef.current = {
    scenarioId,
    historyCount: effectiveHistoryCount,
    provider,
    jevInterval,
    policyOn,
    block,
    paceTarget,
    baseline,
    heartRateZones,
    samples,
    isRealMode,
    realReady,
  };

  const entriesRef = useRef<DecisionEntry[]>(entries);
  entriesRef.current = entries;
  const targetSecondRef = useRef(targetSecond);
  targetSecondRef.current = targetSecond;
  // Mutable mirror of the session length for callbacks/effect timers; stable
  // per memoized samples, so reading it inside updaters is never stale.
  const totalSecondsRef = useRef(session.totalSeconds);
  totalSecondsRef.current = session.totalSeconds;
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

  // Changing scenario, history, or the real-race source invalidates the run.
  useEffect(() => {
    resetRun();
  }, [scenarioId, historyCount, dataSource, realSeed, realDurationOverride, heartRateZones, resetRun]);

  // Real window fetch: /api/race-window?seed=..[&durationSeconds=..]. Runs
  // only in real mode; a failed load is surfaced via realStatus + failureNote
  // and the pump stays gated until realStatus is "ready".
  useEffect(() => {
    if (!isRealMode) {
      setRealStatus("idle");
      setRealWindow(null);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setRealStatus("loading");
    const params = new URLSearchParams({ seed: String(realSeed) });
    if (realDurationOverride !== null) {
      params.set("durationSeconds", String(realDurationOverride));
    }
    fetch(`/api/race-window?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        const payload = (await res.json()) as
          | { window: RealRaceWindowPayload }
          | { error: string; message?: string };
        if (cancelled) {
          return;
        }
        if (!res.ok || !("window" in payload)) {
          setRealStatus("error");
          const err = payload as { error?: string; message?: string };
          const hint = err.message ?? err.error ?? "error desconocido";
          setFailureNote(`Real race: could not load the window (${hint}).`);
          return;
        }
        setRealWindow(payload.window);
        setRealStatus("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setRealStatus("error");
          setFailureNote(
            "Real race: network failure while loading the telemetry window (/api/race-window).",
          );
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isRealMode, realSeed, realDurationOverride]);

  const computeEntry = useCallback(async (second: number, runId: number): Promise<DecisionEntry> => {
    const cfg = configRef.current;
    const idx = second - 1;
    const sample = cfg.samples[idx];
    if (sample === undefined) {
      throw new Error(`sample out of range: ${second}`);
    }
    const prev = entriesRef.current[entriesRef.current.length - 1] ?? null;
    if (cfg.isRealMode && !cfg.realReady) {
      // No real window loaded: the pump must never decide without samples.
      throw new Error("real_window_not_ready");
    }

    const intervalHit = isIntervalHit({
      provider: cfg.provider,
      second,
      isRealMode: cfg.isRealMode,
      jevInterval: cfg.jevInterval,
      dataAgeSeconds: sample.dataAgeSeconds,
    });
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
        heartRateZones: cfg.heartRateZones,
        policyMode: cfg.policyOn ? "guarded" : "raw",
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
        `Failed to reach the decision provider at second ${second}: holding pace and the simulation continues.`,
      );
      // Composer-equivalent fallback computed from the pure domain modules.
      const metrics = computeDerivedMetrics({
        samples: cfg.samples.slice(0, second),
        second,
        targetPaceSecPerKm: cfg.paceTarget,
        baseline: cfg.baseline,
        comparableHistoryCount: cfg.historyCount,
        block: cfg.block,
        heartRateZones: cfg.heartRateZones,
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
  // playback target, one fetch at a time, in order. Gated in real mode until
  // the window is ready (no samples -> no decisions).
  const pumpAllowed = !isRealMode || realReady;
  useEffect(() => {
    if (pumpRunningRef.current) {
      return;
    }
    if (!pumpAllowed) {
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
  }, [targetSecond, computeEntry, pumpAllowed]);

  // Playback ticker: advances the target at the selected speed.
  useEffect(() => {
    if (!playing) {
      return;
    }
    const intervalMs = 1000 / speed;
    const timer = setInterval(() => {
      setTargetSecond((current) => {
        if (current >= totalSecondsRef.current) {
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

  // Post-hoc evaluation of the decision in effect at the selected second,
  // against the observed telemetry that followed it (real mode only). Pure
  // and memoized over entries/selectedSecond/samples; never persisted.
  const evaluationForSelected = useMemo(() => {
    if (!isRealMode) {
      return null;
    }
    const entry =
      entries.find((candidate) => candidate.second === selectedSecond) ?? null;
    if (entry === null) {
      return null;
    }
    const sampleAtSecond = samples[selectedSecond - 1];
    if (sampleAtSecond === undefined) {
      return null;
    }
    return evaluateDecisionAgainstObserved(entry.trace, samples, entry.second);
  }, [isRealMode, entries, selectedSecond, samples]);

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

  const setPolicyOn = useCallback((on: boolean) => {
    setPolicyOnState(on);
  }, []);

  const setSpeed = useCallback((value: Speed) => {
    setSpeedState(value);
  }, []);

  const setHeartRateZones = useCallback((zones: HeartRateZone[]) => {
    setHeartRateZonesState(zones);
  }, []);

  const setDataSource = useCallback((source: DataSource) => {
    setDataSourceState(source);
  }, []);

  const setRealSeed = useCallback((seed: number) => {
    setRealSeedState(seed);
  }, []);

  const setRealDurationOverride = useCallback((duration: number | null) => {
    setRealDurationOverrideState(duration);
  }, []);

  const togglePlay = useCallback(() => {
    setPlaying((wasPlaying) => {
      if (!wasPlaying && targetSecondRef.current >= totalSecondsRef.current) {
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
    setTargetSecond((current) => clampSecond(totalSecondsRef.current, current + 1));
    setSelectedSecond((current) => clampSecond(totalSecondsRef.current, current + 1));
  }, []);

  const selectSecond = useCallback((second: number) => {
    autoFollowRef.current = false;
    setSelectedSecond(clampSecond(totalSecondsRef.current, second));
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
    policyOn,
    setPolicyOn,
    speed,
    setSpeed,
    heartRateZones,
    setHeartRateZones,
    dataSource,
    setDataSource,
    realSeed,
    setRealSeed,
    realDurationOverride,
    setRealDurationOverride,
    realStatus,
    realWindow,
    samples,
    session,
    history,
    block,
    paceTarget,
    baseline,
    playing,
    togglePlay,
    restart,
    stepOneSecond,
    targetSecond,
    completed: isCompleted(session.totalSeconds, targetSecond),
    entries,
    selectedSecond,
    selectSecond,
    evaluationForSelected,
    apiMode,
    failureNote,
    totalSeconds: session.totalSeconds,
  };
}
