/**
 * Route generator: 600 seconds of coherent distance / elevation / grade.
 *
 * Elevation is a smooth seeded sum of sinusoids, so grades change over the
 * session and every scenario sees real climbs and descents. Distance integrates
 * a nominal pace adjusted by grade; scenarios that define their own pace
 * integrate that pace instead and reuse only elevation/grade from here.
 * Same seed -> identical route.
 */

import { createRng, rngRange, type Rng } from "./rng";

export const DEFAULT_ROUTE_SECONDS = 600;

/** Nominal flat pace used for route distance accumulation (330 s/km ~ 5:30/km). */
export const NOMINAL_PACE_SEC_PER_KM = 330;

export interface RoutePoint {
  second: number;
  /** Cumulative distance in meters at the end of this second. */
  distanceM: number;
  /** Cumulative elevation in meters above the start. */
  elevationM: number;
  /** Grade over this second, in percent (positive = uphill). */
  gradePct: number;
}

export interface RouteProfile {
  /** Seeded sinusoid amplitudes in meters. */
  amplitudes: [number, number];
  /** Seeded periods in seconds. */
  periods: [number, number];
  /** Seeded phase offsets in radians. */
  phases: [number, number];
}

export interface RouteOptions {
  durationSeconds?: number;
  profile?: RouteProfile;
}

function elevationAt(t: number, profile: RouteProfile): number {
  const [a1, a2] = profile.amplitudes;
  const [p1, p2] = profile.periods;
  const [ph1, ph2] = profile.phases;
  return (
    a1 * Math.sin((2 * Math.PI * t) / p1 + ph1) +
    a2 * Math.sin((2 * Math.PI * t) / p2 + ph2)
  );
}

function nominalSpeed(gradePct: number): number {
  const flatSpeed = 1000 / NOMINAL_PACE_SEC_PER_KM;
  // Mild grade effect so route distance stays coherent with terrain.
  const factor = 1 - 0.02 * gradePct;
  return flatSpeed * Math.max(0.5, factor);
}

/**
 * Generate the route. `second` is 1-indexed; grade at second 1 is 0 because
 * there is no previous elevation to differ against.
 */
export function generateRoute(
  seed: number,
  options: RouteOptions = {},
): RoutePoint[] {
  const durationSeconds = options.durationSeconds ?? DEFAULT_ROUTE_SECONDS;
  const profile = options.profile ?? generateRouteProfile(seed);

  const points: RoutePoint[] = [];
  let distanceM = 0;
  let previousElevation = 0;

  for (let second = 1; second <= durationSeconds; second += 1) {
    const elevationM = elevationAt(second, profile);
    const elevationDelta = elevationM - previousElevation;
    const distanceStep = nominalSpeed(elevationAt(second - 0.5, profile));
    distanceM += distanceStep;
    const gradePct =
      second === 1 ? 0 : (elevationDelta / distanceStep) * 100;
    points.push({
      second,
      distanceM: round(distanceM),
      elevationM: round(elevationM),
      gradePct: round(gradePct, 3),
    });
    previousElevation = elevationM;
  }

  return points;
}

/** Seeded route profile: amplitudes, periods and phases drawn from the seed. */
export function generateRouteProfile(seed: number, rng: Rng = createRng(seed)): RouteProfile {
  return {
    amplitudes: [rngRange(rng, 12, 18), rngRange(rng, 3, 6)],
    periods: [rngRange(rng, 300, 420), rngRange(rng, 150, 210)],
    phases: [rngRange(rng, 0, 2 * Math.PI), rngRange(rng, 0, 2 * Math.PI)],
  };
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
