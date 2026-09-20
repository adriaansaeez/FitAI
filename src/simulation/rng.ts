/**
 * Deterministic seeded PRNG helpers.
 *
 * Pure and seed-driven: the same seed always produces the same stream.
 * No Math.random anywhere in simulation or domain code.
 */

export type Rng = () => number;

/** Deterministic integer hash so any seed (including 0) yields a full-range stream. */
export function hashSeed(seed: number): number {
  let h = seed | 0;
  h = Math.imul(h ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Mulberry32 PRNG: small, fast, deterministic. Returns floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = hashSeed(seed);
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed: number): Rng {
  return mulberry32(seed);
}

/** Uniform float in [min, max). */
export function rngRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Uniform integer in [min, max] (inclusive). */
export function rngInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rngRange(rng, min, max + 1));
}

/** Approximate standard normal via the Box-Muller transform, deterministic per stream. */
export function rngGauss(rng: Rng, mean: number, stdDev: number): number {
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + stdDev * z;
}

/** Pick one element of a non-empty array, deterministically. */
export function rngPick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error("rngPick requires a non-empty array");
  }
  return items[rngInt(rng, 0, items.length - 1)] as T;
}
