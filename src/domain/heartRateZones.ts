import type { TrainingBlock } from "./types";

/** One manually configured, inclusive heart-rate zone. */
export type HeartRateZone = {
  zone: 1 | 2 | 3 | 4 | 5;
  minBpm: number;
  maxBpm: number;
};

export type HeartRateZonePosition = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type HeartRateZoneTarget = { minZone: 1 | 2 | 3 | 4 | 5; maxZone: 1 | 2 | 3 | 4 | 5 };

/** Editable defaults for a recreational runner; not medical guidance. */
export const DEFAULT_HEART_RATE_ZONES: readonly HeartRateZone[] = [
  { zone: 1, minBpm: 100, maxBpm: 119 },
  { zone: 2, minBpm: 120, maxBpm: 139 },
  { zone: 3, minBpm: 140, maxBpm: 154 },
  { zone: 4, minBpm: 155, maxBpm: 169 },
  { zone: 5, minBpm: 170, maxBpm: 190 },
];

export const HEART_RATE_ZONE_EXCESS_SECONDS = 60;

export function targetHeartRateZone(block: TrainingBlock): HeartRateZoneTarget {
  switch (block) {
    case "warmup":
    case "recovery":
      return { minZone: 1, maxZone: 2 };
    case "easy":
      return { minZone: 2, maxZone: 2 };
    case "tempo":
      return { minZone: 3, maxZone: 4 };
    case "interval":
      return { minZone: 4, maxZone: 5 };
  }
}

/** 0 = below Z1, 6 = above Z5; null stays unknown. */
export function heartRateZonePosition(
  heartRateBpm: number | null,
  zones: readonly HeartRateZone[],
): HeartRateZonePosition | null {
  if (heartRateBpm === null || zones.length !== 5) return null;
  if (heartRateBpm < zones[0]!.minBpm) return 0;
  for (const zone of zones) {
    if (heartRateBpm >= zone.minBpm && heartRateBpm <= zone.maxBpm) return zone.zone;
  }
  return 6;
}

export function heartRateZoneLabel(position: HeartRateZonePosition | null): string {
  if (position === null) return "—";
  if (position === 0) return "Por debajo de Z1";
  if (position === 6) return "Por encima de Z5";
  return `Z${position}`;
}
