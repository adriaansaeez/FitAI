"use client";

/**
 * Single-page demo screen for the simulated Jev race.
 *
 * Composition: controls -> summary cards -> watch panel -> status notes -> synchronized
 * charts -> decision table -> audit panel. All decision evaluation happens
 * server-side via POST /api/decide; the API key never reaches the client.
 */

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { AuditPanel } from "@/components/AuditPanel";
import { ControlsBar } from "@/components/ControlsBar";
import { DecisionTable } from "@/components/DecisionTable";
import { SummaryCards } from "@/components/SummaryCards";
import { LiveSimulationPanel } from "@/components/LiveSimulationPanel";
import { useRaceSimulation } from "@/components/useRaceSimulation";
import { REAL_MODE_ATTRIBUTION } from "@/components/labels";
import { SCENARIOS } from "@/simulation/scenarios";

const SynchronizedCharts = dynamic(
  () => import("@/components/SynchronizedCharts").then((mod) => mod.SynchronizedCharts),
  {
    ssr: false,
    loading: () => <p className="note">Loading charts…</p>,
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
        <h1>Race demo with Jev</h1>
        <p className="disclaimer">
          Demonstration with simulated data and pilot thresholds. Not a diagnosis,
          medical advice, or injury prevention; safety always dominates.
        </p>
      </header>

      {/* Narrowed props: per-tick frontier/selection updates (entries,
           selectedSecond) no longer re-render the controls bar. */}
      <ControlsBar
        apiMode={sim.apiMode}
        completed={sim.completed}
        dataSource={sim.dataSource}
        heartRateZones={sim.heartRateZones}
        historyCount={sim.historyCount}
        jevInterval={sim.jevInterval}
        playing={sim.playing}
        policyOn={sim.policyOn}
        provider={sim.provider}
        realDurationOverride={sim.realDurationOverride}
        realSeed={sim.realSeed}
        restart={sim.restart}
        scenarioId={sim.scenarioId}
        setDataSource={sim.setDataSource}
        setHeartRateZones={sim.setHeartRateZones}
        setHistoryCount={sim.setHistoryCount}
        setJevInterval={sim.setJevInterval}
        setPolicyOn={sim.setPolicyOn}
        setProvider={sim.setProvider}
        setRealDurationOverride={sim.setRealDurationOverride}
        setRealSeed={sim.setRealSeed}
        setScenarioId={sim.setScenarioId}
        setSpeed={sim.setSpeed}
        speed={sim.speed}
        stepOneSecond={sim.stepOneSecond}
        targetSecond={sim.targetSecond}
        togglePlay={sim.togglePlay}
        totalSeconds={sim.totalSeconds}
      />

      <SummaryCards entry={selectedEntry} sample={selectedSample} />

      <LiveSimulationPanel
        entries={sim.entries}
        samples={sim.samples}
        targetPaceSecPerKm={
          sim.session.source.kind === "synthetic-scenario"
            ? SCENARIOS[sim.scenarioId].targetPaceSecPerKm
            : null
        }
      />

      {sim.dataSource === "real" ? (
        <p className="banner banner-info">{REAL_MODE_ATTRIBUTION}</p>
      ) : null}
      {sim.realStatus === "error" ? (
        <p className="banner banner-warning" role="alert">
          Could not load real telemetry. If the source CSV is missing, run{" "}
          <code>node scripts/download-kona-2022.mjs</code> and retry.
        </p>
      ) : null}
      {sim.failureNote !== null ? (
        <p className="banner banner-warning" role="alert">
          {sim.failureNote}
        </p>
      ) : null}
      {sim.historyCount === 0 ? (
        <p className="banner banner-info">No personal reference; limited confidence.</p>
      ) : null}

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

      <AuditPanel
        entry={selectedEntry}
        sample={selectedSample}
        baseline={sim.baseline}
        dataSource={sim.dataSource}
        realWindow={sim.realWindow}
        evaluation={sim.evaluationForSelected}
      />

      <footer className="page-footer">
        <p>
          The API key (TYPESAFE_API_KEY) lives only on the server; without a key the
          demo runs in “Simulation mode” with the deterministic mock provider.
        </p>
      </footer>
    </main>
  );
}
