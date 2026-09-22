"use client";

/**
 * Top controls: scenario, history sessions, provider, Jev interval, playback
 * (restart / play-pause / step / speed), current second and mode indicator.
 * Semantic labels + aria-pressed toggles; sober CSS from globals.css.
 */

import { useState } from "react";
import {
  JEVI_INTERVAL_OPTIONS,
  SPEED_OPTIONS,
  type JevInterval,
  type ProviderChoice,
  type RaceSimulation,
  type Speed,
} from "./useRaceSimulation";
import {
  REAL_MODE_HISTORY_NOTE,
  REAL_MODE_INTERVAL_LABEL,
  SCENARIO_LABELS,
  SOURCE_KIND_LABELS,
} from "./labels";
import { HISTORY_COUNT_OPTIONS } from "@/simulation/history";
import { SCENARIO_IDS } from "@/simulation/scenarios";
import type { HistoryCount } from "@/simulation/history";
import type { HeartRateZone } from "@/domain/heartRateZones";

type ZoneDraft = { minBpm: string; maxBpm: string };

function toZoneConfig(drafts: readonly ZoneDraft[]): HeartRateZone[] | null {
  if (drafts.length !== 5) return null;
  const zones = drafts.map((draft, index) => ({
    zone: (index + 1) as HeartRateZone["zone"],
    minBpm: Number(draft.minBpm),
    maxBpm: Number(draft.maxBpm),
  }));
  if (zones.some((zone) => !Number.isInteger(zone.minBpm) || !Number.isInteger(zone.maxBpm) || zone.minBpm <= 0 || zone.minBpm > zone.maxBpm)) return null;
  return zones.every((zone, index) => index === 0 || zone.minBpm === zones[index - 1]!.maxBpm + 1)
    ? zones
    : null;
}

/** Client-side bounds for the optional real-mode visible duration (seconds). */
const REAL_DURATION_MIN = 600;
const REAL_DURATION_MAX = 1800;

