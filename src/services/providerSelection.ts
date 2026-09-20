/**
 * Server-side decision-provider selection.
 *
 * TYPESAFE_API_KEY stays on the server: when it is present the real
 * JevDecisionProvider is used; otherwise the deterministic mock runs and the
 * UI shows "Modo simulación".
 *
 * Selection is read per call (not at module load) so server configuration is
 * honored at request time and tests can stub the environment cleanly.
 */

import type { DecisionProvider } from "./provider";
import { MockDecisionProvider } from "./mockDecisionProvider";
import { JevDecisionProvider } from "./jevDecisionProvider";

export type ProviderMode = "jev" | "mock";

/** True only for a non-empty, non-whitespace key (mirrors SDK env handling). */
function hasApiKey(): boolean {
  const key = process.env.TYPESAFE_API_KEY;
  return typeof key === "string" && key.trim().length > 0;
}

export function getProviderMode(): ProviderMode {
  return hasApiKey() ? "jev" : "mock";
}

/** When true the UI header should show "Modo simulación". */
export function isSimulationMode(): boolean {
  return getProviderMode() === "mock";
}

/**
 * Fresh provider per call. Both implementations are stateless; constructing
 * per request keeps configuration changes visible immediately.
 */
export function getDecisionProvider(): DecisionProvider {
  if (getProviderMode() === "jev") {
    return new JevDecisionProvider();
  }
  return new MockDecisionProvider();
}
