import { describe, expect, it } from "vitest";
import type { PadParams } from "../types";
import { generatePads } from "./pads";
import { hashPadEvents } from "../hash";

// Regression guard: the ambient-pad event stream must not move. These hashes
// were captured from the committed (M4d) pad generator; if they change, pad
// generation changed.
const baseParams = (overrides: Partial<PadParams> = {}): PadParams => ({
  seed: 1839204412,
  tempo: 96,
  root: "D",
  scale: "dorian",
  density: 0.6,
  swing: 0.1,
  effects: { reverb: 0.35, delay: 0.2 },
  pad: {
    waveform: "sine",
    chordSize: 3,
    voicing: "open",
    chordLengthBars: 2,
    attack: 2,
    release: 4,
    drift: 0.3,
  },
  ...overrides,
});

const CASES: { name: string; params: PadParams; hash: string }[] = [
  { name: "seed-1", params: baseParams({ seed: 1 }), hash: "5064fa9e" },
  { name: "seed-1839204412", params: baseParams(), hash: "df7f598a" },
  { name: "seed-9001", params: baseParams({ seed: 9001 }), hash: "0b9a68f2" },
];

describe("pad event-list hash regression", () => {
  it.each(CASES)("pins the event hash for $name", ({ params, hash }) => {
    expect(hashPadEvents(generatePads(params).events)).toBe(hash);
  });
});
