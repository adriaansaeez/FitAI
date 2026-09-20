import { describe, expect, it } from "vitest";
import {
  clampSecond,
  isCompleted,
} from "../src/components/useRaceSimulation";
import type { SessionDescriptor } from "../src/domain/types";

describe("clampSecond", () => {
  it("keeps in-range integer seconds unchanged, including boundaries", () => {
    expect(clampSecond(600, 0)).toBe(0);
    expect(clampSecond(600, 1)).toBe(1);
    expect(clampSecond(600, 300)).toBe(300);
    expect(clampSecond(600, 600)).toBe(600);
  });

  it("clamps below zero to 0", () => {
    expect(clampSecond(600, -1)).toBe(0);
    expect(clampSecond(600, -1000)).toBe(0);
  });

  it("clamps above totalSeconds to totalSeconds", () => {
    expect(clampSecond(600, 601)).toBe(600);
    expect(clampSecond(600, 100000)).toBe(600);
  });

  it("rounds fractional input before clamping", () => {
    expect(clampSecond(600, 10.4)).toBe(10);
    expect(clampSecond(600, 10.6)).toBe(11);
    expect(clampSecond(600, -0.4)).toBe(0);
    expect(clampSecond(600, 599.5)).toBe(600);
    expect(clampSecond(600, 600.5)).toBe(600);
  });

  it("supports a dynamic window larger than the legacy 600 s (real race)", () => {
    expect(clampSecond(1800, 1750)).toBe(1750);
    expect(clampSecond(1800, 1800)).toBe(1800);
    expect(clampSecond(1800, 1801)).toBe(1800);
    expect(clampSecond(1800, -5)).toBe(0);
  });
});

describe("isCompleted", () => {
  it("is false before the last second", () => {
    expect(isCompleted(600, 0)).toBe(false);
    expect(isCompleted(600, 599)).toBe(false);
  });

  it("is true at and beyond the last second", () => {
    expect(isCompleted(600, 600)).toBe(true);
    expect(isCompleted(600, 601)).toBe(true);
  });

  it("honors a dynamic totalSeconds", () => {
    expect(isCompleted(1800, 600)).toBe(false);
    expect(isCompleted(1800, 1799)).toBe(false);
    expect(isCompleted(1800, 1800)).toBe(true);
  });
});

describe("SessionDescriptor", () => {
  it("accepts a synthetic-scenario descriptor", () => {
    const session: SessionDescriptor = {
      samples: [],
      totalSeconds: 600,
      source: { kind: "synthetic-scenario", scenarioId: "easy-under-target" },
    };
    expect(session.source.kind).toBe("synthetic-scenario");
    expect(session.totalSeconds).toBe(600);
  });

  it("accepts a real-race descriptor with full provenance fields", () => {
    const session: SessionDescriptor = {
      samples: [],
      totalSeconds: 1800,
      source: {
        kind: "real-race",
        id: "kona-2022-iden",
        seed: 7,
        startSourceIndex: 0,
        visibleDurationSeconds: 1800,
        prerollSeconds: 300,
      },
    };
    expect(session.source.kind).toBe("real-race");
    if (session.source.kind === "real-race") {
      expect(session.source.id).toBe("kona-2022-iden");
      expect(session.source.seed).toBe(7);
      expect(session.source.startSourceIndex).toBe(0);
      expect(session.source.visibleDurationSeconds).toBe(1800);
      expect(session.source.prerollSeconds).toBe(300);
    }
  });
});
