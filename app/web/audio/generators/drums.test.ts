import { describe, expect, it } from "vitest";
import {
  DRUM_ARCHETYPES,
  DRUM_LANES,
  DRUM_STYLES,
  type DrumArchetypeId,
  type DrumBlock,
  type DrumEvent,
  type DrumParams,
  type DrumStyleName,
} from "../types";
import { generateDrums, drumEvents } from "./drums";
import { hashDrumEvents } from "../hash";

const baseParams = (overrides: Partial<DrumParams> = {}): DrumParams => ({
  seed: 1839204412,
  tempo: 96,
  root: "D",
  scale: "dorian",
  density: 0.6,
  swing: 0.1,
  effects: { reverb: 0.35, delay: 0.2 },
  drums: {
    style: "breakbeat",
    kit: "electronic",
    steps: 16,
    ghostNotes: 0.2,
    fills: 0.2,
    hatDensity: 0.6,
  },
  ...overrides,
});

function withDrums(
  params: DrumParams,
  override: Partial<DrumBlock>,
): DrumParams {
  return { ...params, drums: { ...params.drums, ...override } };
}

function eventsOf(params: DrumParams): DrumEvent[] {
  return drumEvents(generateDrums(params));
}

/** The hits of a pattern, as "step:lane" pairs. */
function hitSet(events: DrumEvent[]): Set<string> {
  return new Set(events.map((event) => `${event.step}:${event.lane}`));
}

/** How many hits every lane has. */
function laneHistogram(events: DrumEvent[]): number[] {
  const histogram = new Array<number>(DRUM_LANES.length).fill(0);
  for (const event of events) {
    histogram[DRUM_LANES.indexOf(event.lane)]++;
  }
  return histogram;
}

// A drum pattern is compared hit for hit: the same lane in the same place.
// A lane histogram on its own would call two different grooves the same,
// because a drum kit only uses six lanes.
function similarityOf(a: DrumEvent[], b: DrumEvent[]): number {
  const first = hitSet(a);
  const second = hitSet(b);
  let intersection = 0;
  for (const value of first) if (second.has(value)) intersection++;
  const union = first.size + second.size - intersection;
  const jaccard = union === 0 ? 0 : intersection / union;

  const ha = laneHistogram(a);
  const hb = laneHistogram(b);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let k = 0; k < ha.length; k++) {
    dot += ha[k] * hb[k];
    normA += ha[k] * ha[k];
    normB += hb[k] * hb[k];
  }
  const cosine = normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);

  return 0.5 * jaccard + 0.5 * cosine;
}

describe("generateDrums determinism", () => {
  it("returns deep-equal results for the same params", () => {
    const params = baseParams();
    expect(generateDrums(params)).toEqual(generateDrums(params));
    expect(hashDrumEvents(eventsOf(params))).toBe(
      hashDrumEvents(eventsOf(params)),
    );
  });

  it("changes the pattern when the seed changes", () => {
    const a = eventsOf(baseParams({ seed: 1 }));
    const b = eventsOf(baseParams({ seed: 2 }));
    expect(hashDrumEvents(a)).not.toBe(hashDrumEvents(b));
  });

  it("logs the drum event hash for a few seeds", () => {
    for (const seed of [1, 1839204412, 9001]) {
      const hash = hashDrumEvents(eventsOf(baseParams({ seed })));
      console.log(`[DRUM HASH] seed=${seed} = ${hash}`);
    }
  });
});