export function ControlsBar({ sim }: { sim: RaceSimulation }) {
  const isRealMode = sim.dataSource === "real";
  const [zoneDrafts, setZoneDrafts] = useState<ZoneDraft[]>(() =>
    sim.heartRateZones.map((zone) => ({ minBpm: String(zone.minBpm), maxBpm: String(zone.maxBpm) })),
  );
  const zonesValid = toZoneConfig(zoneDrafts) !== null;

  const updateZoneDraft = (index: number, field: keyof ZoneDraft, value: string) => {
    setZoneDrafts((current) => {
      const next = current.map((draft, draftIndex) =>
        draftIndex === index ? { ...draft, [field]: value } : draft,
      );
      const zones = toZoneConfig(next);
      if (zones !== null) sim.setHeartRateZones(zones);
      return next;
    });
  };

  // Draft text for the optional duration input: committed into the hook only
  // when it parses inside [REAL_DURATION_MIN, REAL_DURATION_MAX]; empty means
  // "random but deterministic" (override null).
  const [durationDraft, setDurationDraft] = useState<string>(
    sim.realDurationOverride === null ? "" : String(sim.realDurationOverride),
  );
  const durationParsed = Number.parseInt(durationDraft.trim(), 10);
  const durationInvalid =
    durationDraft.trim() !== "" &&
    (Number.isNaN(durationParsed) ||
      durationParsed < REAL_DURATION_MIN ||
      durationParsed > REAL_DURATION_MAX);

  const handleDurationChange = (value: string) => {
    setDurationDraft(value);
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isNaN(parsed)) {
      return; // keep the last committed override while typing
    }
    if (parsed >= REAL_DURATION_MIN && parsed <= REAL_DURATION_MAX) {
      sim.setRealDurationOverride(parsed);
    }
  };

  const handleDurationBlur = () => {
    const trimmed = durationDraft.trim();
    if (trimmed === "") {
      sim.setRealDurationOverride(null);
      setDurationDraft("");
      return;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isNaN(parsed)) {
      // Free text: revert to the last committed override.
      setDurationDraft(sim.realDurationOverride === null ? "" : String(sim.realDurationOverride));
      return;
    }
    const clamped = Math.min(REAL_DURATION_MAX, Math.max(REAL_DURATION_MIN, parsed));
    sim.setRealDurationOverride(clamped);
    setDurationDraft(String(clamped));
  };

  const modeBadge =
    sim.apiMode === "jev" ? (
      <span className="badge badge-jev">Jev</span>
    ) : (
      <span className="badge badge-mock">Simulation mode</span>
    );

  return (
    <section className="controls" aria-label="Demo controls">
      <div className="control-group">
        <label htmlFor="source-select">Source</label>
        <select
          id="source-select"
          value={sim.dataSource === "real" ? "real" : sim.scenarioId}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "real") {
              sim.setDataSource("real");
              return;
            }
            const match = SCENARIO_IDS.find((id) => id === value);
            if (match !== undefined) {
              sim.setDataSource("synthetic");
              sim.setScenarioId(match);
            }
          }}
        >
          <optgroup label={SOURCE_KIND_LABELS.synthetic}>
            {SCENARIO_IDS.map((id) => (
              <option key={id} value={id}>
                {SCENARIO_LABELS[id]}
              </option>
            ))}
          </optgroup>
          <option value="real">{SOURCE_KIND_LABELS.real}</option>
        </select>
      </div>

      <div className="control-group">
        <label htmlFor="scenario-select">Scenario</label>
        <select
          id="scenario-select"
          value={sim.scenarioId}
          disabled={isRealMode}
          onChange={(event) => {
            const value = event.target.value;
            const match = SCENARIO_IDS.find((id) => id === value);
            if (match !== undefined) {
              sim.setScenarioId(match);
            }
          }}
        >
          {SCENARIO_IDS.map((id) => (
            <option key={id} value={id}>
              {SCENARIO_LABELS[id]}
            </option>
          ))}
        </select>
      </div>

      <div className="control-group">
        <label htmlFor="history-select">History sessions</label>
        <select
          id="history-select"
          value={sim.historyCount}
          disabled={isRealMode}
          onChange={(event) => {
            const value = Number(event.target.value);
            const match = HISTORY_COUNT_OPTIONS.find((count) => count === value);
            if (match !== undefined) {
              sim.setHistoryCount(match as HistoryCount);
            }
          }}
        >
          {HISTORY_COUNT_OPTIONS.map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </select>
        {isRealMode ? <p className="note">{REAL_MODE_HISTORY_NOTE}</p> : null}
      </div>

      <div className="control-group">
        <label htmlFor="provider-select">Provider</label>
        <select
          id="provider-select"
          value={sim.provider}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "mock" || value === "jev") {
              sim.setProvider(value as ProviderChoice);
            }
          }}
        >
          <option value="mock">Mock</option>
          <option value="jev">Jev</option>
        </select>
      </div>

      <div className="control-group">
        <label htmlFor="policy-toggle">Safety policy</label>
        <span>
          <input
            id="policy-toggle"
            type="checkbox"
            checked={sim.policyOn}
            onChange={(event) => sim.setPolicyOn(event.target.checked)}
          />{" "}
          {sim.policyOn ? "On (guarded)" : "Off (raw)"}
        </span>
        <p className="note">
          {sim.policyOn
            ? "The composer may veto or correct the provider decision."
            : "Raw mode: the provider decision is accepted as-is. The symptom hard-stop stays active."}
        </p>
      </div>

      <fieldset className="control-group zone-editor" aria-describedby="heart-rate-zones-note">
        <legend>HR zones (bpm)</legend>
        <div className="zone-fields">
          {zoneDrafts.map((zone, index) => (
            <label key={index} className="zone-field">
              <span>Z{index + 1}</span>
              <input
                aria-label={`Zone ${index + 1}, min`}
                type="number"
                min={1}
                step={1}
                value={zone.minBpm}
                onChange={(event) => updateZoneDraft(index, "minBpm", event.target.value)}
              />
              <span className="zone-separator" aria-hidden="true">–</span>
              <input
                aria-label={`Zone ${index + 1}, max`}
                type="number"
                min={1}
                step={1}
                value={zone.maxBpm}
                onChange={(event) => updateZoneDraft(index, "maxBpm", event.target.value)}
              />
            </label>
          ))}
        </div>
        <p id="heart-rate-zones-note" className="note" role={zonesValid ? undefined : "alert"}>
          {zonesValid
            ? "Zones are contiguous and active. Changing them restarts the simulation."
            : "Enter five integer zones, contiguous and non-overlapping, with min less than or equal to max."}
        </p>
      </fieldset>

      <div className="control-group">
        {isRealMode ? (
          <span className="control-label">Jev interval</span>
        ) : (
          <label htmlFor="interval-select">Jev interval</label>
        )}
        {isRealMode ? (
          <p className="note">{REAL_MODE_INTERVAL_LABEL}</p>
        ) : (
          <select
            id="interval-select"
            value={sim.jevInterval}
            onChange={(event) => {
              const value = Number(event.target.value);
              const match = JEVI_INTERVAL_OPTIONS.find((interval) => interval === value);
              if (match !== undefined) {
                sim.setJevInterval(match as JevInterval);
              }
            }}
          >
            {JEVI_INTERVAL_OPTIONS.map((interval) => (
              <option key={interval} value={interval}>
                {interval} s
              </option>
            ))}
          </select>
        )}
      </div>

      {isRealMode ? (
        <>
          <div className="control-group">
            <label htmlFor="real-seed-input">Seed (real mode)</label>
            <input
              id="real-seed-input"
              type="number"
              min={0}
              step={1}
              value={sim.realSeed}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                if (!Number.isNaN(parsed)) {
                  sim.setRealSeed(Math.max(0, parsed));
                }
              }}
            />
          </div>

          <div className="control-group">
            <label htmlFor="real-duration-input">Visible duration (s)</label>
            <input
              id="real-duration-input"
              type="number"
              min={REAL_DURATION_MIN}
              max={REAL_DURATION_MAX}
              step={1}
              placeholder="Deterministic random"
              value={durationDraft}
              onChange={(event) => handleDurationChange(event.target.value)}
              onBlur={handleDurationBlur}
            />
            {durationInvalid ? (
              <p className="note">A value between 600 and 1800 s will be applied.</p>
            ) : durationDraft.trim() === "" ? (
              <p className="note">Empty: deterministic random duration (600–1800 s).</p>
            ) : null}
          </div>
        </>
      ) : null}

      <div className="control-group" role="group" aria-label="Playback controls">
        <span className="control-label" id="playback-label">
          Playback
        </span>
        <div className="button-row" role="group" aria-labelledby="playback-label">
          <button type="button" className="btn" onClick={sim.restart}>
            Restart
          </button>
          <button
            type="button"
            className="btn"
            aria-pressed={sim.playing}
            onClick={sim.togglePlay}
            disabled={sim.completed && !sim.playing}
          >
            {sim.playing ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={sim.stepOneSecond}
            disabled={sim.completed}
          >
            Step 1 s
          </button>
          {SPEED_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className="btn btn-speed"
              aria-pressed={sim.speed === option}
              onClick={() => sim.setSpeed(option as Speed)}
            >
              {option}x
            </button>
          ))}
        </div>
      </div>

      <div className="control-group status-group">
        <span className="control-label">Status</span>
        <div className="status-row">
          <span className="second-indicator">
            Second <strong>{sim.targetSecond}</strong> / {sim.totalSeconds}
          </span>
          {modeBadge}
        </div>
        {sim.provider === "jev" ? (
          <p className="note">
            The Jev call interval is for demonstration only; it is not
            production cadence.
          </p>
        ) : null}
        {sim.completed ? <p className="note">Simulation complete.</p> : null}
      </div>
    </section>
  );
}
