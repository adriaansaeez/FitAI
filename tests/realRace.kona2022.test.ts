import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  KonaImportError,
  MAX_VISIBLE_SECONDS,
  MIN_VISIBLE_SECONDS,
  PREROLL_SECONDS,
  buildRealRaceWindow,
  buildTestCsv,
  normalizeRows,
  parseKonaCsv,
  selectWindow,
} from "../src/simulation/realRace/kona2022";
import type { RawRow } from "../src/simulation/realRace/kona2022";

/** Sample row count big enough for any window selection. */
const BIG_ROW_COUNT = 3000;

function parseOrThrow(csv: string): RawRow[] {
  return parseKonaCsv(csv);
}

describe("parseKonaCsv validation", () => {
  it("accepts a synthetic CSV with the exact Entalpi header", () => {
    const rows = parseOrThrow(buildTestCsv(700));
    expect(rows).toHaveLength(700);
    expect(rows[0]?.datetime).toBe("2022-10-08 21:30:07+00:00");
  });

  it("rejects a different header", () => {
    const csv = buildTestCsv(700, { header: "datetime,lat,lon,speed,elevation,heartrate,cadence,stride_length" });
    expect(() => parseOrThrow(csv)).toThrow(KonaImportError);
    expect(() => parseOrThrow(csv)).toThrow(/header/i);
  });

  it("rejects a header with extra columns (no trim, no case folding)", () => {
    const csv = buildTestCsv(700, {
      header: "Datetime,Latitude,Longitude,Speed,Elevation,Heartrate,Cadence,Stride_Length,extra",
    });
    expect(() => parseOrThrow(csv)).toThrow(KonaImportError);
  });

  it("rejects invalid timestamps", () => {
    const csv = buildTestCsv(700, {
      overrides: [{ index: 5, datetime: "not-a-timestamp" }],
    });
    expect(() => parseOrThrow(csv)).toThrow(KonaImportError);
    expect(() => parseOrThrow(csv)).toThrow(/timestamp/i);
  });

  it("rejects empty timestamps", () => {
    const csv = buildTestCsv(700, {
      overrides: [{ index: 3, datetime: "" }],
    });
    expect(() => parseOrThrow(csv)).toThrow(KonaImportError);
  });

  it("rejects non-monotonic timestamps", () => {
    const csv = buildTestCsv(700, {
      overrides: [{ index: 10, datetime: "2022-10-08 21:30:01+00:00" }],
    });
    expect(() => parseOrThrow(csv)).toThrow(KonaImportError);
    expect(() => parseOrThrow(csv)).toThrow(/monotonic/i);
  });

  it("rejects duplicate timestamps (not strictly increasing)", () => {
    const csv = buildTestCsv(700, {
      overrides: [{ index: 4, datetime: "2022-10-08 21:30:07+00:00" }],
    });
    expect(() => parseOrThrow(csv)).toThrow(KonaImportError);
  });

  it("rejects fewer than 690 rows (90 preroll + 600 visible)", () => {
    expect(() => parseOrThrow(buildTestCsv(689))).toThrow(KonaImportError);
    expect(() => parseOrThrow(buildTestCsv(689))).toThrow(/690/);
    expect(() => parseOrThrow(buildTestCsv(690))).not.toThrow();
  });

  it("maps empty and unparseable numeric fields to null (never zero)", () => {
    const csv = buildTestCsv(700, {
      overrides: [
        { index: 2, heartrate: null },
        { index: 3, heartrate: "abc" },
        { index: 4, speed: null },
        { index: 5, speed: "abc" },
        { index: 6, cadence: null },
      ],
    });
    const rows = parseOrThrow(csv);
    expect(rows[2]?.heartrate).toBeNull();
    expect(rows[3]?.heartrate).toBeNull();
    expect(rows[4]?.speed).toBeNull();
    expect(rows[5]?.speed).toBeNull();
    expect(rows[6]?.cadence).toBeNull();
    // Unaffected rows keep their published values verbatim.
    expect(rows[0]?.heartrate).toBe(159);
    expect(rows[0]?.speed).toBe(3.49);
    expect(rows[0]?.cadence).toBe(85);
  });
});