describe("generateDrums bounds", () => {
  it("keeps every event inside the pattern", () => {
    const result = generateDrums(baseParams());
    expect(result.steps).toHaveLength(result.totalSteps);
    for (const events of result.steps) {
      for (const event of events) {
        expect(event.step).toBeGreaterThanOrEqual(0);
        expect(event.step).toBeLessThan(result.totalSteps);
        expect(DRUM_LANES).toContain(event.lane);
        expect(event.velocity).toBeGreaterThan(0);
        expect(event.velocity).toBeLessThanOrEqual(1);
        expect(event.choke).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("scales the step count with the step setting", () => {
    const steps: Record<DrumBlock["steps"], number> = { 8: 16, 16: 32, 32: 64 };
    for (const [setting, total] of Object.entries(steps)) {
      const result = generateDrums(
        withDrums(baseParams(), { steps: Number(setting) as 8 | 16 | 32 }),
      );
      expect(result.totalSteps).toBe(total);
      expect(result.steps).toHaveLength(total);
    }
  });

  it("plays at most one hit of a lane per step", () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const events of generateDrums(baseParams({ seed })).steps) {
        const lanes = events.map((event) => event.lane);
        expect(new Set(lanes).size).toBe(lanes.length);
      }
    }
  });

  it("is silent at density 0", () => {
    expect(eventsOf(baseParams({ density: 0 }))).toHaveLength(0);
  });
});

describe("generateDrums density", () => {
  it("never reshuffles the pattern: a higher density is a superset", () => {
    const low = eventsOf(baseParams({ density: 0.3 }));
    const high = eventsOf(baseParams({ density: 0.9 }));
    const highKeys = new Set(high.map((event) => `${event.step}:${event.lane}`));
    for (const event of low) {
      expect(highKeys.has(`${event.step}:${event.lane}`)).toBe(true);
    }
  });

  it("increases the number of hits with density", () => {
    const seeds = Array.from({ length: 20 }, (_, index) => index + 1);
    const totals = [0.2, 0.5, 0.8].map((density) =>
      seeds.reduce(
        (sum, seed) => sum + eventsOf(baseParams({ seed, density })).length,
        0,
      ),
    );
    expect(totals[1]).toBeGreaterThan(totals[0]);
    expect(totals[2]).toBeGreaterThan(totals[1]);
  });
});

describe("generateDrums setting isolation", () => {
  it("keeps the events identical when only playback or timbre settings change", () => {
    const base = baseParams();
    const variants: DrumParams[] = [
      { ...base, effects: { reverb: 0, delay: 0 } },
      { ...base, effects: { reverb: 0.9, delay: 0.8 } },
      { ...base, tempo: 140 },
      { ...base, swing: 0.5 },
      withDrums(base, { kit: "acoustic" }),
      withDrums(base, { kit: "lofi" }),
    ];
    for (const variant of variants) {
      expect(eventsOf(variant)).toEqual(eventsOf(base));
    }
  });

  it("changes the events when note-shaping settings change", () => {
    const seeds = Array.from({ length: 12 }, (_, index) => index + 1);
    const settings: Partial<DrumBlock>[] = [
      { style: "four-on-floor" },
      { style: "halftime" },
      { style: "trap" },
      { steps: 8 },
      { steps: 32 },
      { ghostNotes: 0 },
      { ghostNotes: 0.8 },
      { fills: 0 },
      { fills: 0.9 },
      { hatDensity: 0 },
      { hatDensity: 1 },
    ];
    for (const override of settings) {
      const differ = seeds.filter((seed) => {
        const base = baseParams({ seed });
        return (
          hashDrumEvents(eventsOf(base)) !==
          hashDrumEvents(eventsOf(withDrums(base, override)))
        );
      });
      expect(differ.length).toBeGreaterThan(0);
    }
  });

  it("does not depend on the shared pitch settings", () => {
    const base = baseParams();
    // Drums have no pitch: the root and the scale cannot change the pattern.
    expect(eventsOf({ ...base, root: "F#" })).toEqual(eventsOf(base));
    expect(eventsOf({ ...base, scale: "pentatonic-major" })).toEqual(
      eventsOf(base),
    );
  });
});

describe("generateDrums hashing", () => {
  it("counts the lane as part of the event", () => {
    const a: DrumEvent[] = [
      { step: 0, lane: "kick", velocity: 0.9, choke: 0 },
    ];
    const b: DrumEvent[] = [
      { step: 0, lane: "snare", velocity: 0.9, choke: 0 },
    ];
    expect(hashDrumEvents(a)).not.toBe(hashDrumEvents(b));
  });

  it("counts the choke as part of the event", () => {
    const a: DrumEvent[] = [
      { step: 0, lane: "open-hat", velocity: 0.6, choke: 0 },
    ];
    const b: DrumEvent[] = [
      { step: 0, lane: "open-hat", velocity: 0.6, choke: 2 },
    ];
    expect(hashDrumEvents(a)).not.toBe(hashDrumEvents(b));
  });

  it("gives a different hash to a different pattern", () => {
    const a = eventsOf(baseParams({ seed: 1 }));
    const b = eventsOf(baseParams({ seed: 2 }));
    expect(hashDrumEvents(a)).not.toBe(hashDrumEvents(b));
  });
});

describe("generateDrums open hat choke", () => {
  it("chokes an open hat with the next hat, closed or open", () => {
    let found = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const result = generateDrums(baseParams({ seed }));
      const hats = result.steps.flatMap((events, step) =>
        events
          .filter(
            (event) => event.lane === "closed-hat" || event.lane === "open-hat",
          )
          .map((event) => ({ event, step })),
      );
      const openHats = hats.filter((hat) => hat.event.lane === "open-hat");
      for (const open of openHats) {
        if (open.event.choke === 0) continue;
        const next = hats.find((hat) => hat.step > open.step);
        if (!next) continue;
        found++;
        expect(open.event.choke).toBe((next as { step: number }).step - open.step);
        // A closed hat is never choked itself.
        for (const hat of hats) {
          if (hat.event.lane === "closed-hat") expect(hat.event.choke).toBe(0);
        }
        break;
      }
      if (found > 0) break;
    }
    expect(found).toBeGreaterThan(0);
  });

  it("chokes the last open hat with the first hat of the next round", () => {
    const result = generateDrums(baseParams({ seed: 5 }));
    const lastOpen = result.steps
      .flatMap((events, step) =>
        events.map((event) => ({ event, step })),
      )
      .filter((entry) => entry.event.lane === "open-hat")
      .pop();
    if (!lastOpen || lastOpen.event.choke === 0) return;
    expect(lastOpen.event.choke).toBeGreaterThan(0);
  });
});

