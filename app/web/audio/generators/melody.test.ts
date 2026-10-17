import { describe, expect, it } from "vitest";
import { NOTE_NAMES } from "@gms/shared";
import {
  MELODY_ARCHETYPES,
  PHRASE_STEPS,
  type MelodyArchetypeId,
  type MelodyParams,
  type NoteEvent,
} from "../types";
import { generateMelody, melodyPool } from "./melody";
import { hashEvents } from "../hash";

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

function withMelody(
  params: MelodyParams,
  override: Partial<MelodyParams["melody"]>,
): MelodyParams {
  return { ...params, melody: { ...params.melody, ...override } };
}

function activeEvents(events: (NoteEvent | null)[]): NoteEvent[] {
  return events.filter((event): event is NoteEvent => event !== null);
}

function onsetSet(events: (NoteEvent | null)[]): Set<number> {
  const set = new Set<number>();
  events.forEach((event, step) => {
    if (event) set.add(step);
  });
  return set;
}

function pitchClassHistogram(events: (NoteEvent | null)[]): number[] {
  const histogram = new Array<number>(12).fill(0);
  for (const event of events) {
    if (event) histogram[((event.midi % 12) + 12) % 12]++;
  }
  return histogram;
}

function similarityOf(a: (NoteEvent | null)[], b: (NoteEvent | null)[]): number {
  const first = onsetSet(a);
  const second = onsetSet(b);
  let intersection = 0;
  for (const value of first) if (second.has(value)) intersection++;
  const union = first.size + second.size - intersection;
  const onsetJaccard = union === 0 ? 0 : intersection / union;

  const ha = pitchClassHistogram(a);
  const hb = pitchClassHistogram(b);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let k = 0; k < 12; k++) {
    dot += ha[k] * hb[k];
    normA += ha[k] * ha[k];
    normB += hb[k] * hb[k];
  }
  const cosine = normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);

  return 0.5 * onsetJaccard + 0.5 * cosine;
}

describe("generateMelody determinism", () => {
  it("returns deep-equal results for the same params", () => {
    const params = baseParams();
    expect(generateMelody(params)).toEqual(generateMelody(params));
  });

  it("changes the music when the seed changes", () => {
    const a = generateMelody(baseParams({ seed: 1 }));
    const b = generateMelody(baseParams({ seed: 2 }));
    expect(a).not.toEqual(b);
  });

  it("logs the melody event hash for a few seeds", () => {
    for (const seed of [1, 1839204412, 9001]) {
      const hash = hashEvents(generateMelody(baseParams({ seed })).events);
      console.log(`[MELODY HASH] seed=${seed} = ${hash}`);
    }
  });
});

describe("generateMelody bounds", () => {
  it.each([
    "ascending",
    "descending",
    "arch",
    "wave",
    "random",
  ] as const)("covers every step and keeps notes in the pool for %s", (contour) => {
    const params = withMelody(baseParams({ density: 0.75 }), { contour });
    const { events, range } = generateMelody(params);
    const pool = new Set(melodyPool(params));

    expect(events).toHaveLength(4 * PHRASE_STEPS);
    events.forEach((event, index) => {
      if (event) expect(event.step).toBe(index);
    });

    expect(range.min).toBe(Math.min(...pool));
    expect(range.max).toBe(Math.max(...pool));

    const notes = activeEvents(events);
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      expect(pool.has(note.midi)).toBe(true);
      expect(note.midi).toBeGreaterThanOrEqual(range.min);
      expect(note.midi).toBeLessThanOrEqual(range.max);
      expect(note.velocity).toBeGreaterThanOrEqual(0);
      expect(note.velocity).toBeLessThanOrEqual(1);
      expect(note.gate).toBeGreaterThan(0);
    }
  });

  it("scales the loop length with phraseLengthBars", () => {
    for (const bars of [1, 2, 4, 8]) {
      const { events } = generateMelody(
        withMelody(baseParams(), { phraseLengthBars: bars }),
      );
      expect(events).toHaveLength(bars * PHRASE_STEPS);
    }
  });

  it("is silent at density 0", () => {
    const { events } = generateMelody(baseParams({ density: 0 }));
    expect(activeEvents(events)).toHaveLength(0);
  });
});

