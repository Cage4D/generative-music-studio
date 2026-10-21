import { describe, expect, it } from "vitest";
import type { MelodyParams } from "../types";
import { generateMelody } from "./melody";
import { hashEvents } from "../hash";

// Regression guard: the melody event stream must not move. These hashes were
// captured from the committed melody generator; if they change, the melody
// generation changed.
const baseParams = (overrides: Partial<MelodyParams> = {}): MelodyParams => ({
  seed: 1839204412,
  tempo: 96,
  root: "D",
  scale: "dorian",
  density: 0.6,
  swing: 0.1,
  effects: { reverb: 0.35, delay: 0.2 },
  melody: {
    waveform: "triangle",
    contour: "arch",
    octaveRange: 2,
    noteLength: "8n",
    restProbability: 0.2,
    leapiness: 0.3,
    phraseLengthBars: 4,
  },
  ...overrides,
});

const CASES: { name: string; params: MelodyParams; hash: string }[] = [
  { name: "seed-1", params: baseParams({ seed: 1 }), hash: "02f15fc7" },
  {
    name: "seed-1839204412",
    params: baseParams(),
    hash: "d0d2c34d",
  },
  { name: "seed-9001", params: baseParams({ seed: 9001 }), hash: "ed92dbc8" },
];

describe("melody event-list hash regression", () => {
  it.each(CASES)("pins the event hash for $name", ({ params, hash }) => {
    expect(hashEvents(generateMelody(params).events)).toBe(hash);
  });
});