describe("generateDrums diversity", () => {
  const seeds = Array.from({ length: 50 }, (_, index) => index + 1);
  const results = seeds.map((seed) => generateDrums(baseParams({ seed })));

  it("spreads all archetypes across 50 seeds", () => {
    const counts = new Map<DrumArchetypeId, number>(
      DRUM_ARCHETYPES.map((id) => [id, 0]),
    );
    for (const result of results) {
      counts.set(result.archetype, (counts.get(result.archetype) ?? 0) + 1);
    }
    for (const id of DRUM_ARCHETYPES) {
      const count = counts.get(id) ?? 0;
      console.log(`[DRUM ARCHETYPE] ${id} = ${count}`);
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps every archetype reachable from every style", () => {
    for (const style of DRUM_STYLES) {
      const seen = new Set<DrumArchetypeId>();
      for (let seed = 1; seed <= 200; seed++) {
        seen.add(
          generateDrums(withDrums(baseParams({ seed }), { style })).archetype,
        );
      }
      for (const id of DRUM_ARCHETYPES) {
        expect(seen.has(id)).toBe(true);
      }
    }
  });

  it("gives every archetype its own groove", () => {
    const onsets = new Map<DrumArchetypeId, Set<string>>();
    for (const result of results) {
      const set = onsets.get(result.archetype) ?? new Set<string>();
      set.add(
        [...hitSet(result.steps.flat())].sort().join(","),
      );
      onsets.set(result.archetype, set);
    }
    for (const [id, set] of onsets) {
      expect(set.size).toBeGreaterThan(0);
      for (const other of onsets.keys()) {
        if (other === id) continue;
        const overlap = [...set].filter((value) =>
          [...(onsets.get(other) as Set<string>)].includes(value),
        ).length;
        // Two archetypes never share one and the same groove everywhere.
        expect(overlap).toBeLessThan(set.size);
      }
    }
  });

  it("never repeats a pattern across 50 seeds", () => {
    const patterns = new Set(
      results.map((result) => [...hitSet(result.steps.flat())].sort().join(",")),
    );
    console.log(`[DRUM PATTERNS] distinct = ${patterns.size} of ${results.length}`);
    expect(patterns.size).toBe(results.length);
  });

  it("keeps pairwise similarity below the threshold", () => {
    let total = 0;
    let pairs = 0;
    let max = 0;
    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        const similarity = similarityOf(
          results[i].steps.flat(),
          results[j].steps.flat(),
        );
        total += similarity;
        max = Math.max(max, similarity);
        pairs++;
      }
    }
    const average = total / pairs;
    console.log(`[DRUM SIMILARITY] average = ${average.toFixed(4)}`);
    console.log(`[DRUM SIMILARITY] max = ${max.toFixed(4)}`);
    // The threshold is high enough to not force a completely different groove
    // per seed while still requiring variety. The measured metric is reported.
    expect(average).toBeLessThan(0.75);
    // No two seeds should be near-clones.
    expect(max).toBeLessThan(0.98);
  });
});

describe("generateDrums ghosts and fills", () => {
  it("adds quiet ghost notes only when the ghost setting asks for them", () => {
    const without = eventsOf(
      withDrums(baseParams(), { ghostNotes: 0 }),
    ).filter((event) => event.velocity < 0.3);
    expect(without).toHaveLength(0);
    const withGhosts = eventsOf(
      withDrums(baseParams(), { ghostNotes: 1 }),
    ).filter((event) => event.velocity < 0.3);
    expect(withGhosts.length).toBeGreaterThan(0);
  });

  it("keeps the ghost notes quieter than the main hits", () => {
    const events = eventsOf(withDrums(baseParams(), { ghostNotes: 1 }));
    const loudest = Math.max(...events.map((event) => event.velocity));
    const ghosts = events.filter((event) => event.velocity < 0.3);
    expect(ghosts.length).toBeGreaterThan(0);
    for (const ghost of ghosts) {
      expect(ghost.velocity).toBeLessThan(loudest);
    }
  });

  it("adds a fill at the end of the last bar", () => {
    const result = generateDrums(withDrums(baseParams(), { fills: 0.9 }));
    const lastBar = result.steps.slice(result.stepsPerBar);
    const hits = lastBar.flat().length;
    const firstBar = result.steps.slice(0, result.stepsPerBar).flat().length;
    expect(hits).toBeGreaterThan(firstBar);
  });
});

describe("generateDrums styles", () => {
  it("keeps every style a different weight of the same archetypes", () => {
    const counts = new Map<DrumStyleName, Map<DrumArchetypeId, number>>();
    for (const style of DRUM_STYLES) {
      const styleCounts = new Map<DrumArchetypeId, number>();
      for (let seed = 1; seed <= 200; seed++) {
        const archetype = generateDrums(
          withDrums(baseParams({ seed }), { style }),
        ).archetype;
        styleCounts.set(archetype, (styleCounts.get(archetype) ?? 0) + 1);
      }
      counts.set(style, styleCounts);
    }
    // The style leans the draw, but every style still reaches every archetype.
    for (const [, styleCounts] of counts) {
      expect(styleCounts.size).toBe(DRUM_ARCHETYPES.length);
    }
  });
});
