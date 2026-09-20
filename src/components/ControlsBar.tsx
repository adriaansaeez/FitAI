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

/** Client-side bounds for the optional real-mode visible duration (seconds). */
const REAL_DURATION_MIN = 600;
const REAL_DURATION_MAX = 1800;

export function ControlsBar({ sim }: { sim: RaceSimulation }) {
  const isRealMode = sim.dataSource === "real";

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
      <span className="badge badge-mock">Modo simulación</span>
    );

  return (
    <section className="controls" aria-label="Controles de la demo">
      <div className="control-group">
        <label htmlFor="source-select">Fuente</label>
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
        <label htmlFor="scenario-select">Escenario</label>
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
        <label htmlFor="history-select">Sesiones históricas</label>
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
        <label htmlFor="provider-select">Proveedor</label>
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
        {isRealMode ? (
          <span className="control-label">Intervalo Jev</span>
        ) : (
          <label htmlFor="interval-select">Intervalo Jev</label>
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
            <label htmlFor="real-seed-input">Semilla (modo real)</label>
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
            <label htmlFor="real-duration-input">Duración visible (s)</label>
            <input
              id="real-duration-input"
              type="number"
              min={REAL_DURATION_MIN}
              max={REAL_DURATION_MAX}
              step={1}
              placeholder="Aleatoria determinista"
              value={durationDraft}
              onChange={(event) => handleDurationChange(event.target.value)}
              onBlur={handleDurationBlur}
            />
            {durationInvalid ? (
              <p className="note">Se aplicará un valor entre 600 y 1800 s.</p>
            ) : durationDraft.trim() === "" ? (
              <p className="note">Vacío: duración aleatoria determinista (600–1800 s).</p>
            ) : null}
          </div>
        </>
      ) : null}

      <div className="control-group" role="group" aria-label="Control de reproducción">
        <span className="control-label" id="playback-label">
          Reproducción
        </span>
        <div className="button-row" role="group" aria-labelledby="playback-label">
          <button type="button" className="btn" onClick={sim.restart}>
            Reiniciar
          </button>
          <button
            type="button"
            className="btn"
            aria-pressed={sim.playing}
            onClick={sim.togglePlay}
            disabled={sim.completed && !sim.playing}
          >
            {sim.playing ? "Pausar" : "Reproducir"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={sim.stepOneSecond}
            disabled={sim.completed}
          >
            Avanzar 1 s
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
        <span className="control-label">Estado</span>
        <div className="status-row">
          <span className="second-indicator">
            Segundo <strong>{sim.targetSecond}</strong> / {sim.totalSeconds}
          </span>
          {modeBadge}
        </div>
        {sim.provider === "jev" ? (
          <p className="note">
            El intervalo de llamada a Jev es de demostración; no es cadencia de
            producción.
          </p>
        ) : null}
        {sim.completed ? <p className="note">Simulación completada.</p> : null}
      </div>
    </section>
  );
}
