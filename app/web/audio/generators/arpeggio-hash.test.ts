import { describe, expect, it } from "vitest";
import type { ArpeggioParams } from "../types";
import { generateArpeggio } from "./arpeggio";
import { hashEvents } from "../hash";

// Regression guard for Milestone 4a: adding melody generation must not change
// the arpeggio event stream. These hashes were captured from the committed
// (3c) arpeggio generator; if they move, arpeggio generation changed.
const baseParams = (
  overrides: Partial<ArpeggioParams> = {},
): ArpeggioParams => ({
  seed: 1839204412,
  tempo: 96,
  root: "D",
  scale: "dorian",
  density: 0.6,
  swing: 0.1,
  effects: { reverb: 0.35, delay: 0.2 },
  arpeggio: { pattern: "up-down", octaves: 2, stepLength: "16n" },
  ...overrides,
});

const CASES: { name: string; params: ArpeggioParams; hash: string }[] = [
  { name: "default", params: baseParams(), hash: "4745c8c9" },
  {
    name: "up-3oct",
    params: baseParams({
      seed: 42,
      root: "A",
      scale: "minor",
      density: 0.85,
      arpeggio: { pattern: "up", octaves: 3, stepLength: "8n" },
    }),
    hash: "3279d21e",
  },
  {
    name: "random-penta",
    params: baseParams({
      seed: 9001,
      root: "F#",
      scale: "pentatonic-major",
      density: 0.5,
      arpeggio: { pattern: "random", octaves: 4, stepLength: "32n" },
    }),
    hash: "61d65895",
  },
];

describe("arpeggio event-list hash regression", () => {
  it.each(CASES)("pins the event hash for $name", ({ params, hash }) => {
    expect(hashEvents(generateArpeggio(params).events)).toBe(hash);
  });
});
