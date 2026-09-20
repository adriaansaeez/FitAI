// scripts/kona-download-lib.mjs is plain JavaScript outside the tsconfig
// include list (allowJs is off), so TypeScript cannot infer types for it and
// no sibling declaration file is within this task's edit surfaces. The single
// suppression below keeps `npx tsc --noEmit` clean; the shapes are asserted
// locally and enforced at runtime by the exact-equality expectations.
// @ts-expect-error no declaration file for an out-of-tsconfig .mjs module
import * as konaLibModule from "../scripts/kona-download-lib.mjs";

import { describe, expect, it } from "vitest";

type HeaderCheck = { ok: true } | { ok: false; reason: string };

type Provenance = {
  sourceUrl: string;
  downloadedAt: string;
  sha256: string;
  license: "CC BY-NC 4.0";
  athlete: "Gustav Iden";
  event: "IRONMAN World Championship Kona 2022";
};

type ParsedArgs =
  | { ok: true; sourceUrl: string; destination: string; force: boolean }
  | { ok: false; reason: string };

interface KonaDownloadLib {
  EXPECTED_HEADER: string;
  PROVENANCE_CONSTANTS: {
    readonly license: "CC BY-NC 4.0";
    readonly athlete: "Gustav Iden";
    readonly event: "IRONMAN World Championship Kona 2022";
  };
  validateHeaderLine(firstLine: string): HeaderCheck;
  sha256Hex(content: string): string;
  buildProvenance(input: {
    sourceUrl: string;
    downloadedAt: string;
    sha256: string;
  }): Provenance;
  parseCliArgs(argv: readonly string[]): ParsedArgs;
}

const konaLib = konaLibModule as unknown as KonaDownloadLib;
const { EXPECTED_HEADER, buildProvenance, parseCliArgs, sha256Hex, validateHeaderLine } =
  konaLib;

describe("download-script header validation", () => {
  it("accepts the exact Entalpi CSV header", () => {
    expect(
      validateHeaderLine(
        "datetime,latitude,longitude,speed,elevation,heartrate,cadence,stride_length",
      ),
    ).toEqual({ ok: true });
  });

  it("rejects a header with a renamed or missing column", () => {
    const result = validateHeaderLine(
      "datetime,latitude,longitude,velocity,elevation,heartrate,cadence,stride_length",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("header");
    }
  });

  it("rejects an empty first line", () => {
    const result = validateHeaderLine("");
    expect(result.ok).toBe(false);
  });

  it("rejects a header with extra whitespace", () => {
    const result = validateHeaderLine(
      "datetime, latitude,longitude,speed,elevation,heartrate,cadence,stride_length",
    );
    expect(result.ok).toBe(false);
  });

  it("exports the expected header constant verbatim", () => {
    expect(EXPECTED_HEADER).toBe(
      "datetime,latitude,longitude,speed,elevation,heartrate,cadence,stride_length",
    );
  });
});

describe("download-script provenance building", () => {
  it("builds the provenance object with the required attribution fields", () => {
    const provenance = buildProvenance({
      sourceUrl:
        "https://raw.githubusercontent.com/entalpi-no/kona-2022/main/gustav_iden_copyright_entalpi_as.csv",
      downloadedAt: "2024-01-15T10:30:00.000Z",
      sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });

    expect(provenance).toEqual({
      sourceUrl:
        "https://raw.githubusercontent.com/entalpi-no/kona-2022/main/gustav_iden_copyright_entalpi_as.csv",
      downloadedAt: "2024-01-15T10:30:00.000Z",
      sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      license: "CC BY-NC 4.0",
      athlete: "Gustav Iden",
      event: "IRONMAN World Championship Kona 2022",
    });
  });

  it("keeps the license non-commercial and attributes Entalpi's athlete/event", () => {
    const provenance = buildProvenance({
      sourceUrl: "https://example.invalid/x.csv",
      downloadedAt: "2024-01-15T10:30:00.000Z",
      sha256: "a".repeat(64),
    });
    expect(provenance.license).toBe("CC BY-NC 4.0");
    expect(provenance.athlete).toBe("Gustav Iden");
    expect(provenance.event).toBe("IRONMAN World Championship Kona 2022");
  });
});

describe("download-script sha256", () => {
  it("computes the known sha256 test vector", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("produces lowercase hex of 64 chars", () => {
    const digest = sha256Hex("datetime,latitude,longitude\n");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("download-script CLI argument parsing", () => {
  it("accepts exactly source URL and destination", () => {
    expect(
      parseCliArgs([
        "https://raw.githubusercontent.com/entalpi-no/kona-2022/main/gustav_iden_copyright_entalpi_as.csv",
        "data/kona-2022/gustav_iden.csv",
      ]),
    ).toEqual({
      ok: true,
      sourceUrl:
        "https://raw.githubusercontent.com/entalpi-no/kona-2022/main/gustav_iden_copyright_entalpi_as.csv",
      destination: "data/kona-2022/gustav_iden.csv",
      force: false,
    });
  });

  it("accepts the --force flag in any position", () => {
    const parsed = parseCliArgs([
      "--force",
      "https://example.invalid/x.csv",
      "data/x.csv",
    ]);
    expect(parsed).toEqual({
      ok: true,
      sourceUrl: "https://example.invalid/x.csv",
      destination: "data/x.csv",
      force: true,
    });
  });

  it("rejects missing arguments", () => {
    expect(parseCliArgs(["https://example.invalid/x.csv"]).ok).toBe(false);
    expect(parseCliArgs([]).ok).toBe(false);
  });

  it("rejects extra positional arguments", () => {
    expect(
      parseCliArgs(["https://example.invalid/x.csv", "a.csv", "b.csv"]).ok,
    ).toBe(false);
  });

  it("rejects unknown flags", () => {
    expect(
      parseCliArgs(["--target", "https://example.invalid/x.csv", "a.csv"]).ok,
    ).toBe(false);
  });
});
