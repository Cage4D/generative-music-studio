import { describe, expect, it } from "vitest";
import type { TextureParams } from "../types";
import { generateTexture } from "./texture";
import { hashTextureEvents } from "../hash";

// Regression guard for the texture generator. These hashes were captured from
// the first committed implementation; if they move, texture generation changed.
const baseParams = (overrides: Partial<TextureParams> = {}): TextureParams => ({
  seed: 1839204412,
  tempo: 96,
  root: "D",
  scale: "dorian",
  density: 0.6,
  swing: 0.1,
  effects: { reverb: 0.35, delay: 0.2 },
  texture: {
    noiseType: "pink",
    filterType: "lowpass",
    filterFrequency: 2000,
    movementRate: 0.4,
    movementDepth: 0.5,
    crackle: 0.1,
  },
  ...overrides,
});

const CASES: { name: string; params: TextureParams; hash: string }[] = [
  { name: "seed-1", params: baseParams({ seed: 1 }), hash: "023626b7" },
  { name: "seed-1839204412", params: baseParams(), hash: "ea497831" },
  { name: "seed-9001", params: baseParams({ seed: 9001 }), hash: "78eb184c" },
];

describe("texture event-list hash regression", () => {
  it.each(CASES)("pins the event hash for $name", ({ params, hash }) => {
    expect(hashTextureEvents(generateTexture(params).events)).toBe(hash);
  });
});