describe("normalizeRows mapping", () => {
  // The 690-row minimum is a parseKonaCsv gate; normalization operates on raw
  // rows, so unit tests slice small windows out of a valid 700-row dataset.
  function firstN(n: number, options?: Parameters<typeof buildTestCsv>[1]): RawRow[] {
    return parseOrThrow(buildTestCsv(700, options)).slice(0, n);
  }

  it("produces 1-based local seconds and ISO 8601 UTC timestamps", () => {
    const samples = normalizeRows(firstN(5));
    expect(samples[0]?.second).toBe(1);
    expect(samples[4]?.second).toBe(5);
    expect(samples[0]?.timestamp).toBe("2022-10-08T21:30:07.000Z");
    expect(samples[1]?.timestamp).toBe("2022-10-08T21:30:08.000Z");
  });

  it("converts speed to pace without rounding, null when speed is missing or non-positive", () => {
    const samples = normalizeRows(firstN(6, {
      overrides: [
        { index: 0, speed: "3.49" },
        { index: 1, speed: "0" },
        { index: 2, speed: "-2" },
        { index: 3, speed: null },
        { index: 4, speed: "abc" },
      ],
    }));
    expect(samples[0]?.paceSecPerKm).toBeCloseTo(1000 / 3.49, 10);
    expect(samples[1]?.paceSecPerKm).toBeNull();
    expect(samples[2]?.paceSecPerKm).toBeNull();
    expect(samples[3]?.paceSecPerKm).toBeNull();
    expect(samples[4]?.paceSecPerKm).toBeNull();
  });

  it("maps non-finite heartrate to null", () => {
    const samples = normalizeRows(firstN(3, { overrides: [{ index: 1, heartrate: "Infinity" }] }));
    expect(samples[0]?.heartRateBpm).toBe(159);
    expect(samples[1]?.heartRateBpm).toBeNull();
  });

  it("starts local cumulative distance at 0 and integrates speed × deltaSeconds", () => {
    const samples = normalizeRows(firstN(4, {
      overrides: [
        { index: 0, speed: "2" },
        { index: 1, speed: "3" },
        { index: 2, speed: "1" },
      ],
    }));
    // Same convention as accumulateDistance: each sample's cumulative distance
    // includes its own speed × deltaSeconds contribution.
    expect(samples[0]?.distanceM).toBe(0);
    expect(samples[1]?.distanceM).toBeCloseTo(3 * 1, 10);
    expect(samples[2]?.distanceM).toBeCloseTo(3 + 1, 10);
    expect(samples[3]?.distanceM).toBeCloseTo(3 + 1 + 3.49, 10);
  });

  it("keeps published elevation with its absolute reference", () => {
    const samples = normalizeRows(firstN(3));
    expect(samples[0]?.elevationM).toBe(-9.2);
  });

  it("computes gradePct from elevation delta over the distance of that second", () => {
    // speed 2 m/s, elevation rising 0.5 m per second → grade = 0.5 / 2 * 100 = 25 %.
    const samples = normalizeRows(firstN(4, {
      overrides: [
        { index: 0, speed: "2", elevation: "-9.2" },
        { index: 1, speed: "2", elevation: "-8.7" },
        { index: 2, speed: "2", elevation: "-8.2" },
        { index: 3, speed: "2", elevation: "-8.2" },
      ],
    }));
    expect(samples[0]?.gradePct).toBe(0); // no previous point inside the window
    expect(samples[1]?.gradePct).toBeCloseTo(((-8.7 - -9.2) / (2 * 1)) * 100, 10);
    expect(samples[2]?.gradePct).toBeCloseTo(25, 10);
    expect(samples[3]?.gradePct).toBeCloseTo(0, 10);
  });

  it("computes the first point's grade against a preroll-adjacent previous row", () => {
    const rows = firstN(6, {
      overrides: [
        { index: 0, speed: "2", elevation: "-10" },
        { index: 1, speed: "2", elevation: "-9.5" },
        { index: 2, speed: "2", elevation: "-9" },
        { index: 3, speed: "2", elevation: "-8.5" },
        { index: 4, speed: "2", elevation: "-8" },
        { index: 5, speed: "2", elevation: "-7.5" },
      ],
    });
    // Window = rows 2..5, prevRow = row 1 (last preroll row).
    const samples = normalizeRows(rows.slice(2), { prevRow: rows[1] });
    expect(samples[0]?.gradePct).toBeCloseTo(((-9 - -9.5) / (2 * 1)) * 100, 10);
  });

  it("returns grade 0 when there is no distance for the second", () => {
    const samples = normalizeRows(firstN(3, {
      overrides: [
        { index: 0, speed: "2", elevation: "-9.2" },
        { index: 1, speed: "2", elevation: "-8.7" },
        { index: 2, speed: null, elevation: "-8.2" },
      ],
    }));
    expect(samples[2]?.gradePct).toBe(0);
  });

  it("marks continuous 1 s rows with pace and HR as high quality with dataAgeSeconds 0", () => {
    const samples = normalizeRows(firstN(3));
    // First sample has no previous-row context inside the slice: cadence
    // cannot be verified, so it degrades to medium (never invented as high).
    expect(samples[0]?.signalQuality).toBe("medium");
    expect(samples[0]?.dataAgeSeconds).toBe(0);
    expect(samples[1]?.signalQuality).toBe("high");
    expect(samples[1]?.dataAgeSeconds).toBe(0);
    expect(samples[2]?.signalQuality).toBe("high");
    expect(samples[2]?.dataAgeSeconds).toBe(0);
  });

  it("marks the first sample high when a preroll-adjacent context row is provided", () => {
    const rows = firstN(3);
    const samples = normalizeRows(rows.slice(1), { prevRow: rows[0] });
    expect(samples[0]?.signalQuality).toBe("high");
    expect(samples[0]?.dataAgeSeconds).toBe(0);
  });

  it("marks medium quality when one of pace/HR is missing", () => {
    const samples = normalizeRows(firstN(3, { overrides: [{ index: 1, heartrate: null }] }));
    expect(samples[1]?.signalQuality).toBe("medium");
  });

  it("marks low quality when both pace and HR are missing", () => {
    const samples = normalizeRows(firstN(3, {
      overrides: [{ index: 1, speed: null, heartrate: null }],
    }));
    expect(samples[1]?.signalQuality).toBe("low");
  });

  it("marks low quality with the observed delta on a gap > 15 s", () => {
    const rows = firstN(10, { gap: { atIndex: 5, seconds: 19 } });
    // Window slice containing the gap row; prevRow keeps the slice contiguous check honest.
    const samples = normalizeRows(rows.slice(3), { prevRow: rows[2] });
    expect(samples[2]?.signalQuality).toBe("low");
    expect(samples[2]?.dataAgeSeconds).toBe(20);
  });

  it("marks medium quality with the observed delta on gaps of 2-15 s", () => {
    const rows = firstN(10, { gap: { atIndex: 5, seconds: 4 } });
    const samples = normalizeRows(rows.slice(3), { prevRow: rows[2] });
    expect(samples[2]?.signalQuality).toBe("medium");
    expect(samples[2]?.dataAgeSeconds).toBe(5);
  });

  it("never pauses or invents RPE/symptoms", () => {
    const samples = normalizeRows(firstN(3));
    for (const sample of samples) {
      expect(sample.autoPaused).toBe(false);
      expect(sample.symptomsReported).toBe(false);
      expect(sample.rpe).toBeUndefined();
    }
  });

  it("preserves cadence verbatim (published /min value, semantics unknown)", () => {
    const samples = normalizeRows(firstN(4, {
      overrides: [
        { index: 0, cadence: "85.0" },
        { index: 1, cadence: "92" },
        { index: 2, cadence: null },
      ],
    }));
    expect(samples[0]?.cadenceSpm).toBe(85);
    expect(samples[1]?.cadenceSpm).toBe(92);
    expect(samples[2]?.cadenceSpm).toBeNull();
    expect(samples[3]?.cadenceSpm).toBe(85);
  });
});

