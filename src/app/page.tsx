"use client";

/**
 * Single-page demo screen for the simulated Jev race.
 *
 * Composition: controls -> status notes -> summary cards -> synchronized
 * charts -> decision table -> audit panel. All decision evaluation happens
 * server-side via POST /api/decide; the API key never reaches the client.
 */

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { AuditPanel } from "@/components/AuditPanel";
import { ControlsBar } from "@/components/ControlsBar";
import { DecisionTable } from "@/components/DecisionTable";
import { SummaryCards } from "@/components/SummaryCards";
import { useRaceSimulation } from "@/components/useRaceSimulation";
import { SCENARIOS } from "@/simulation/scenarios";

const SynchronizedCharts = dynamic(
  () => import("@/components/SynchronizedCharts").then((mod) => mod.SynchronizedCharts),
  {
    ssr: false,
    loading: () => <p className="note">Cargando gráficas…</p>,
  },
);

export default function HomePage() {
  const sim = useRaceSimulation();

  const selectedSecond = sim.selectedSecond;
  const selectedEntry = useMemo(
    () => sim.entries.find((entry) => entry.second === selectedSecond) ?? null,
    [sim.entries, selectedSecond],
  );
  const selectedSample = useMemo(
    () => sim.samples[selectedSecond - 1] ?? null,
    [sim.samples, selectedSecond],
  );

  return (
    <main className="page">
      <header className="page-header">
        <h1>Demo de carrera con Jev</h1>
        <p className="disclaimer">
          Demostración con datos simulados y umbrales de piloto. No es diagnóstico,
          consejo médico ni prevención de lesiones; la seguridad siempre domina.
        </p>
      </header>

      <ControlsBar sim={sim} />

      {sim.failureNote !== null ? (
        <p className="banner banner-warning" role="alert">
          {sim.failureNote}
        </p>
      ) : null}
      {sim.historyCount === 0 ? (
        <p className="banner banner-info">Sin referencia personal; confianza limitada.</p>
      ) : null}

      <SummaryCards entry={selectedEntry} sample={selectedSample} />

      <SynchronizedCharts
        samples={sim.samples}
        baseline={sim.baseline}
        historyEstablished={sim.history.historyMaturity === "established"}
        entries={sim.entries}
        selectedSecond={selectedSecond}
        onSelect={sim.selectSecond}
        targetPaceSecPerKm={
          // Real-race sessions have no published, verifiable pace target.
          sim.session.source.kind === "synthetic-scenario"
            ? SCENARIOS[sim.scenarioId].targetPaceSecPerKm
            : null
        }
        totalSeconds={sim.session.totalSeconds}
      />

      <DecisionTable
        entries={sim.entries}
        samples={sim.samples}
        selectedSecond={selectedSecond}
        onSelect={sim.selectSecond}
      />

      <AuditPanel entry={selectedEntry} sample={selectedSample} baseline={sim.baseline} />

      <footer className="page-footer">
        <p>
          La clave de API (TYPESAFE_API_KEY) vive solo en el servidor; sin clave la
          demo funciona en «Modo simulación» con el proveedor determinista mock.
        </p>
      </footer>
    </main>
  );
}
