import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../lib/prng";
import {
  ARCHETYPES,
  ARPEGGIO_STEPS,
  STEPS_PER_BAR,
  VOICE_KINDS,
  type ArchetypeId,
  type ArpeggioParams,
  type NoteEvent,
  type VoiceKind,
} from "../types";
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

function activeMidi(event: NoteEvent | null): number | null {
  return event ? event.midi : null;
}

function onsetsOf(events: (NoteEvent | null)[]): number[] {
  const onsets: number[] = [];
  events.forEach((event, step) => {
    if (event) onsets.push(step);
  });
  return onsets;
}

function metricStrength(onsets: number[]): number {
  if (onsets.length === 0) return 0;
  let strong = 0;
  for (const step of onsets) {
    if (step % STEPS_PER_BAR % 4 === 0) strong++;
  }
  return strong / onsets.length;
}

function meanMidi(events: (NoteEvent | null)[]): number {
  let total = 0;
  let count = 0;
  for (const event of events) {
    if (event) {
      total += event.midi;
      count++;
    }
  }
  return count === 0 ? 0 : total / count;
}

describe("generateArpeggio determinism", () => {
  it("returns deep-equal { events, voice, archetype, range } for the same params", () => {
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

describe("generateArpeggio identity frequency", () => {
  it("spreads all archetypes and voice kinds across seeds 1..60", () => {
    const archetypeCounts = new Map<ArchetypeId, number>(
      ARCHETYPES.map((id) => [id, 0]),
    );
    const kindCounts = new Map<VoiceKind, number>(
      VOICE_KINDS.map((id) => [id, 0]),
    );
    const gainByKind = new Map<VoiceKind, number[]>(
      VOICE_KINDS.map((id) => [id, []]),
    );

    for (let seed = 1; seed <= 60; seed++) {
      const result = generateArpeggio(baseParams({ seed }));
      archetypeCounts.set(
        result.archetype,
        (archetypeCounts.get(result.archetype) ?? 0) + 1,
      );
      kindCounts.set(result.voice.kind, (kindCounts.get(result.voice.kind) ?? 0) + 1);
      gainByKind.get(result.voice.kind)?.push(result.voice.gain);
    }

    for (const id of ARCHETYPES) {
      const count = archetypeCounts.get(id) ?? 0;
      console.log(`[ARCHETYPE] ${id} = ${count}`);
      expect(count).toBeGreaterThanOrEqual(5);
    }
    for (const id of VOICE_KINDS) {
      const count = kindCounts.get(id) ?? 0;
      const gains = gainByKind.get(id) ?? [];
      const avgGain =
        gains.reduce((sum, value) => sum + value, 0) / Math.max(1, gains.length);
      console.log(`[VOICE] ${id} count = ${count} gain = ${avgGain.toFixed(3)}`);
      expect(count).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("generateArpeggio skeleton distance", () => {
  it("gives chips clearly different onsets and registers at density 1", () => {
    const pairs: [number, number][] = Array.from(
      { length: 50 },
      (_, index) => [1000 + index, 700_000 + index],
    );

    let hammingTotal = 0;
    let registerDifferent = 0;
    for (const [seedA, seedB] of pairs) {
      const a = generateArpeggio(baseParams({ seed: seedA, density: 1 })).events;
      const b = generateArpeggio(baseParams({ seed: seedB, density: 1 })).events;
      let different = 0;
      for (let step = 0; step < ARPEGGIO_STEPS; step++) {
        if ((a[step] !== null) !== (b[step] !== null)) different++;
      }
      hammingTotal += different / ARPEGGIO_STEPS;
      if (Math.abs(meanMidi(a) - meanMidi(b)) > 0.5) registerDifferent++;
    }

    const avgHamming = hammingTotal / pairs.length;
    const registerFraction = registerDifferent / pairs.length;
    console.log(`[SKELETON] avg Hamming = ${avgHamming.toFixed(4)}`);
    console.log(`[SKELETON] register-different fraction = ${registerFraction.toFixed(4)}`);
    expect(avgHamming).toBeGreaterThanOrEqual(0.3);
    expect(registerFraction).toBeGreaterThanOrEqual(0.5);
  });
});

describe("generateArpeggio groove survives thinning", () => {
  it("puts more onsets on strong beats than a uniform random subset", () => {
    let oursTotal = 0;
    let randomTotal = 0;
    let samples = 0;

    for (let index = 0; index < 50; index++) {
      const seed = 5000 + index;
      const events = generateArpeggio(baseParams({ seed, density: 0.3 })).events;
      const onsets = onsetsOf(events);
      if (onsets.length === 0) continue;

      const rand = mulberry32((seed * 2654435761) >>> 0);
      const all = Array.from({ length: ARPEGGIO_STEPS }, (_, step) => step);
      for (let i = all.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const swap = all[i];
        all[i] = all[j];
        all[j] = swap;
      }
      const randomOnsets = all.slice(0, onsets.length);

      oursTotal += metricStrength(onsets);
      randomTotal += metricStrength(randomOnsets);
      samples++;
    }

    const ours = oursTotal / samples;
    const random = randomTotal / samples;
    console.log(`[GROOVE] density .3 metric strength = ${ours.toFixed(4)}`);
    console.log(`[GROOVE] uniform subset metric strength = ${random.toFixed(4)}`);
    expect(ours).toBeGreaterThan(random);
    expect(ours - random).toBeGreaterThan(0.1);
  });
});