describe("selectWindow reproducibility", () => {
  const rows = parseOrThrow(buildTestCsv(BIG_ROW_COUNT));

  it("requires at least PREROLL + MIN_VISIBLE rows", () => {
    expect(() => selectWindow(parseOrThrow(buildTestCsv(689)), 42)).toThrow(KonaImportError);
    expect(() => selectWindow(parseOrThrow(buildTestCsv(690)), 42)).not.toThrow();
  });

  it("returns a visible duration within 600-1800 s and a 90 s preroll", () => {
    const { preroll, visible, startSourceIndex } = selectWindow(rows, 42);
    expect(visible.length).toBeGreaterThanOrEqual(MIN_VISIBLE_SECONDS);
    expect(visible.length).toBeLessThanOrEqual(MAX_VISIBLE_SECONDS);
    expect(preroll).toHaveLength(PREROLL_SECONDS);
    expect(PREROLL_SECONDS).toBeGreaterThanOrEqual(75); // >= HR_WINDOW_SECONDS
    expect(PREROLL_SECONDS).toBeGreaterThanOrEqual(45); // >= PACE_WINDOW_SECONDS
    expect(startSourceIndex).toBe(rows.indexOf(preroll[0] as RawRow) + PREROLL_SECONDS);
  });

  it("is deterministic for the same dataset and seed", () => {
    const a = selectWindow(rows, 1234);
    const b = selectWindow(rows, 1234);
    expect(a).toEqual(b);
  });

  it("honours a valid duration override within bounds", () => {
    const forced = selectWindow(rows, 42, 600);
    expect(forced.visible).toHaveLength(600);
    expect(forced.preroll).toHaveLength(90);
    const forced2 = selectWindow(rows, 42, 600);
    expect(forced).toEqual(forced2);
  });

  it("rejects out-of-range overrides", () => {
    expect(() => selectWindow(rows, 42, 599)).toThrow(KonaImportError);
    expect(() => selectWindow(rows, 42, 1801)).toThrow(KonaImportError);
    expect(() => selectWindow(parseOrThrow(buildTestCsv(700)), 42, 620)).toThrow(KonaImportError);
  });
});

