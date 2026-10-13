import { WAVEFORMS } from "@gms/shared";
import { describe, expect, it } from "vitest";
import { ARPEGGIO_STEPS, type ArpeggioParams } from "../types";
import { arpeggioPool, generateArpeggio } from "./arpeggio";

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

function activeMidi(event: { midi: number } | null): number | null {
  return event ? event.midi : null;
}

describe("generateArpeggio determinism", () => {
  it("returns deep-equal { events, voice, range } for the same params", () => {
    const params = baseParams();
    expect(generateArpeggio(params)).toEqual(generateArpeggio(params));
  });

  it("changes the music when the seed changes", () => {
    const a = generateArpeggio(baseParams({ seed: 1 }));
    const b = generateArpeggio(baseParams({ seed: 2 }));
    expect(a).not.toEqual(b);
  });
});

describe("generateArpeggio bounds", () => {
  it.each(["up", "down", "up-down", "random"] as const)(
    "covers steps 0..63 and keeps every note inside the pool and range for %s",
    (pattern) => {
      const params = baseParams({
        arpeggio: { pattern, octaves: 3, stepLength: "16n" },
      });
      const { events, range } = generateArpeggio(params);
      const pool = new Set(arpeggioPool(params));

      expect(events).toHaveLength(ARPEGGIO_STEPS);
      events.forEach((event, index) => {
        if (event) expect(event.step).toBe(index);
      });

      expect(range.min).toBe(Math.min(...pool));
      expect(range.max).toBe(Math.max(...pool));

      const notes = events.filter((event) => event !== null);
      expect(notes.length).toBeGreaterThan(0);
      for (const note of notes) {
        expect(pool.has(note.midi)).toBe(true);
        expect(note.midi).toBeGreaterThanOrEqual(range.min);
        expect(note.midi).toBeLessThanOrEqual(range.max);
        expect(note.velocity).toBeGreaterThanOrEqual(0);
        expect(note.velocity).toBeLessThanOrEqual(1);
        expect(note.gate).toBeGreaterThan(0);
      }
    },
  );

  it("produces only rests when density is 0", () => {
    const { events } = generateArpeggio(baseParams({ density: 0 }));
    expect(events.every((event) => event === null)).toBe(true);
  });
});

describe("generateArpeggio density independence", () => {
  it("keeps the same note on shared steps and makes .9 a superset of .3", () => {
    const low = generateArpeggio(baseParams({ density: 0.3 })).events;
    const high = generateArpeggio(baseParams({ density: 0.9 })).events;

    for (let step = 0; step < ARPEGGIO_STEPS; step++) {
      const a = low[step];
      const b = high[step];
      if (a && b) expect(a.midi).toBe(b.midi);
      if (a) expect(b).not.toBeNull();
    }
  });
});

describe("generateArpeggio difference metric", () => {
  it("makes two seeds sound clearly different (>= 0.5)", () => {
    const pairs: [number, number][] = Array.from(
      { length: 50 },
      (_, index) => [1000 + index, 700_000 + index],
    );

    let total = 0;
    for (const [seedA, seedB] of pairs) {
      const a = generateArpeggio(baseParams({ seed: seedA })).events;
      const b = generateArpeggio(baseParams({ seed: seedB })).events;
      let changed = 0;
      for (let step = 0; step < ARPEGGIO_STEPS; step++) {
        if (activeMidi(a[step]) !== activeMidi(b[step])) changed++;
      }
      total += changed / ARPEGGIO_STEPS;
    }

    const average = total / pairs.length;
    console.log(`[DIFFERENCE METRIC] average = ${average.toFixed(4)}`);
    expect(average).toBeGreaterThanOrEqual(0.5);
  });
});

describe("generateArpeggio voice variety", () => {
  it("uses all four waveforms across 100 seeds", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      seen.add(generateArpeggio(baseParams({ seed })).voice.waveform);
    }
    for (const waveform of WAVEFORMS) {
      expect(seen.has(waveform)).toBe(true);
    }
  });
});
