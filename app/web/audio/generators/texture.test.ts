import { describe, expect, it } from "vitest";
import {
  TEXTURE_ARCHETYPES,
  TEXTURE_VOICE_KINDS,
  type TextureParams,
} from "../types";
import {
  generateTexture,
  TEXTURE_MAX_EVENTS_PER_BAR,
  TEXTURE_MAX_SIMULTANEOUS,
  TEXTURE_STEPS_PER_BAR,
} from "./texture";

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

function withTexture(
  params: TextureParams,
  override: Partial<TextureParams["texture"]>,
): TextureParams {
  return { ...params, texture: { ...params.texture, ...override } };
}

function maxSimultaneous(params: TextureParams): number {
  const { events, totalSteps } = generateTexture(params);
  let peak = 0;
  for (let step = 0; step < totalSteps; step++) {
    const active = events.filter(
      (event) => event.step <= step && step < event.step + event.durationSteps,
    ).length;
    peak = Math.max(peak, active);
  }
  return peak;
}

function maxPerBar(params: TextureParams): number {
  const { events } = generateTexture(params);
  const perBar = new Map<number, number>();
  for (const event of events) {
    const bar = Math.floor(event.step / TEXTURE_STEPS_PER_BAR);
    perBar.set(bar, (perBar.get(bar) ?? 0) + 1);
  }
  return Math.max(0, ...perBar.values());
}

// Jaccard similarity over the gesture fingerprints. Brightness is bucketed so
// tiny numeric differences do not hide an otherwise identical pattern.
function similarity(a: TextureParams, b: TextureParams): number {
  const fingerprint = (params: TextureParams) =>
    new Set(
      generateTexture(params).events.map(
        (event) =>
          `${event.step}:${event.voice}:${Math.round(event.brightness * 3)}`,
      ),
    );
  const left = fingerprint(a);
  const right = fingerprint(b);
  const intersection = [...left].filter((value) => right.has(value)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

describe("generateTexture determinism", () => {
  it("returns deep-equal results for the same params", () => {
    const params = baseParams();
    expect(generateTexture(params)).toEqual(generateTexture(params));
  });

  it("changes the gestures when the seed changes", () => {
    expect(generateTexture(baseParams({ seed: 1 })).events).not.toEqual(
      generateTexture(baseParams({ seed: 2 })).events,
    );
  });
});

describe("generateTexture invariance", () => {
  it("does not change events for tempo, swing, effects or timbre settings", () => {
    const base = generateTexture(baseParams()).events;
    expect(
      generateTexture(baseParams({ tempo: 40, swing: 1, density: 0.6 })).events,
    ).toEqual(base);
    expect(generateTexture(baseParams({ tempo: 220, swing: 0 })).events).toEqual(
      base,
    );
    expect(
      generateTexture(baseParams({ effects: { reverb: 1, delay: 0, chorus: 1 } }))
        .events,
    ).toEqual(base);
    expect(
      generateTexture(
        withTexture(baseParams(), {
          noiseType: "brown",
          filterType: "highpass",
          filterFrequency: 9000,
        }),
      ).events,
    ).toEqual(base);
  });

  it("changes events for the note-shaping settings", () => {
    const base = generateTexture(baseParams({ seed: 1 })).events;
    expect(generateTexture(baseParams({ seed: 1, density: 0.1 })).events).not.toEqual(
      base,
    );
    expect(
      generateTexture(withTexture(baseParams({ seed: 1 }), { movementRate: 8 }))
        .events,
    ).not.toEqual(base);
    expect(
      generateTexture(
        withTexture(baseParams({ seed: 1 }), { movementDepth: 0 }),
      ).events,
    ).not.toEqual(base);
    expect(
      generateTexture(withTexture(baseParams({ seed: 1 }), { crackle: 1 }))
        .events,
    ).not.toEqual(base);
  });
});

describe("generateTexture bounds", () => {
  it("keeps every event a valid, quiet gesture", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { events } = generateTexture(baseParams({ seed }));
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event.step).toBeGreaterThanOrEqual(0);
        expect(event.step).toBeLessThan(64);
        expect(event.pitch).toBeGreaterThanOrEqual(60);
        expect(event.pitch).toBeLessThanOrEqual(84);
        expect(event.brightness).toBeGreaterThanOrEqual(0);
        expect(event.brightness).toBeLessThanOrEqual(1);
        expect(event.velocity).toBeGreaterThan(0);
        expect(event.velocity).toBeLessThanOrEqual(0.5);
        expect(event.durationSteps).toBeGreaterThanOrEqual(1);
        expect(TEXTURE_VOICE_KINDS).toContain(event.voice);
      }
    }
  });

  it("respects the per-bar and simultaneous gesture caps for every seed", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const params = baseParams({ seed });
      expect(maxPerBar(params)).toBeLessThanOrEqual(TEXTURE_MAX_EVENTS_PER_BAR);
      expect(maxSimultaneous(params)).toBeLessThanOrEqual(
        TEXTURE_MAX_SIMULTANEOUS,
      );
    }
  });

  it("reaches every archetype across 50 seeds", () => {
    const found = new Set<string>();
    for (let seed = 1; seed <= 50; seed++) {
      found.add(generateTexture(baseParams({ seed })).archetype);
    }
    expect([...found].sort()).toEqual([...TEXTURE_ARCHETYPES].sort());
  });

  it("keeps archetypes pairwise distinct (average Jaccard under 0.55)", () => {
    const results = Array.from({ length: 50 }, (_, index) =>
      baseParams({ seed: index + 1 }),
    );
    let total = 0;
    let pairs = 0;
    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        total += similarity(results[i], results[j]);
        pairs++;
      }
    }
    expect(total / pairs).toBeLessThan(0.55);
  });
});
