/**
 * Real-race source adapter: Gustav Iden, IRONMAN World Championship Kona 2022.
 *
 * Server/build-only module (never import from a client component): parses,
 * validates, normalizes and window-selects the public Entalpi telemetry CSV.
 *
 * Normative source: docs/research/validacion-carrera-real-kona-2022.md
 * ("Contrato de entrada y normalización", "Selección aleatoria, reproducible y
 * útil", "Calidad de datos").
 *
 * Hard rules from the source doc:
 * - No smoothing, filling, peak removal or GPS correction in this adapter.
 * - Absent fields are `null`; never zero, never interpolated.
 * - Same dataset + seed (+ optional duration override) => identical window.
 * - The 90 s preroll exists only so pace (45 s) and HR (75 s) windows are full
 *   at the first visible second; it is never exposed as samples.
 */

import { createHash } from "node:crypto";
import type { RunningSample } from "../../domain/types";
import { createRng, rngInt } from "../rng";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MIN_VISIBLE_SECONDS = 10 * 60; // 600
export const MAX_VISIBLE_SECONDS = 30 * 60; // 1800
export const PREROLL_SECONDS = 90; // >= HR_WINDOW_SECONDS (75) and PACE_WINDOW_SECONDS (45)
export const MIN_SOURCE_ROWS = PREROLL_SECONDS + MIN_VISIBLE_SECONDS; // 690

/** Exact first-line header; identical to scripts/kona-download-lib.mjs. */
export const EXPECTED_HEADER =
  "datetime,latitude,longitude,speed,elevation,heartrate,cadence,stride_length";

const SOURCE_URL =
  "https://raw.githubusercontent.com/entalpi-no/kona-2022/main/gustav_iden_copyright_entalpi_as.csv";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Failure with a specific, auditable reason. */
export class KonaImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KonaImportError";
  }
}

/** One parsed CSV row. Published values are preserved verbatim (no rounding). */
export type RawRow = {
  /** 0-based data-row index in the CSV (header excluded). */
  sourceIndex: number;
  /** Original datetime string exactly as published. */
  datetime: string;
  /** Parsed epoch milliseconds (same instant, unchanged). */
  timestampMs: number;
  /** m/s */
  speed: number | null;
  /** metres, absolute reference preserved */
  elevation: number | null;
  /** bpm */
  heartrate: number | null;
  /** published `/min` value; step-vs-stride semantics unknown */
  cadence: number | null;
  latitude: number | null;
  longitude: number | null;
  strideLength: number | null;
};

/** Result of the deterministic window selection. */
export type SelectedRows = {
  preroll: RawRow[];
  visible: RawRow[];
  /** 0-based source index of the first visible row. */
  startSourceIndex: number;
};

