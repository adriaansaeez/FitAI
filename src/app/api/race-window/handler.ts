/**
 * Handler logic for GET /api/race-window.
 *
 * Kept out of route.ts because Next.js type-checks Route exports strictly:
 * only runtime/dynamic/GET (and friends) may be exported from route.ts.
 *
 * Serves a deterministic real-race window (Kona 2022 / Gustav Iden) built by
 * the server-only adapter src/simulation/realRace/kona2022.ts. This module is
 * server-only too: it reads the dataset from disk and must never be imported
 * from a client component.
 *
 * Contract (spec: docs/research/validacion-carrera-real-kona-2022.md, item 2):
 * - GET ?seed=<int>[&durationSeconds=<600..1800>]
 * - CSV path resolution order: deps.csvPath (tests) -> env KONA_2022_CSV ->
 *   data/kona-2022/gustav_iden.csv relative to process.cwd().
 * - Missing dataset -> 409 { error: "dataset_missing", message } with
 *   instructions to run scripts/download-kona-2022.mjs (this route NEVER
 *   auto-downloads and never imports scripts/).
 * - KonaImportError -> 422 { error: "invalid_dataset", message }.
 * - Success -> 200 { window: RealRaceWindow } (full object incl. sha256
 *   provenance and samples).
 */

import { readFile as fsReadFile } from "node:fs/promises";
import path from "node:path";
import {
  buildRealRaceWindow,
  KonaImportError,
  MAX_VISIBLE_SECONDS,
  MIN_VISIBLE_SECONDS,
} from "../../../simulation/realRace/kona2022";

/** Default dataset location, relative to process.cwd(). */
export const DEFAULT_CSV_RELATIVE_PATH = path.join(
  "data",
  "kona-2022",
  "gustav_iden.csv",
);

export type RaceWindowHandlerDeps = {
  /** Injectable for tests; defaults to node:fs/promises readFile (utf8). */
  readFile?: (filePath: string) => Promise<string>;
  /** Injectable for tests; overrides env/cwd path resolution. */
  csvPath?: string;
};

export type RaceWindowQuery =
  | { ok: true; seed: number; durationSeconds?: number }
  | { ok: false; details: string[] };

/** Strict integer format: digits only (Number() would accept "42 " or "0x2a"). */
const INTEGER_PATTERN = /^-?\d+$/;

/**
 * Parse and validate the query string. seed is a required integer;
 * durationSeconds, when present (non-empty), must be an integer in
 * [600, 1800] (the adapter enforces the dataset-length bound itself).
 */
export function parseRaceWindowQuery(searchParams: URLSearchParams): RaceWindowQuery {
  const details: string[] = [];

  const rawSeed = searchParams.get("seed");
  let seed: number | null = null;
  if (rawSeed === null || rawSeed.trim() === "") {
    details.push("seed is required and must be an integer");
  } else if (!INTEGER_PATTERN.test(rawSeed)) {
    details.push(`seed must be an integer, got "${rawSeed}"`);
  } else {
    seed = Number(rawSeed);
  }

  let durationSeconds: number | undefined;
  const rawDuration = searchParams.get("durationSeconds");
  if (rawDuration !== null && rawDuration.trim() !== "") {
    if (!INTEGER_PATTERN.test(rawDuration)) {
      details.push(`durationSeconds must be an integer, got "${rawDuration}"`);
    } else {
      const duration = Number(rawDuration);
      if (duration < MIN_VISIBLE_SECONDS || duration > MAX_VISIBLE_SECONDS) {
        details.push(
          `durationSeconds must be an integer between ${MIN_VISIBLE_SECONDS} and ${MAX_VISIBLE_SECONDS}, got "${rawDuration}"`,
        );
      } else {
        durationSeconds = duration;
      }
    }
  }

  if (details.length > 0 || seed === null) {
    return { ok: false, details: details.length > 0 ? details : ["seed is required"] };
  }
  return durationSeconds === undefined
    ? { ok: true, seed }
    : { ok: true, seed, durationSeconds };
}

/**
 * CSV path resolution order: deps.csvPath (tests) -> env KONA_2022_CSV ->
 * data/kona-2022/gustav_iden.csv relative to process.cwd().
 * An empty KONA_2022_CSV is treated as unset.
 */
export function resolveRaceWindowCsvPath(deps: RaceWindowHandlerDeps = {}): string {
  if (deps.csvPath !== undefined) {
    return deps.csvPath;
  }
  const fromEnv = process.env.KONA_2022_CSV;
  if (fromEnv !== undefined && fromEnv.trim() !== "") {
    return fromEnv;
  }
  return path.join(process.cwd(), DEFAULT_CSV_RELATIVE_PATH);
}

function datasetMissingMessage(csvPath: string): string {
  return (
    `Dataset Kona 2022 no encontrado en "${csvPath}". ` +
    `Ejecuta "node scripts/download-kona-2022.mjs" para descargarlo ` +
    `(o define KONA_2022_CSV con la ruta al CSV).`
  );
}

/**
 * Factory so tests can inject readFile/csvPath without touching the
 * filesystem or the environment.
 */
export function createRaceWindowHandler(deps: RaceWindowHandlerDeps = {}) {
  const readFile = deps.readFile ?? (async (filePath: string) => fsReadFile(filePath, "utf8"));
  return async function raceWindow(request: Request): Promise<Response> {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return Response.json(
        { error: "invalid_request", details: ["unparseable request URL"] },
        { status: 400 },
      );
    }
    const query = parseRaceWindowQuery(url.searchParams);
    if (!query.ok) {
      return Response.json({ error: "invalid_request", details: query.details }, { status: 400 });
    }

    const csvPath = resolveRaceWindowCsvPath(deps);
    let csvText: string;
    try {
      csvText = await readFile(csvPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (code === "ENOENT") {
        return Response.json(
          { error: "dataset_missing", message: datasetMissingMessage(csvPath) },
          { status: 409 },
        );
      }
      return Response.json(
        {
          error: "dataset_read_failed",
          message: `No se pudo leer el dataset en "${csvPath}".`,
        },
        { status: 500 },
      );
    }

    try {
      const window = buildRealRaceWindow(csvText, query.seed, query.durationSeconds);
      return Response.json({ window }, { status: 200 });
    } catch (error) {
      if (error instanceof KonaImportError) {
        return Response.json(
          { error: "invalid_dataset", message: error.message },
          { status: 422 },
        );
      }
      throw error;
    }
  };
}
