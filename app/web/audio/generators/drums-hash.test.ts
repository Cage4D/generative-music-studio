import { describe, expect, it } from "vitest";
import type { DrumParams } from "../types";
import { generateDrums } from "./drums";
import { hashDrumEvents } from "../hash";

// Regression guard: the drum event stream must not move.
const baseParams = (overrides: Partial<DrumParams> = {}): DrumParams => ({
  seed: 1839204412,
  tempo: 96,
  root: "D",
  scale: "dorian",
  density: 0.6,
  swing: 0.1,
  effects: { reverb: 0.35, delay: 0.2 },
  drums: {
    style: "breakbeat",
    kit: "electronic",
    steps: 16,
    ghostNotes: 0.2,
    fills: 0.2,
    hatDensity: 0.6,
  },
  ...overrides,
});

const CASES: { name: string; params: DrumParams; hash: string }[] = [
  { name: "seed-1", params: baseParams({ seed: 1 }), hash: "af2f6567" },
  { name: "seed-1839204412", params: baseParams(), hash: "a6fdc3cb" },
  { name: "seed-9001", params: baseParams({ seed: 9001 }), hash: "99ad2313" },
];

describe("drum event-list hash regression", () => {
  it.each(CASES)("pins the event hash for $name", ({ params, hash }) => {
    expect(hashDrumEvents(generateDrums(params).steps.flat())).toBe(hash);
  });
});