describe("generateMelody resolution", () => {
  it("ends every phrase on the tonic when nothing is thinned", () => {
    const params = withMelody(baseParams({ density: 1 }), {
      restProbability: 0,
    });
    const rootPc = NOTE_NAMES.indexOf(params.root);
    const { events } = generateMelody(params);
    for (let end = PHRASE_STEPS - 1; end < events.length; end += PHRASE_STEPS) {
      const event = events[end];
      expect(event).not.toBeNull();
      expect(((event!.midi % 12) + 12) % 12).toBe(rootPc);
    }
  });
});

describe("generateMelody density", () => {
  it("never reshuffles pitch: higher density is a superset", () => {
    const low = generateMelody(baseParams({ density: 0.3 })).events;
    const high = generateMelody(baseParams({ density: 0.75 })).events;
    expect(high).toHaveLength(low.length);
    for (let step = 0; step < low.length; step++) {
      if (low[step]) {
        expect(high[step]).not.toBeNull();
        expect(high[step]!.midi).toBe(low[step]!.midi);
        expect(high[step]!.velocity).toBe(low[step]!.velocity);
      }
    }
  });

  it("increases the number of sounding notes with density", () => {
    const counts = [0.2, 0.5, 0.8].map(
      (density) => activeEvents(generateMelody(baseParams({ density })).events).length,
    );
    expect(counts[1]).toBeGreaterThan(counts[0]);
    expect(counts[2]).toBeGreaterThan(counts[1]);
  });
});

describe("generateMelody setting isolation", () => {
  it("keeps events identical when only playback/timbre settings change", () => {
    const base = baseParams();
    const variants: MelodyParams[] = [
      { ...base, effects: { reverb: 0, delay: 0 } },
      { ...base, tempo: 140 },
      { ...base, swing: 0.5 },
      withMelody(base, { noteLength: "32n" }),
      withMelody(base, { noteLength: "2n" }),
      withMelody(base, { waveform: "square" }),
    ];
    for (const variant of variants) {
      expect(generateMelody(variant).events).toEqual(generateMelody(base).events);
    }
  });

  it("changes events when note-shaping settings change", () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const settings: Partial<MelodyParams["melody"]>[] = [
      { contour: "ascending" },
      { contour: "descending" },
      { leapiness: 0.9 },
      { octaveRange: 3 },
      { phraseLengthBars: 2 },
      { restProbability: 0.95 },
    ];
    for (const override of settings) {
      const differ = seeds.filter((seed) => {
        const base = baseParams({ seed });
        return (
          hashEvents(generateMelody(base).events) !==
          hashEvents(generateMelody(withMelody(base, override)).events)
        );
      });
      expect(differ.length).toBeGreaterThan(0);
    }
  });
});

describe("generateMelody diversity", () => {
  const seeds = Array.from({ length: 50 }, (_, index) => index + 1);
  const results = seeds.map((seed) => generateMelody(baseParams({ seed })));

  it("spreads all archetypes across 50 seeds", () => {
    const counts = new Map<MelodyArchetypeId, number>(
      MELODY_ARCHETYPES.map((id) => [id, 0]),
    );
    for (const result of results) {
      counts.set(result.archetype, (counts.get(result.archetype) ?? 0) + 1);
    }
    for (const id of MELODY_ARCHETYPES) {
      const count = counts.get(id) ?? 0;
      console.log(`[MELODY ARCHETYPE] ${id} = ${count}`);
      expect(count).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps pairwise similarity below the threshold", () => {
    let total = 0;
    let pairs = 0;
    let max = 0;
    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        const similarity = similarityOf(results[i].events, results[j].events);
        total += similarity;
        max = Math.max(max, similarity);
        pairs++;
      }
    }
    const average = total / pairs;
    console.log(`[MELODY SIMILARITY] average = ${average.toFixed(4)}`);
    console.log(`[MELODY SIMILARITY] max = ${max.toFixed(4)}`);
    expect(average).toBeLessThan(0.6);
    // No two seeds should be near-clones.
    expect(max).toBeLessThan(0.95);
  });
});
