// Pure, testable helpers for scripts/download-kona-2022.mjs.
// Kept dependency-free and side-effect-free so vitest can exercise them
// without touching the network or the filesystem.

import { createHash } from "node:crypto";

/** Exact first-line header the Entalpi Kona 2022 CSV must start with. */
export const EXPECTED_HEADER =
  "datetime,latitude,longitude,speed,elevation,heartrate,cadence,stride_length";

/** Fixed attribution fields required by docs/research/validacion-carrera-real-kona-2022.md. */
export const PROVENANCE_CONSTANTS = Object.freeze({
  license: "CC BY-NC 4.0",
  athlete: "Gustav Iden",
  event: "IRONMAN World Championship Kona 2022",
});

/**
 * Validates the first line of the downloaded CSV. The header must equal
 * EXPECTED_HEADER exactly — no trim, no case folding, no extra columns.
 */
export function validateHeaderLine(firstLine) {
  if (firstLine === EXPECTED_HEADER) {
    return { ok: true };
  }
  if (firstLine.trim() === "") {
    return { ok: false, reason: "Downloaded file is empty (no header line)." };
  }
  return {
    ok: false,
    reason:
      "Header mismatch: first line does not equal the expected Entalpi CSV header.\n" +
      `  expected: ${EXPECTED_HEADER}\n` +
      `  actual:   ${firstLine}`,
  };
}

/** Lowercase hex sha256 of a string's UTF-8 bytes. */
export function sha256Hex(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Builds the provenance record written next to the downloaded CSV. */
export function buildProvenance({ sourceUrl, downloadedAt, sha256 }) {
  return {
    sourceUrl,
    downloadedAt,
    sha256,
    ...PROVENANCE_CONSTANTS,
  };
}

/**
 * Parses CLI arguments for the download script. Accepts exactly two
 * positional arguments (source URL, destination path) plus the optional
 * --force flag in any position. Everything else is rejected.
 */
export function parseCliArgs(argv) {
  const positional = [];
  let force = false;
  for (const arg of argv) {
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg.startsWith("--")) {
      return { ok: false, reason: `Unknown flag: ${arg}` };
    }
    positional.push(arg);
  }
  if (positional.length !== 2) {
    return {
      ok: false,
      reason:
        "Expected exactly 2 arguments: <sourceUrl> <destinationPath> [--force]\n" +
        `  received ${positional.length} positional argument(s).`,
    };
  }
  const [sourceUrl, destination] = positional;
  return { ok: true, sourceUrl, destination, force };
}
