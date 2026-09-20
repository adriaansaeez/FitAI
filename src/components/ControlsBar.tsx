"use client";

/**
 * Top controls: scenario, history sessions, provider, Jev interval, playback
 * (restart / play-pause / step / speed), current second and mode indicator.
 * Semantic labels + aria-pressed toggles; sober CSS from globals.css.
 */

import {
  JEVI_INTERVAL_OPTIONS,
  SPEED_OPTIONS,
  type JevInterval,
  type ProviderChoice,
  type RaceSimulation,
  type Speed,
} from "./useRaceSimulation";
import { SCENARIO_LABELS } from "./labels";
import { HISTORY_COUNT_OPTIONS } from "@/simulation/history";
import { SCENARIO_IDS } from "@/simulation/scenarios";
import type { HistoryCount } from "@/simulation/history";

export function ControlsBar({ sim }: { sim: RaceSimulation }) {
  const modeBadge =
    sim.apiMode === "jev" ? (
      <span className="badge badge-jev">Jev</span>
    ) : (
      <span className="badge badge-mock">Modo simulación</span>
    );

  return (
    <section className="controls" aria-label="Controles de la demo">
      <div className="control-group">
        <label htmlFor="scenario-select">Escenario</label>
        <select
          id="scenario-select"
          value={sim.scenarioId}
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
        <label htmlFor="interval-select">Intervalo Jev</label>
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
      </div>

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