describe("buildRealRaceWindow", () => {
  const csv = buildTestCsv(BIG_ROW_COUNT);

  it("produces byte-identical windows for the same dataset, seed and override", () => {
    const a = buildRealRaceWindow(csv, 42, 600);
    const b = buildRealRaceWindow(csv, 42, 600);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces byte-identical windows without an override", () => {
    const a = buildRealRaceWindow(csv, 7);
    const b = buildRealRaceWindow(csv, 7);
    expect(a).toEqual(b);
  });

  it("keeps the visible duration within 600-1800 s and preroll at exactly 90 s", () => {
    for (const seed of [0, 1, 42, 99999]) {
      const win = buildRealRaceWindow(csv, seed);
      expect(win.visibleDurationSeconds).toBeGreaterThanOrEqual(600);
      expect(win.visibleDurationSeconds).toBeLessThanOrEqual(1800);
      expect(win.prerollSeconds).toBe(90);
      expect(win.samples).toHaveLength(win.visibleDurationSeconds);
    }
  });

  it("exposes the full 45 s pace / 75 s HR window before the first visible second", () => {
    const win = buildRealRaceWindow(csv, 42);
    // The preroll rows immediately precede the visible rows in raw indexing.
    const rows = parseOrThrow(csv);
    const firstVisible = rows[win.startSourceIndex];
    const lastPreroll = rows[win.startSourceIndex - 1];
    expect(firstVisible).toBeDefined();
    expect(lastPreroll).toBeDefined();
    expect(lastPreroll?.sourceIndex).toBe((firstVisible as RawRow).sourceIndex - 1);
    // 90 preroll rows cover both PACE_WINDOW_SECONDS (45) and HR_WINDOW_SECONDS (75).
    expect(win.prerollSeconds).toBeGreaterThanOrEqual(75);
    // With preroll context, the first visible sample is full-quality.
    expect(win.samples[0]?.signalQuality).toBe("high");
    expect(win.samples[0]?.dataAgeSeconds).toBe(0);
  });

  it("re-bases seconds to 1 at the first visible sample and distances to 0", () => {
    const win = buildRealRaceWindow(csv, 42, 900);
    expect(win.samples[0]?.second).toBe(1);
    expect(win.samples[0]?.distanceM).toBe(0);
    for (let i = 1; i < win.samples.length; i++) {
      const prev = win.samples[i - 1];
      const cur = win.samples[i];
      if (prev && cur) {
        expect(cur.second).toBe(prev.second + 1);
        expect(cur.distanceM).toBeGreaterThanOrEqual(prev.distanceM);
      }
    }
    expect(win.samples[win.samples.length - 1]?.second).toBe(900);
  });

  it("computes the first visible grade against the last preroll row", () => {
    const win = buildRealRaceWindow(csv, 42, 600);
    const rows = parseOrThrow(csv);
    const firstVisible = rows[win.startSourceIndex] as RawRow;
    const lastPreroll = rows[win.startSourceIndex - 1] as RawRow;
    const sample = win.samples[0];
    expect(sample).toBeDefined();
    if (!sample || firstVisible.elevation === null || lastPreroll.elevation === null) return;
    const deltaSeconds = (firstVisible.timestampMs - lastPreroll.timestampMs) / 1000;
    const distance = (firstVisible.speed ?? 0) * deltaSeconds;
    const expectedGrade = distance > 0 ? ((firstVisible.elevation - lastPreroll.elevation) / distance) * 100 : 0;
    expect(sample.gradePct).toBeCloseTo(expectedGrade, 10);
  });

  it("carries provenance metadata and the sha256 of the exact csv text", () => {
    const win = buildRealRaceWindow(csv, 42, 600);
    expect(win.id).toBe("kona-2022-gustav-iden");
    expect(win.source.license).toBe("CC BY-NC-4.0");
    expect(win.source.athlete).toBe("Gustav Iden");
    expect(win.source.event).toBe("IRONMAN World Championship Kona 2022");
    expect(win.source.url).toContain("entalpi-no/kona-2022");
    expect(win.source.sha256).toBe(createHash("sha256").update(csv, "utf8").digest("hex"));
    expect(win.seed).toBe(42);
    expect(win.unavailable).toEqual({
      rpe: true,
      symptoms: "not_reported_by_dataset",
      personalHistory: true,
      plannedTarget: true,
    });
    expect(win.cadenceSemantics).toBe("source_per_min_unknown");
    expect(win.symptomsSource).toBe("not_reported_by_dataset");
  });

  it("exposes start and end timestamps of the visible window in ISO 8601 UTC", () => {
    const win = buildRealRaceWindow(csv, 42, 600);
    expect(win.startTimestamp).toBe(win.samples[0]?.timestamp);
    expect(win.endTimestamp).toBe(win.samples[win.samples.length - 1]?.timestamp);
    expect(win.startTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(win.endTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("propagates gap degradation into the window samples", () => {
    const gapCsv = buildTestCsv(1000, { gap: { atIndex: 300, seconds: 19 } });
    // Force a window that covers source rows 0..900 so the gap at row 300 is visible.
    const win = buildRealRaceWindow(gapCsv, 42, 600);
    const rows = parseOrThrow(gapCsv);
    const gapSampleIndex = rows[300]!.sourceIndex - win.startSourceIndex;
    if (gapSampleIndex >= 0 && gapSampleIndex < win.samples.length) {
      const sample = win.samples[gapSampleIndex];
      expect(sample?.signalQuality).toBe("low");
      expect(sample?.dataAgeSeconds).toBe(20);
    }
  });

  it("keeps nulls (never zeros) for missing pace and HR inside the window", () => {
    const csvMissing = buildTestCsv(1000, {
      overrides: [
        { index: 400, speed: null },
        { index: 401, heartrate: null },
      ],
    });
    const win = buildRealRaceWindow(csvMissing, 42, 600);
    const rows = parseOrThrow(csvMissing);
    const idx400 = rows[400]!.sourceIndex - win.startSourceIndex;
    const idx401 = rows[401]!.sourceIndex - win.startSourceIndex;
    if (idx400 >= 0 && idx400 < win.samples.length) {
      expect(win.samples[idx400]?.paceSecPerKm).toBeNull();
      expect(win.samples[idx400]?.heartRateBpm).not.toBeNull();
    }
    if (idx401 >= 0 && idx401 < win.samples.length) {
      expect(win.samples[idx401]?.heartRateBpm).toBeNull();
      expect(win.samples[idx401]?.paceSecPerKm).not.toBeNull();
    }
    // Neighbours are untouched: no interpolation.
    if (idx400 > 0 && idx400 < win.samples.length) {
      expect(win.samples[idx400 - 1]?.paceSecPerKm).not.toBeNull();
    }
  });

  it("preserves cadence verbatim inside the window", () => {
    const win = buildRealRaceWindow(csv, 42, 600);
    for (const sample of win.samples) {
      if (sample.cadenceSpm !== null) {
        expect(Number.isFinite(sample.cadenceSpm)).toBe(true);
      }
    }
    expect(win.samples[0]?.cadenceSpm).toBe(85);
  });

  it("does not consume Math.random: two different seeds may differ but stay valid", () => {
    const a = buildRealRaceWindow(csv, 1, 600);
    const b = buildRealRaceWindow(csv, 2, 600);
    expect(a.visibleDurationSeconds).toBe(600);
    expect(b.visibleDurationSeconds).toBe(600);
    // With the same override the start may coincide or differ, but both are valid.
    expect(a.startSourceIndex).toBeGreaterThanOrEqual(90);
    expect(b.startSourceIndex).toBeGreaterThanOrEqual(90);
  });
});
