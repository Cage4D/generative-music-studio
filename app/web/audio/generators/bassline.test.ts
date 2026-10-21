import { describe, expect, it } from "vitest";
import { NOTE_NAMES } from "@gms/shared";
import {
  BASS_ARCHETYPES,
  BASS_STYLES,
  type BassArchetypeId,
  type BasslineParams,
  type NoteEvent,
} from "../types";
import { generateBassline } from "./bassline";
import { hashEvents } from "../hash";

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

function withBass(
  params: BasslineParams,
  override: Partial<BasslineParams["bass"]>,
): BasslineParams {
  return { ...params, bass: { ...params.bass, ...override } };
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

// A monophonic line is best compared note for note: the same note in the
// same place. A pitch-class histogram on its own would call two different
// walks the same, because a bass only uses a handful of pitch classes.
function notePairSet(events: (NoteEvent | null)[]): Set<string> {
  return new Set(
    activeEvents(events).map((event) => `${event.step}:${event.midi}`),
  );
}

function pitchClassHistogram(events: (NoteEvent | null)[]): number[] {
  const histogram = new Array<number>(12).fill(0);
  for (const event of events) {
    if (event) histogram[((event.midi % 12) + 12) % 12]++;
  }
  return histogram;
}

function similarityOf(a: (NoteEvent | null)[], b: (NoteEvent | null)[]): number {
  const first = notePairSet(a);
  const second = notePairSet(b);
  let intersection = 0;
  for (const value of first) if (second.has(value)) intersection++;
  const union = first.size + second.size - intersection;
  const noteJaccard = union === 0 ? 0 : intersection / union;

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

  return 0.5 * noteJaccard + 0.5 * cosine;
}

describe("generateBassline determinism", () => {
  it("returns deep-equal results for the same params", () => {
    const params = baseParams();
    expect(generateBassline(params)).toEqual(generateBassline(params));
  });

  it("changes the music when the seed changes", () => {
    const a = generateBassline(baseParams({ seed: 1 }));
    const b = generateBassline(baseParams({ seed: 2 }));
    expect(a.events).not.toEqual(b.events);
  });

  it("logs the bassline event hash for a few seeds", () => {
    for (const seed of [1, 1839204412, 9001]) {
      const hash = hashEvents(generateBassline(baseParams({ seed })).events);
      console.log(`[BASS HASH] seed=${seed} = ${hash}`);
    }
  });
});

describe("generateBassline bounds", () => {
  it("keeps one monophonic note per step inside the pool", () => {
    const params = baseParams({ density: 0.9 });
    const { events, pool, range } = generateBassline(params);
    const poolSet = new Set(pool);

    expect(events).toHaveLength(16);
    events.forEach((event, index) => {
      if (!event) return;
      expect(event.step).toBe(index);
      expect(poolSet.has(event.midi)).toBe(true);
      expect(event.midi).toBeGreaterThanOrEqual(range.min);
      expect(event.midi).toBeLessThanOrEqual(range.max);
      expect(event.velocity).toBeGreaterThanOrEqual(0);
      expect(event.velocity).toBeLessThanOrEqual(1);
      expect(event.gate).toBeGreaterThan(0);
    });
  });

  it("scales the step count with the note length", () => {
    const lengths = { "2n": 4, "4n": 8, "8n": 16, "16n": 32, "32n": 64 };
    for (const [noteLength, steps] of Object.entries(lengths)) {
      const { events } = generateBassline(
        withBass(baseParams(), { noteLength: noteLength as "8n" }),
      );
      expect(events).toHaveLength(steps);
    }
  });

  it("stays in the low register and anchors the line on the root", () => {
    for (const octave of [1, 2, 3]) {
      const { pool } = generateBassline(withBass(baseParams(), { octave }));
      const rootPc = NOTE_NAMES.indexOf("D");
      const lowest = pool[0];
      // The root is the lowest note of the line.
      expect(((lowest % 12) + 12) % 12).toBe(rootPc);
      // The whole line stays inside two octaves of the root.
      expect(pool[pool.length - 1] - lowest).toBeLessThanOrEqual(24);
    }
  });

  it("puts the root on the downbeat of every bar", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { events, pool } = generateBassline(baseParams({ seed }));
      const root = pool[0];
      for (let bar = 0; bar * 8 < events.length; bar++) {
        const downbeat = events[bar * 8];
        if (downbeat) expect(downbeat.midi).toBe(root);
      }
    }
  });

  it("keeps the bass off the sub octave when the root is too low", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { voice } = generateBassline(
        withBass(baseParams({ seed }), { octave: 1 }),
      );
      expect(voice.kind).not.toBe("sub");
    }
  });

  it("is silent at density 0", () => {
    const { events } = generateBassline(baseParams({ density: 0 }));
    expect(activeEvents(events)).toHaveLength(0);
  });
});

