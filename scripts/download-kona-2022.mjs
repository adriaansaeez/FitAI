#!/usr/bin/env node
// Download script for the Kona 2022 real-race validation dataset (T1).
//
// Usage:
//   node scripts/download-kona-2022.mjs <sourceUrl> <destinationPath> [--force]
//
// Example:
//   node scripts/download-kona-2022.mjs \
//     https://raw.githubusercontent.com/entalpi-no/kona-2022/main/gustav_iden_copyright_entalpi_as.csv \
//     data/kona-2022/gustav_iden.csv
//
// Downloads the CSV with global fetch (Node 20+), verifies the header,
// computes a sha256 and writes a provenance JSON next to the destination.
// Nothing else is fetched and no credentials are stored. The dataset is
// CC BY-NC 4.0 — see docs/real-race-data.md.

import { mkdir, writeFile } from "node:fs/promises";
import { stat } from "node:fs/promises";
import { dirname } from "node:path";
import {
  buildProvenance,
  parseCliArgs,
  sha256Hex,
  validateHeaderLine,
} from "./kona-download-lib.mjs";

const CSV_URL_SUFFIX_HINT =
  "Only fetch the Entalpi Kona 2022 CSV; do not point this script at anything else.";

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

async function main() {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (!parsed.ok) {
    fail(`${parsed.reason}\n${CSV_URL_SUFFIX_HINT}`);
  }
  const { sourceUrl, destination, force } = parsed;

  // Never overwrite an existing dataset unless --force is passed.
  try {
    await stat(destination);
    if (!force) {
      fail(
        `Destination already exists: ${destination}. Pass --force to overwrite.`,
      );
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  let response;
  try {
    response = await fetch(sourceUrl);
  } catch (error) {
    fail(`Network error while fetching ${sourceUrl}: ${error.message}`);
  }
  if (response.status !== 200) {
    fail(
      `Unexpected HTTP status ${response.status} (expected 200) for ${sourceUrl}.`,
    );
  }

  const text = await response.text();
  if (text.length === 0) {
    fail("Downloaded file is empty.");
  }

  // All validation happens before anything is written, so a failure never
  // leaves a partial provenance file behind.
  const firstLineEnd = text.search(/\r?\n/);
  const firstLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);
  const headerCheck = validateHeaderLine(firstLine);
  if (!headerCheck.ok) {
    fail(headerCheck.reason);
  }

  const sha256 = sha256Hex(text);
  const provenance = buildProvenance({
    sourceUrl,
    downloadedAt: new Date().toISOString(),
    sha256,
  });

  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, text, "utf8");
  await writeFile(
    `${destination}.provenance.json`,
    `${JSON.stringify(provenance, null, 2)}\n`,
    "utf8",
  );

  console.log(`Downloaded ${destination} (${text.length} bytes).`);
  console.log(`sha256: ${sha256}`);
  console.log(`Provenance written to ${destination}.provenance.json`);
}

main().catch((error) => {
  fail(`Unexpected failure: ${error.message}`);
});
