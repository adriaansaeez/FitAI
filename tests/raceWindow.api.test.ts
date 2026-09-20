/**
 * T6 (kona-2022-real-race): GET /api/race-window + real-mode decision cadence.
 *
 * Covers:
 * (a) query param validation (bad seed, out-of-range durationSeconds),
 * (b) the pure interval decision used by the hook (real mode: second 1, every
 *     60 s, forced on dataAgeSeconds > 0; synthetic mode unchanged modulo),
 * (c) handler CSV-path resolution and the dataset_missing error path via an
 *     injectable readFile.
 *
 * The handler is designed as createRaceWindowHandler({ readFile, csvPath })
 * so these tests never touch the real filesystem.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRaceWindowHandler,
  DEFAULT_CSV_RELATIVE_PATH,
} from "../src/app/api/race-window/handler";
import { isIntervalHit } from "../src/components/useRaceSimulation";
import { EXPECTED_HEADER } from "../src/simulation/realRace/kona2022";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal but valid Entalpi CSV: >= 690 monotonic 1 Hz rows. */
function makeCsv(rows: number, startMs: number = Date.UTC(2022, 9, 8, 12, 0, 0)): string {
  const lines: string[] = [EXPECTED_HEADER];
  for (let i = 0; i < rows; i += 1) {
    const datetime = new Date(startMs + i * 1000).toISOString();
    lines.push(`${datetime},59.12,10.25,5.5,10,150,90,1.8`);
  }
  return `${lines.join("\n")}\n`;
}

function getRequest(query: string): Request {
  return new Request(`http://localhost/api/race-window${query}`);
}

function enoent(): Error {
  return Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
}

interface CapturingReadFile {
  (filePath: string): Promise<string>;
  calls: string[];
}

function readFileThat(behavior: (filePath: string) => Promise<string>): CapturingReadFile {
  const fn = ((filePath: string) => behavior(filePath)) as CapturingReadFile;
  fn.calls = [];
  const wrapped: CapturingReadFile = (filePath: string) => {
    fn.calls.push(filePath);
    return fn(filePath);
  };
  wrapped.calls = fn.calls;
  return wrapped;
}

const VALID_CSV = makeCsv(700); // 700 rows >= 690 (90 preroll + 600 visible)

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// (a) Query param validation
// ---------------------------------------------------------------------------

