import { describe, expect, it } from "vitest";
import type { BasslineParams } from "../types";
import { generateBassline } from "./bassline";
import { hashEvents } from "../hash";

// Regression guard: the bassline event stream must not move. These hashes
// were captured from the committed bassline generator (M4b); if they change,
// the bassline generation changed.
const baseParams = (overrides: Partial<BasslineParams> = {}): BasslineParams => ({
  seed: 1839204412,
  tempo: 96,
  root: "D",
  scale: "dorian",
  density: 0.6,
  swing: 0.1,
  effects: { reverb: 0.35, delay: 0.2 },
  bass: {
    waveform: "sawtooth",
    octave: 2,
    style: "walking",
    noteLength: "8n",
    glide: 0.1,
    cutoff: 1200,
  },
  ...overrides,
});

const CASES: { name: string; params: BasslineParams; hash: string }[] = [
  { name: "seed-1", params: baseParams({ seed: 1 }), hash: "e9545997" },
  { name: "seed-1839204412", params: baseParams(), hash: "9fc1201d" },
  {
    name: "seed-9001-low-root",
    params: baseParams({
      seed: 9001,
      bass: {
        waveform: "square",
        octave: 1,
        style: "root",
        noteLength: "16n",
        glide: 0,
        cutoff: 400,
      },
    }),
    hash: "3701b44e",
  },
];

describe("bassline event-list hash regression", () => {
  it.each(CASES)("pins the event hash for $name", ({ params, hash }) => {
    expect(hashEvents(generateBassline(params).events)).toBe(hash);
  });
});
