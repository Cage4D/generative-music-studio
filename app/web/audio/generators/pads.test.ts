import { describe, expect, it } from "vitest";
import { PAD_ARCHETYPES, type PadParams } from "../types";
import { generatePads } from "./pads";

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

function withPad(
  params: PadParams,
  override: Partial<PadParams["pad"]>,
): PadParams {
  return { ...params, pad: { ...params.pad, ...override } };
}

// Count the notes sounding at every step, so the six-note ceiling is measured
// directly from the events rather than inferred from the settings.
function maxSimultaneous(params: PadParams): number {
  const { events } = generatePads(params);
  const last = Math.max(...events.map((e) => e.step + e.durationSteps), 0);
  let peak = 0;
  for (let step = 0; step < last; step++) {
    let count = 0;
    for (const event of events) {
      if (step >= event.step && step < event.step + event.durationSteps) {
        count += event.pitches.length;
      }
    }
    peak = Math.max(peak, count);
  }
  return peak;
}

describe("generatePads determinism", () => {
  it("returns deep-equal results for the same params", () => {
    const params = baseParams();
    expect(generatePads(params)).toEqual(generatePads(params));
  });

  it("changes the music when the seed changes", () => {
    expect(generatePads(baseParams({ seed: 1 })).events).not.toEqual(
      generatePads(baseParams({ seed: 2 })).events,
    );
  });
});

describe("generatePads invariance", () => {
  it("does not change events for tempo, swing, density or effects", () => {
    const base = generatePads(baseParams()).events;
    expect(
      generatePads(baseParams({ tempo: 40, swing: 1, density: 0 })).events,
    ).toEqual(base);
    expect(generatePads(baseParams({ tempo: 220, swing: 0 })).events).toEqual(
      base,
    );
    expect(
      generatePads(baseParams({ effects: { reverb: 1, delay: 0, chorus: 1 } }))
        .events,
    ).toEqual(base);
  });

  it("does not change events for timbre-only pad settings", () => {
    const base = generatePads(baseParams()).events;
    expect(
      generatePads(
        withPad(baseParams(), {
          waveform: "sawtooth",
          attack: 0.01,
          release: 12,
          drift: 1,
        }),
      ).events,
    ).toEqual(base);
  });
});

describe("generatePads bounds", () => {
  it("never sounds more than six notes at once", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 1839204412, 9001]) {
      for (const chordSize of [2, 3, 4, 5]) {
        for (const chordLengthBars of [1, 2, 4, 8]) {
          const params = withPad(baseParams({ seed }), {
            chordSize,
            chordLengthBars,
          });
          expect(maxSimultaneous(params)).toBeLessThanOrEqual(6);
        }
      }
    }
  });

  it("keeps chords at four notes or fewer, in the C3-C5 register", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { events } = generatePads(
        withPad(baseParams({ seed }), { chordSize: 5, voicing: "wide" }),
      );
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event.pitches.length).toBeGreaterThan(0);
        expect(event.pitches.length).toBeLessThanOrEqual(4);
        for (const pitch of event.pitches) {
          expect(pitch).toBeGreaterThanOrEqual(48);
          expect(pitch).toBeLessThanOrEqual(72);
        }
      }
    }
  });

  it("produces at least four of the six archetypes across a seed sweep", () => {
    const found = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      found.add(generatePads(baseParams({ seed })).archetype);
    }
    expect(found.size).toBeGreaterThanOrEqual(4);
    for (const archetype of found) {
      expect(PAD_ARCHETYPES).toContain(archetype);
    }
  });
});