describe("GET /api/race-window — query validation", () => {
  it("rejects a missing seed with 400", async () => {
    const handler = createRaceWindowHandler({ readFile: async () => VALID_CSV });
    const response = await handler(getRequest(""));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
  });

  it("rejects non-integer seeds with 400", async () => {
    const handler = createRaceWindowHandler({ readFile: async () => VALID_CSV });
    for (const query of ["?seed=abc", "?seed=1.5", "?seed=", "?seed=42%20"]) {
      const response = await handler(getRequest(query));
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("invalid_request");
    }
  });

  it("rejects out-of-range durationSeconds with 400 (600-1800)", async () => {
    const handler = createRaceWindowHandler({ readFile: async () => VALID_CSV });
    for (const query of [
      "?seed=42&durationSeconds=599",
      "?seed=42&durationSeconds=1801",
      "?seed=42&durationSeconds=abc",
      "?seed=42&durationSeconds=1.5",
    ]) {
      const response = await handler(getRequest(query));
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("invalid_request");
    }
  });

  it("returns a full RealRaceWindow on success (seed + duration override)", async () => {
    const handler = createRaceWindowHandler({ readFile: async () => VALID_CSV });
    const response = await handler(getRequest("?seed=42&durationSeconds=605"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      window: {
        id: string;
        seed: number;
        visibleDurationSeconds: number;
        prerollSeconds: number;
        startSourceIndex: number;
        samples: unknown[];
        source: { sha256: string; license: string; athlete: string };
        unavailable: { rpe: boolean; plannedTarget: boolean };
      };
    };
    expect(body.window.id).toBe("kona-2022-gustav-iden");
    expect(body.window.seed).toBe(42);
    expect(body.window.visibleDurationSeconds).toBe(605);
    expect(body.window.samples).toHaveLength(605);
    expect(body.window.prerollSeconds).toBe(90);
    expect(body.window.startSourceIndex).toBeGreaterThanOrEqual(90);
    expect(body.window.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body.window.source.license).toBe("CC BY-NC-4.0");
    expect(body.window.source.athlete).toBe("Gustav Iden");
    expect(body.window.unavailable.rpe).toBe(true);
    expect(body.window.unavailable.plannedTarget).toBe(true);
  });

  it("returns a window without a duration override (random duration in range)", async () => {
    const handler = createRaceWindowHandler({ readFile: async () => VALID_CSV });
    const response = await handler(getRequest("?seed=7"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      window: { seed: number; visibleDurationSeconds: number; samples: unknown[] };
    };
    expect(body.window.seed).toBe(7);
    // 700 rows - 90 preroll = 610 max visible duration.
    expect(body.window.visibleDurationSeconds).toBeGreaterThanOrEqual(600);
    expect(body.window.visibleDurationSeconds).toBeLessThanOrEqual(610);
    expect(body.window.samples).toHaveLength(body.window.visibleDurationSeconds);
  });

  it("is deterministic: same csvText + seed + override => identical window", async () => {
    const handler = createRaceWindowHandler({ readFile: async () => VALID_CSV });
    const a = await handler(getRequest("?seed=99&durationSeconds=600"));
    const b = await handler(getRequest("?seed=99&durationSeconds=600"));
    expect(await a.json()).toEqual(await b.json());
  });
});

// ---------------------------------------------------------------------------
// (c) CSV path resolution + error paths
// ---------------------------------------------------------------------------

describe("GET /api/race-window — CSV resolution and error mapping", () => {
  it("maps a missing file to 409 dataset_missing with download instructions", async () => {
    const readFile = readFileThat(async () => {
      throw enoent();
    });
    const handler = createRaceWindowHandler({ readFile, csvPath: "/data/csv.csv" });
    const response = await handler(getRequest("?seed=42"));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe("dataset_missing");
    expect(body.message).toContain("scripts/download-kona-2022.mjs");
  });

  it("uses the injected csvPath verbatim", async () => {
    const readFile = readFileThat(async () => VALID_CSV);
    const handler = createRaceWindowHandler({ readFile, csvPath: "/custom/path.csv" });
    const response = await handler(getRequest("?seed=42"));
    expect(response.status).toBe(200);
    expect(readFile.calls).toEqual(["/custom/path.csv"]);
  });

  it("prefers KONA_2022_CSV over the cwd-relative default", async () => {
    vi.stubEnv("KONA_2022_CSV", "/env/provided.csv");
    const readFile = readFileThat(async () => VALID_CSV);
    const handler = createRaceWindowHandler({ readFile });
    await handler(getRequest("?seed=42"));
    expect(readFile.calls).toEqual(["/env/provided.csv"]);
  });

  it("falls back to data/kona-2022/gustav_iden.csv relative to cwd", async () => {
    vi.stubEnv("KONA_2022_CSV", "");
    const readFile = readFileThat(async () => VALID_CSV);
    const handler = createRaceWindowHandler({ readFile });
    await handler(getRequest("?seed=42"));
    expect(readFile.calls).toEqual([
      `${process.cwd()}/${DEFAULT_CSV_RELATIVE_PATH}`,
    ]);
  });

  it("maps KonaImportError to 422 invalid_dataset", async () => {
    const handler = createRaceWindowHandler({
      readFile: async () => "not, the, expected, header\n1,2,3,4,5,6,7,8\n",
      csvPath: "/data/csv.csv",
    });
    const response = await handler(getRequest("?seed=42"));
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe("invalid_dataset");
    expect(body.message.length).toBeGreaterThan(0);
  });

  it("maps non-ENOENT read failures to 500 dataset_read_failed", async () => {
    const readFile = readFileThat(async () => {
      throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    });
    const handler = createRaceWindowHandler({ readFile, csvPath: "/data/csv.csv" });
    const response = await handler(getRequest("?seed=42"));
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("dataset_read_failed");
  });
});

// ---------------------------------------------------------------------------
// (b) Pure decision-cadence rule (hook helper)
// ---------------------------------------------------------------------------

describe("isIntervalHit — decision cadence", () => {
  it("mock evaluates every second in both modes", () => {
    for (const second of [1, 2, 7, 60, 61, 600]) {
      expect(
        isIntervalHit({ provider: "mock", second, isRealMode: false, jevInterval: 15, dataAgeSeconds: 0 }),
      ).toBe(true);
      expect(
        isIntervalHit({ provider: "mock", second, isRealMode: true, jevInterval: 15, dataAgeSeconds: 0 }),
      ).toBe(true);
    }
  });

  it("synthetic mode keeps the modulo logic (jevInterval select)", () => {
    expect(
      isIntervalHit({ provider: "jev", second: 5, isRealMode: false, jevInterval: 5, dataAgeSeconds: 0 }),
    ).toBe(true);
    expect(
      isIntervalHit({ provider: "jev", second: 10, isRealMode: false, jevInterval: 5, dataAgeSeconds: 0 }),
    ).toBe(true);
    expect(
      isIntervalHit({ provider: "jev", second: 7, isRealMode: false, jevInterval: 5, dataAgeSeconds: 0 }),
    ).toBe(false);
    // Second 1 is NOT special in synthetic mode.
    expect(
      isIntervalHit({ provider: "jev", second: 1, isRealMode: false, jevInterval: 5, dataAgeSeconds: 0 }),
    ).toBe(false);
  });

  it("real mode evaluates the first visible second", () => {
    expect(
      isIntervalHit({ provider: "jev", second: 1, isRealMode: true, jevInterval: 5, dataAgeSeconds: 0 }),
    ).toBe(true);
  });

  it("real mode evaluates every stable 60 s and skips the seconds between", () => {
    expect(
      isIntervalHit({ provider: "jev", second: 60, isRealMode: true, jevInterval: 5, dataAgeSeconds: 0 }),
    ).toBe(true);
    expect(
      isIntervalHit({ provider: "jev", second: 120, isRealMode: true, jevInterval: 5, dataAgeSeconds: 0 }),
    ).toBe(true);
    expect(
      isIntervalHit({ provider: "jev", second: 61, isRealMode: true, jevInterval: 5, dataAgeSeconds: 0 }),
    ).toBe(false);
    expect(
      isIntervalHit({ provider: "jev", second: 33, isRealMode: true, jevInterval: 5, dataAgeSeconds: 0 }),
    ).toBe(false);
  });

  it("real mode forces evaluation on a data discontinuity (dataAgeSeconds > 0)", () => {
    expect(
      isIntervalHit({ provider: "jev", second: 33, isRealMode: true, jevInterval: 5, dataAgeSeconds: 2 }),
    ).toBe(true);
    // dataAgeSeconds === 0 is not a discontinuity.
    expect(
      isIntervalHit({ provider: "jev", second: 33, isRealMode: true, jevInterval: 5, dataAgeSeconds: 0 }),
    ).toBe(false);
  });
});