/** Full real-race window with provenance, per the source-doc contract. */
export type RealRaceWindow = {
  id: "kona-2022-gustav-iden";
  source: {
    url: string;
    license: "CC BY-NC-4.0";
    sha256: string;
    athlete: "Gustav Iden";
    event: "IRONMAN World Championship Kona 2022";
  };
  seed: number;
  startSourceIndex: number;
  visibleDurationSeconds: number;
  prerollSeconds: 90;
  samples: RunningSample[];
  unavailable: {
    rpe: true;
    symptoms: "not_reported_by_dataset";
    personalHistory: true;
    plannedTarget: true;
  };
  /** Window metadata (added fields, never removed). */
  cadenceSemantics: "source_per_min_unknown";
  symptomsSource: "not_reported_by_dataset";
  /** ISO 8601 UTC of the first visible sample. */
  startTimestamp: string;
  /** ISO 8601 UTC of the last visible sample. */
  endTimestamp: string;
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function toNumberOrNull(cell: string): number | null {
  const trimmed = cell.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * Validates and parses the raw Entalpi CSV.
 *
 * Throws KonaImportError for: a header that is not exactly EXPECTED_HEADER,
 * invalid/unparseable timestamps, non-monotonic (or duplicate) timestamps, and
 * fewer than MIN_SOURCE_ROWS (690) data rows. Empty/unparseable numeric fields
 * become `null` — never zero, never interpolated.
 */
export function parseKonaCsv(csvText: string): RawRow[] {
  const lines = csvText.split(/\r?\n/);
  const header = lines[0];
  if (header === undefined || header !== EXPECTED_HEADER) {
    throw new KonaImportError(
      `Header mismatch: first line does not equal the expected Entalpi CSV header.\n` +
        `  expected: ${EXPECTED_HEADER}\n` +
        `  actual:   ${header ?? "<empty file>"}`,
    );
  }

  const rows: RawRow[] = [];
  let previousTimestampMs: number | null = null;

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    if (line === undefined || line.trim() === "") continue; // trailing newline / blank line
    const cells = line.split(",");
    if (cells.length !== 8) {
      throw new KonaImportError(
        `Row ${lineIndex} has ${cells.length} fields; expected exactly 8 (header columns).`,
      );
    }
    const datetime = cells[0] ?? "";
    const timestampMs = Date.parse(datetime.trim());
    if (datetime.trim() === "" || Number.isNaN(timestampMs)) {
      throw new KonaImportError(
        `Invalid timestamp at row ${lineIndex}: "${datetime}" is not parseable.`,
      );
    }
    if (previousTimestampMs !== null && timestampMs <= previousTimestampMs) {
      throw new KonaImportError(
        `Non-monotonic timestamps at row ${lineIndex}: "${datetime}" does not strictly follow the previous row.`,
      );
    }
    previousTimestampMs = timestampMs;
    rows.push({
      sourceIndex: rows.length,
      datetime,
      timestampMs,
      latitude: toNumberOrNull(cells[1] ?? ""),
      longitude: toNumberOrNull(cells[2] ?? ""),
      speed: toNumberOrNull(cells[3] ?? ""),
      elevation: toNumberOrNull(cells[4] ?? ""),
      heartrate: toNumberOrNull(cells[5] ?? ""),
      cadence: toNumberOrNull(cells[6] ?? ""),
      strideLength: toNumberOrNull(cells[7] ?? ""),
    });
  }

  if (rows.length < MIN_SOURCE_ROWS) {
    throw new KonaImportError(
      `Dataset too short: ${rows.length} rows; at least ${MIN_SOURCE_ROWS} ` +
        `(${PREROLL_SECONDS} preroll + ${MIN_VISIBLE_SECONDS} visible) are required.`,
    );
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export type NormalizeOptions = {
  /**
   * Row immediately before the first row of `rows` (e.g. the last preroll
   * row). Used only for the first point's gradePct; it is not exposed as a
   * sample and does not affect distance re-basing.
   */
  prevRow?: RawRow;
};

function paceFromSpeed(speed: number | null): number | null {
  return speed !== null && speed > 0 ? 1000 / speed : null;
}

/**
 * Maps raw rows to RunningSample following the source-doc table exactly.
 * distanceM is a local cumulative sum of speed × deltaSeconds starting at 0
 * for the first row of `rows` (so when called with the visible rows only, the
 * first visible sample is 0). Grade of the first point uses `prevRow`'s
 * elevation (and the distance of that second) when provided.
 */
export function normalizeRows(rows: RawRow[], options?: NormalizeOptions): RunningSample[] {
  const samples: RunningSample[] = [];
  let cumulativeDistanceM = 0;
  // Elevation carry-forward: RunningSample.elevationM is non-nullable, so a
  // missing published elevation keeps the last known absolute reference
  // (documented; the adapter never invents or smooths values).
  let lastElevationM: number | null = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row === undefined) continue;
    const prevRow = i === 0 ? options?.prevRow : rows[i - 1];

    const deltaSeconds =
      prevRow !== undefined ? (row.timestampMs - prevRow.timestampMs) / 1000 : null;

    // Distance of this second, integrating this row's own speed over the
    // interval since the previous sample (same convention as
    // accumulateDistance in domain/metrics.ts: each sample's distance includes
    // its own pace contribution; null/non-positive speed holds still).
    const distanceOfSecond =
      deltaSeconds !== null && deltaSeconds > 0 && row.speed !== null && row.speed > 0
        ? row.speed * deltaSeconds
        : 0;

    // Local cumulative distance: 0 at the first row of the window, so when
    // called with the visible rows only, the first visible sample is 0.
    const distanceM = i === 0 ? 0 : cumulativeDistanceM + distanceOfSecond;
    cumulativeDistanceM = distanceM;

    const elevationM: number = row.elevation ?? lastElevationM ?? 0;

    // Quality policy (source doc, "Calidad de datos"):
    // - low:  delta > 15 s, non-monotonic timestamps, or both pace and HR missing
    // - high: delta == 1 s and pace + HR present (dataAgeSeconds 0)
    // - medium: everything else (2-15 s delta or one of pace/HR missing)
    const pace = paceFromSpeed(row.speed);
    const hr = row.heartrate !== null && Number.isFinite(row.heartrate) ? row.heartrate : null;
    let signalQuality: RunningSample["signalQuality"];
    let dataAgeSeconds: number;
    if (deltaSeconds !== null && deltaSeconds <= 0) {
      // Non-monotonic/duplicate timestamps (defensive; parseKonaCsv rejects them).
      signalQuality = "low";
      dataAgeSeconds = 0;
    } else if (deltaSeconds === null) {
      // First sample with no previous-row context: 1 s cadence cannot be
      // verified, so it cannot be "high"; nothing indicates staleness either.
      signalQuality = "medium";
      dataAgeSeconds = 0;
    } else if (deltaSeconds > 15 || (pace === null && hr === null)) {
      signalQuality = "low";
      dataAgeSeconds = deltaSeconds;
    } else if (deltaSeconds === 1 && pace !== null && hr !== null) {
      signalQuality = "high";
      dataAgeSeconds = 0;
    } else {
      signalQuality = "medium";
      dataAgeSeconds = deltaSeconds;
    }

    let gradePct = 0;
    if (distanceOfSecond > 0) {
      const prevElevation =
        prevRow !== undefined ? (prevRow.elevation ?? lastElevationM) : lastElevationM;
      if (prevElevation !== null) {
        gradePct = ((elevationM - prevElevation) / distanceOfSecond) * 100;
      }
    }

    samples.push({
      second: i + 1,
      timestamp: new Date(row.timestampMs).toISOString(),
      paceSecPerKm: pace,
      heartRateBpm: hr,
      distanceM,
      elevationM,
      gradePct,
      cadenceSpm: row.cadence,
      signalQuality,
      dataAgeSeconds,
      autoPaused: false,
      symptomsReported: false,
    });

    lastElevationM = elevationM;
  }
  return samples;
}

// ---------------------------------------------------------------------------
// Window selection
// ---------------------------------------------------------------------------

/**
 * Deterministic random window selection (source-doc pseudo-code). Uses the
 * shared seeded RNG only; never Math.random.
 */
export function selectWindow(
  rows: RawRow[],
  seed: number,
  durationSecondsOverride?: number,
): SelectedRows {
  if (rows.length < MIN_SOURCE_ROWS) {
    throw new KonaImportError(
      `Dataset too short for window selection: ${rows.length} rows; ` +
        `at least ${MIN_SOURCE_ROWS} are required.`,
    );
  }
  const rng = createRng(seed);
  const maxDuration = Math.min(MAX_VISIBLE_SECONDS, rows.length - PREROLL_SECONDS);
  let duration: number;
  if (durationSecondsOverride !== undefined) {
    if (
      !Number.isInteger(durationSecondsOverride) ||
      durationSecondsOverride < MIN_VISIBLE_SECONDS ||
      durationSecondsOverride > MAX_VISIBLE_SECONDS ||
      durationSecondsOverride > rows.length - PREROLL_SECONDS
    ) {
      throw new KonaImportError(
        `Invalid duration override ${durationSecondsOverride}: must be an integer within ` +
          `${MIN_VISIBLE_SECONDS}-${MAX_VISIBLE_SECONDS} and at most ${rows.length - PREROLL_SECONDS} ` +
          `(rows minus preroll).`,
      );
    }
    duration = durationSecondsOverride;
  } else {
    duration = rngInt(rng, MIN_VISIBLE_SECONDS, maxDuration);
  }
  const maxStart = rows.length - PREROLL_SECONDS - duration;
  const start = rngInt(rng, 0, maxStart);
  const preroll = rows.slice(start, start + PREROLL_SECONDS);
  const visible = rows.slice(start + PREROLL_SECONDS, start + PREROLL_SECONDS + duration);
  return {
    preroll,
    visible,
    startSourceIndex: start + PREROLL_SECONDS,
  };
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/**
 * Full pipeline: parse -> select -> normalize -> provenance. Deterministic for
 * the same csvText, seed and (optional) duration override.
 */
export function buildRealRaceWindow(
  csvText: string,
  seed: number,
  durationSecondsOverride?: number,
): RealRaceWindow {
  const rows = parseKonaCsv(csvText);
  const { preroll, visible, startSourceIndex } = selectWindow(rows, seed, durationSecondsOverride);
  const lastPrerollRow = preroll[preroll.length - 1];
  const samples = normalizeRows(visible, { prevRow: lastPrerollRow });
  const sha256 = createHash("sha256").update(csvText, "utf8").digest("hex");
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (first === undefined || last === undefined) {
    throw new KonaImportError("Window selection produced no visible samples.");
  }
  return {
    id: "kona-2022-gustav-iden",
    source: {
      url: SOURCE_URL,
      license: "CC BY-NC-4.0",
      sha256,
      athlete: "Gustav Iden",
      event: "IRONMAN World Championship Kona 2022",
    },
    seed,
    startSourceIndex,
    visibleDurationSeconds: visible.length,
    prerollSeconds: PREROLL_SECONDS as 90,
    samples,
    unavailable: {
      rpe: true,
      symptoms: "not_reported_by_dataset",
      personalHistory: true,
      plannedTarget: true,
    },
    cadenceSemantics: "source_per_min_unknown",
    symptomsSource: "not_reported_by_dataset",
    startTimestamp: first.timestamp,
    endTimestamp: last.timestamp,
  };
}

// ---------------------------------------------------------------------------
// Test helper: synthetic valid CSV + corrupt variants
// ---------------------------------------------------------------------------

export type TestCsvRowOverride = {
  /** 0-based data-row index. */
  index: number;
  /** String values are written verbatim; null/undefined → empty cell for optional numeric fields. */
  speed?: string | null;
  elevation?: string | null;
  heartrate?: string | null;
  cadence?: string | null;
  latitude?: string;
  longitude?: string;
  strideLength?: string | null;
  /** Verbatim datetime replacement (used to corrupt timestamps). */
  datetime?: string;
};

export type TestCsvOptions = {
  header?: string;
  startDatetime?: string;
  /**
   * Introduces a timestamp gap: rows at `atIndex` and later are shifted
   * forward by `seconds` extra (on top of the nominal 1 s cadence), keeping
   * the series monotonic with a single observed delta of 1 + seconds.
   */
  gap?: { atIndex: number; seconds: number };
  overrides?: TestCsvRowOverride[];
};

function formatDatetime(date: Date): string {
  // Same shape as the source: `2022-10-08 21:30:07+00:00`.
  return date.toISOString().replace("T", " ").replace(".000Z", "+00:00");
}

/**
 * Builds a synthetic valid CSV with 1 s contiguous deltas for tests, plus
 * corrupt variants via options. Default cells mirror the first published
 * source row (speed 3.49 m/s, elevation -9.2 m, HR 159, cadence 85.0).
 */
export function buildTestCsv(rowCount: number, options?: TestCsvOptions): string {
  const header = options?.header ?? EXPECTED_HEADER;
  const start = new Date(options?.startDatetime ?? "2022-10-08 21:30:07+00:00");
  const overridesByIndex = new Map<number, TestCsvRowOverride>();
  for (const override of options?.overrides ?? []) {
    overridesByIndex.set(override.index, override);
  }
  const lines: string[] = [header];
  for (let i = 0; i < rowCount; i++) {
    const override = overridesByIndex.get(i);
    const gapOffset = options?.gap !== undefined && i >= options.gap.atIndex ? options.gap.seconds : 0;
    const date = new Date(start.getTime() + (i + gapOffset) * 1000);
    const datetime = override?.datetime ?? formatDatetime(date);
    const speed = override && "speed" in override ? override.speed : "3.49";
    const elevation = override && "elevation" in override ? override.elevation : "-9.2";
    const heartrate = override && "heartrate" in override ? override.heartrate : "159";
    const cadence = override && "cadence" in override ? override.cadence : "85.0";
    const latitude = override?.latitude ?? "19.641769845038652";
    const longitude = override?.longitude ?? "-155.99632889963686";
    const strideLength = override && "strideLength" in override ? override.strideLength : "";
    lines.push(
      [datetime, latitude, longitude, speed ?? "", elevation ?? "", heartrate ?? "", cadence ?? "", strideLength ?? ""].join(
        ",",
      ),
    );
  }
  return lines.join("\n");
}