describe("generateBassline density", () => {
  it("never reshuffles pitch: higher density is a superset", () => {
    const low = generateBassline(baseParams({ density: 0.3 })).events;
    const high = generateBassline(baseParams({ density: 0.75 })).events;
    expect(high).toHaveLength(low.length);
    for (let step = 0; step < low.length; step++) {
      if (low[step]) {
        expect(high[step]).not.toBeNull();
        expect(high[step]!.midi).toBe(low[step]!.midi);
        expect(high[step]!.velocity).toBe(low[step]!.velocity);
        expect(high[step]!.gate).toBe(low[step]!.gate);
      }
    }
  });

  it("increases the number of sounding notes with density", () => {
    const seeds = Array.from({ length: 20 }, (_, index) => index + 1);
    const totals = [0.2, 0.5, 0.8].map((density) =>
      seeds.reduce(
        (sum, seed) =>
          sum +
          activeEvents(generateBassline(baseParams({ seed, density })).events)
            .length,
        0,
      ),
    );
    expect(totals[1]).toBeGreaterThan(totals[0]);
    expect(totals[2]).toBeGreaterThan(totals[1]);
  });
});

describe("generateBassline setting isolation", () => {
  it("keeps events identical when only playback/timbre settings change", () => {
    const base = baseParams();
    const variants: BasslineParams[] = [
      { ...base, effects: { reverb: 0, delay: 0 } },
      { ...base, tempo: 140 },
      { ...base, swing: 0.5 },
      withBass(base, { waveform: "sine" }),
      withBass(base, { waveform: "square" }),
      withBass(base, { cutoff: 400 }),
      withBass(base, { cutoff: 6000 }),
      withBass(base, { glide: 0.8 }),
      withBass(base, { glide: 0 }),
    ];
    for (const variant of variants) {
      expect(generateBassline(variant).events).toEqual(
        generateBassline(base).events,
      );
    }
  });

  it("changes events when note-shaping settings change", () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const settings: Partial<BasslineParams["bass"]>[] = [
      { style: "root" },
      { style: "octave" },
      { style: "syncopated" },
      { octave: 1 },
      { octave: 3 },
      { noteLength: "16n" },
      { noteLength: "4n" },
    ];
    for (const override of settings) {
      const differ = seeds.filter((seed) => {
        const base = baseParams({ seed });
        return (
          hashEvents(generateBassline(base).events) !==
          hashEvents(generateBassline(withBass(base, override)).events)
        );
      });
      expect(differ.length).toBeGreaterThan(0);
    }
  });

  it("changes events when the shared settings change", () => {
    const seeds = Array.from({ length: 20 }, (_, index) => index + 1);
    const variants: Partial<BasslineParams>[] = [
      { root: "F#" },
      { scale: "pentatonic-major" },
      { density: 0.9 },
    ];
    for (const override of variants) {
      const differ = seeds.filter((seed) => {
        const base = baseParams({ seed });
        return (
          hashEvents(generateBassline(base).events) !==
          hashEvents(generateBassline({ ...base, ...override }).events)
        );
      });
      expect(differ.length).toBeGreaterThan(0);
    }
  });
});

describe("generateBassline diversity", () => {
  const seeds = Array.from({ length: 50 }, (_, index) => index + 1);
  const results = seeds.map((seed) => generateBassline(baseParams({ seed })));

  it("spreads all archetypes across 50 seeds", () => {
    const counts = new Map<BassArchetypeId, number>(
      BASS_ARCHETYPES.map((id) => [id, 0]),
    );
    for (const result of results) {
      counts.set(result.archetype, (counts.get(result.archetype) ?? 0) + 1);
    }
    for (const id of BASS_ARCHETYPES) {
      const count = counts.get(id) ?? 0;
      console.log(`[BASS ARCHETYPE] ${id} = ${count}`);
      expect(count).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps every archetype reachable from every style", () => {
    for (const style of BASS_STYLES) {
      const seen = new Set<BassArchetypeId>();
      for (let seed = 1; seed <= 120; seed++) {
        seen.add(
          generateBassline(withBass(baseParams({ seed }), { style })).archetype,
        );
      }
      for (const id of BASS_ARCHETYPES) {
        expect(seen.has(id)).toBe(true);
      }
    }
  });

  it("gives every archetype its own rhythm", () => {
    const onsets = new Map<BassArchetypeId, Set<string>>();
    for (const result of results) {
      const set = onsets.get(result.archetype) ?? new Set<string>();
      set.add(
        [...onsetSet(result.events)].sort((a, b) => a - b).join(","),
      );
      onsets.set(result.archetype, set);
    }
    for (const [id, set] of onsets) {
      expect(set.size).toBeGreaterThan(0);
      for (const other of onsets.keys()) {
        if (other === id) continue;
        const overlap = [...set].filter((value) =>
          [...onsets.get(other)!].includes(value),
        ).length;
        // Two archetypes never share one and the same rhythm everywhere.
        expect(overlap).toBeLessThan(set.size);
      }
    }
  });

  it("never repeats a line across 50 seeds", () => {
    const lines = new Set(results.map((result) => [...notePairSet(result.events)].sort().join(",")));
    console.log(`[BASS LINES] distinct = ${lines.size} of ${results.length}`);
    expect(lines.size).toBe(results.length);
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
    console.log(`[BASS SIMILARITY] average = ${average.toFixed(4)}`);
    console.log(`[BASS SIMILARITY] max = ${max.toFixed(4)}`);
    expect(average).toBeLessThan(0.65);
    // No two seeds should be near-clones.
    expect(max).toBeLessThan(0.98);
  });
});
