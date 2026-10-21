import { mulberry32 } from "../../lib/prng";
import {
  DRUM_ARCHETYPES,
  DRUM_KITS,
  DRUM_LANES,
  DRUM_STYLES,
  type DrumArchetypeId,
  type DrumBlock,
  type DrumEvent,
  type DrumKitName,
  type DrumLane,
  type DrumParams,
  type DrumResult,
  type DrumStyleName,
} from "../types";

/**
 * The drum pattern is a grid of lanes. Every seed draws in a fixed order:
 *
 *   1. an archetype (its per-lane skeletons),
 *   2. the lane details (which extra hits, which ghosts, which fill),
 *   3. the velocities.
 *
 * Each concern and each lane has its own sub-seed, so changing one setting
 * never reshuffles the rest, and the playback-only settings (tempo, swing,
 * effects, kit) never touch the events.
 */

// The pattern is written in sixteenths per bar and quantized onto the step
// grid afterwards, so the same groove can be played at 8, 16 or 32 steps.
const SIXTEENTHS_PER_BAR = 16;

// Two bars: the classic drum loop.
export const DRUM_BARS = 2;

// The style setting leans the seed towards a family of archetypes without
// taking the choice away from it: every archetype stays reachable.
const STYLE_WEIGHTS: Record<
  DrumStyleName,
  Record<DrumArchetypeId, number>
> = {
  "four-on-floor": {
    "four-on-floor": 4,
    "boom-bap": 1,
    breakbeat: 1,
    "half-time": 1,
    "euclid-polyrhythm": 1,
    "sparse-minimal": 1,
  },
  breakbeat: {
    breakbeat: 4,
    "boom-bap": 2,
    "four-on-floor": 1,
    "half-time": 1,
    "euclid-polyrhythm": 1,
    "sparse-minimal": 1,
  },
  halftime: {
    "half-time": 4,
    breakbeat: 1,
    "boom-bap": 1,
    "four-on-floor": 1,
    "euclid-polyrhythm": 1,
    "sparse-minimal": 1,
  },
  trap: {
    "sparse-minimal": 3,
    "half-time": 2,
    breakbeat: 1,
    "boom-bap": 1,
    "four-on-floor": 1,
    "euclid-polyrhythm": 1,
  },
};

// A sub-seed per concern and per lane. The lane salts are spread out so two
// lanes never draw the same stream.
const SALTS = {
  archetype: 0x51a2c3d4,
  fill: 0x62b3d4e5,
} as const;

const LANE_SALTS: Record<DrumLane, number> = {
  kick: 0x11c4e5f6,
  snare: 0x22d5e6f7,
  clap: 0x33e6f708,
  "closed-hat": 0x44f70819,
  "open-hat": 0x5508192a,
  perc: 0x66192a3b,
};

// Ranks decide which hits survive the density setting. The main hits of the
// groove are the most important, the decoration the least.
const RANK_MAIN = 0.05;
const RANK_SECONDARY = 0.22;
const RANK_OFFBEAT = 0.42;
const RANK_FILL = 0.45;
const RANK_GHOST = 0.5;
const RANK_JITTER = 0.08;
// The hats sit behind the kick and the snare, so a thin hat setting pushes
// them towards being dropped.
const RANK_HAT_WEIGHT = 0.35;

// The base velocity per lane. Every lane stays within a few dB of the others,
// so no lane disappears behind the rest.
const VELOCITY_BY_LANE: Record<DrumLane, number> = {
  kick: 0.95,
  snare: 0.85,
  clap: 0.8,
  "closed-hat": 0.6,
  "open-hat": 0.65,
  perc: 0.72,
};

const VELOCITY_JITTER = 0.06;
const VELOCITY_GHOST_MIN = 0.12;
const VELOCITY_GHOST_MAX = 0.28;

function subSeed(seed: number, salt: number): number {
  let h = (seed ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function pick<T>(rand: () => number, values: readonly T[]): T {
  return values[Math.floor(rand() * values.length)];
}

function weightedPick<T extends string>(
  rand: () => number,
  weights: Record<T, number>,
  order: readonly T[],
): T {
  let total = 0;
  for (const key of order) total += weights[key];
  let roll = rand() * total;
  for (const key of order) {
    roll -= weights[key];
    if (roll < 0) return key;
  }
  return order[order.length - 1];
}

/**
 * The Euclidean rhythm E(k, n): k hits spread as evenly as possible over n
 * steps. E(3, 8) is the classic tresillo.
 */
export function euclidPositions(k: number, n: number): number[] {
  const positions: number[] = [];
  for (let i = 0; i < n; i++) {
    const now = Math.floor((i * k) / n);
    const before = Math.floor(((i - 1) * k) / n);
    if (now !== before) positions.push(i);
  }
  return positions;
}

type Hit = {
  /** The position inside the bar, in sixteenths. */
  pos: number;
  /** 1 = the main hit, 0.6 = a secondary hit, 0.2 = a ghost. */
  accent: number;
  kind: "normal" | "ghost" | "fill";
};

const HIT_MAIN: Hit["accent"] = 1;
const HIT_SECONDARY: Hit["accent"] = 0.6;
const HIT_OFFBEAT: Hit["accent"] = 0.45;
const HIT_GHOST: Hit["accent"] = 0.2;

function hit(pos: number, accent: number, kind: Hit["kind"] = "normal"): Hit {
  return { pos, accent, kind };
}

/** The 8th-note hats of a bar. */
function eighthPositions(): number[] {
  return [0, 2, 4, 6, 8, 10, 12, 14];
}

/**
 * The rhythmic skeleton of an archetype, one lane at a time. The archetype
 * owns the shape; the seed picks one of its variations, so two seeds of the
 * same archetype still sound like each other but never the same.
 */
function laneSkeleton(
  archetype: DrumArchetypeId,
  lane: DrumLane,
  bar: number,
  rand: () => number,
  variant: number,
): Hit[] {
  const hits: Hit[] = [];
  const eighths = (positions: number[], accent: Hit["accent"] = HIT_OFFBEAT) => {
    for (const pos of positions) {
      hits.push(hit(pos, pos % 4 === 0 ? HIT_MAIN : accent));
    }
  };
  switch (archetype) {
    case "four-on-floor": {
      if (lane === "kick") {
        if (variant === 2) {
          hits.push(hit(0, HIT_MAIN), hit(3, HIT_OFFBEAT));
          hits.push(hit(8, HIT_MAIN), hit(11, HIT_OFFBEAT));
        } else {
          hits.push(hit(0, HIT_MAIN), hit(4, HIT_SECONDARY));
          hits.push(hit(8, HIT_MAIN), hit(12, HIT_SECONDARY));
          if (variant === 1) {
            hits.push(hit(pick(rand, [7, 15]), HIT_OFFBEAT));
          } else if (rand() < 0.25) {
            hits.push(hit(pick(rand, [14, 7]), HIT_OFFBEAT));
          }
        }
      } else if (lane === "clap") {
        hits.push(hit(4, HIT_MAIN), hit(12, HIT_MAIN));
        if (variant === 1) hits.push(hit(14, HIT_OFFBEAT));
        if (variant === 2) hits.push(hit(15, HIT_OFFBEAT));
      } else if (lane === "closed-hat") {
        if (variant === 1) {
          eighths(eighthPositions());
          for (const pos of [3, 7, 11, 15]) hits.push(hit(pos, HIT_OFFBEAT));
        } else if (variant === 2) {
          eighths([0, 4, 8, 12]);
        } else {
          eighths(eighthPositions());
        }
      } else if (lane === "open-hat") {
        if (variant === 1) {
          hits.push(hit(6, HIT_SECONDARY), hit(14, HIT_SECONDARY));
        } else if (variant === 2) {
          hits.push(hit(14, HIT_SECONDARY));
        } else {
          hits.push(hit(pick(rand, [6, 14]), HIT_SECONDARY));
        }
      } else if (lane === "perc") {
        if (rand() < 0.45) {
          hits.push(hit(pick(rand, [3, 11]), HIT_OFFBEAT));
        }
      }
      break;
    }
    case "boom-bap": {
      if (lane === "kick") {
        hits.push(hit(0, HIT_MAIN), hit(10, HIT_SECONDARY));
        if (variant === 1) {
          hits.push(hit(3, HIT_OFFBEAT));
        } else if (variant === 2) {
          hits.push(hit(7, HIT_OFFBEAT));
        } else if (rand() < 0.3) {
          hits.push(hit(pick(rand, [7, 15]), HIT_OFFBEAT));
        }
      } else if (lane === "snare") {
        hits.push(hit(4, HIT_MAIN), hit(12, HIT_MAIN));
        if (variant === 1) hits.push(hit(15, HIT_OFFBEAT));
        if (variant === 2) hits.push(hit(7, HIT_OFFBEAT));
      } else if (lane === "closed-hat") {
        if (variant === 1) {
          eighths(eighthPositions());
          for (const pos of [3, 11]) hits.push(hit(pos, HIT_OFFBEAT));
        } else if (variant === 2) {
          eighths([0, 4, 8, 12]);
        } else {
          eighths(eighthPositions());
        }
      } else if (lane === "open-hat") {
        if (variant === 1) {
          hits.push(hit(6, HIT_SECONDARY), hit(14, HIT_SECONDARY));
        } else {
          hits.push(hit(14, HIT_SECONDARY));
        }
      } else if (lane === "clap") {
        if (rand() < 0.3) hits.push(hit(12, HIT_SECONDARY));
      } else if (lane === "perc") {
        if (rand() < 0.35) hits.push(hit(pick(rand, [11, 15]), HIT_OFFBEAT));
      }
      break;
    }
    case "breakbeat": {
      if (lane === "kick") {
        hits.push(hit(0, HIT_MAIN), hit(10, HIT_SECONDARY));
        if (variant === 1) {
          hits.push(hit(6, HIT_OFFBEAT));
        } else if (variant === 2) {
          hits.push(hit(11, HIT_OFFBEAT));
        } else if (rand() < 0.45) {
          hits.push(hit(pick(rand, [6, 11, 14]), HIT_OFFBEAT));
        }
      } else if (lane === "snare") {
        hits.push(hit(4, HIT_MAIN), hit(12, HIT_MAIN));
        if (variant === 1) hits.push(hit(7, HIT_OFFBEAT));
        if (variant === 2) hits.push(hit(15, HIT_OFFBEAT));
      } else if (lane === "clap") {
        if (rand() < 0.4) hits.push(hit(12, HIT_SECONDARY));
      } else if (lane === "closed-hat") {
        if (variant === 1) {
          eighths(eighthPositions());
          for (const pos of [3, 7, 11, 15]) hits.push(hit(pos, HIT_OFFBEAT));
        } else if (variant === 2) {
          eighths([0, 4, 8, 12]);
          for (const pos of [3, 11]) hits.push(hit(pos, HIT_OFFBEAT));
        } else {
          eighths(eighthPositions());
          if (rand() < 0.4) {
            hits.push(hit(pick(rand, [3, 7, 11, 15]), HIT_OFFBEAT));
          }
        }
      } else if (lane === "open-hat") {
        if (variant === 1) {
          hits.push(hit(6, HIT_SECONDARY), hit(14, HIT_SECONDARY));
        } else {
          hits.push(hit(pick(rand, [6, 14]), HIT_SECONDARY));
        }
      } else if (lane === "perc") {
        if (rand() < 0.4) hits.push(hit(pick(rand, [7, 15]), HIT_OFFBEAT));
      }
      break;
    }
    case "half-time": {
      if (lane === "kick") {
        hits.push(hit(0, HIT_MAIN));
        if (variant === 1) {
          hits.push(hit(3, HIT_OFFBEAT));
        } else if (variant === 2) {
          hits.push(hit(10, HIT_SECONDARY));
        } else if (rand() < 0.45) {
          hits.push(hit(pick(rand, [10, 11]), HIT_SECONDARY));
        }
      } else if (lane === "snare") {
        hits.push(hit(8, HIT_MAIN));
        if (variant === 1) hits.push(hit(14, HIT_OFFBEAT));
        if (variant === 2) hits.push(hit(3, HIT_OFFBEAT));
      } else if (lane === "clap") {
        if (rand() < 0.5) hits.push(hit(8, HIT_SECONDARY));
      } else if (lane === "closed-hat") {
        if (variant === 1) {
          eighths(eighthPositions());
        } else if (variant === 2) {
          eighths([0, 4, 8, 12]);
          for (const pos of [3, 11]) hits.push(hit(pos, HIT_OFFBEAT));
        } else {
          eighths([0, 4, 8, 12]);
        }
      } else if (lane === "open-hat") {
        hits.push(hit(pick(rand, [14, 6]), HIT_SECONDARY));
      } else if (lane === "perc") {
        if (rand() < 0.4) hits.push(hit(pick(rand, [11, 3]), HIT_OFFBEAT));
      }
      break;
    }
    case "euclid-polyrhythm": {
      // Every lane runs its own euclidean rhythm, so the lanes drift against
      // each other. The seed picks how busy each lane is.
      const counts: Record<DrumLane, [number, number]> = {
        kick: variant === 1 ? [5, 16] : [3, 16],
        snare: variant === 2 ? [7, 16] : [5, 16],
        clap: [2, 16],
        "closed-hat": variant === 0 ? [9, 16] : [7, 16],
        "open-hat": [2, 16],
        perc: [5, 16],
      };
      const [pulses, length] = counts[lane];
      const offset = lane === "open-hat" || lane === "perc" ? 1 : 0;
      for (const pos of euclidPositions(pulses, length)) {
        const shifted = (pos + offset) % length;
        hits.push(hit(shifted, pos === 0 ? HIT_MAIN : HIT_SECONDARY));
      }
      break;
    }
    case "sparse-minimal": {
      if (lane === "kick") {
        hits.push(hit(0, HIT_MAIN));
        if (variant === 1) {
          hits.push(hit(8, HIT_SECONDARY));
        } else if (variant === 2) {
          hits.push(hit(6, HIT_OFFBEAT));
        } else if (rand() < 0.35) {
          hits.push(hit(pick(rand, [10, 11]), HIT_OFFBEAT));
        }
      } else if (lane === "snare") {
        hits.push(hit(8, HIT_MAIN));
        if (variant === 1) hits.push(hit(14, HIT_OFFBEAT));
      } else if (lane === "closed-hat") {
        if (variant === 1) {
          hits.push(hit(4, HIT_SECONDARY), hit(12, HIT_SECONDARY));
        } else if (variant === 2) {
          hits.push(hit(0, HIT_SECONDARY), hit(4, HIT_SECONDARY));
          hits.push(hit(12, HIT_SECONDARY));
        } else {
          hits.push(hit(0, HIT_SECONDARY), hit(8, HIT_SECONDARY));
        }
      } else if (lane === "open-hat") {
        if (rand() < 0.6) hits.push(hit(14, HIT_SECONDARY));
      } else if (lane === "perc") {
        if (rand() < 0.35) hits.push(hit(pick(rand, [6, 3]), HIT_OFFBEAT));
      }
      break;
    }
  }
  return hits;
}

/** The positions a ghost note can sit on: the off-sixteenths. */
const GHOST_POSITIONS = [3, 7, 11, 15];

function addGhosts(
  hits: Hit[],
  lane: DrumLane,
  bar: number,
  rand: () => number,
  ghostNotes: number,
): Hit[] {
  if (lane !== "snare" && lane !== "closed-hat") return hits;
  if (ghostNotes <= 0) return hits;
  const taken = new Set(hits.map((entry) => entry.pos));
  for (const pos of GHOST_POSITIONS) {
    if (taken.has(pos)) continue;
    if (rand() >= ghostNotes) continue;
    hits.push(hit(pos, HIT_GHOST, "ghost"));
  }
  return hits;
}

/**
 * A fill: a short run at the end of the last bar. The run uses the positions
 * of the second half of the bar that the lane does not play yet, so a fill
 * never doubles a hit.
 */
function addFill(
  hits: Hit[],
  lane: DrumLane,
  bar: number,
  rand: () => number,
  fills: number,
): Hit[] {
  if (bar !== DRUM_BARS - 1) return hits;
  if (fills <= 0) return hits;
  if (lane !== "snare") return hits;
  const count = Math.max(1, Math.round(fills * 4));
  const taken = new Set(hits.map((entry) => entry.pos));
  const free = [8, 10, 12, 14].filter((pos) => !taken.has(pos));
  // The fill lands at the end of the bar.
  const positions = free.slice(Math.max(0, free.length - count));
  positions.forEach((pos, index) => {
    hits.push({
      pos,
      accent: index === positions.length - 1 ? HIT_SECONDARY : HIT_OFFBEAT,
      kind: "fill",
    });
  });
  return hits;
}

function rankFor(hit: Hit, lane: DrumLane, jitter: number, hatDensity: number): number {
  let rank = RANK_OFFBEAT;
  if (hit.accent >= HIT_MAIN) rank = RANK_MAIN;
  else if (hit.accent >= 0.5) rank = RANK_SECONDARY;
  if (hit.kind === "fill") rank = RANK_FILL;
  if (hit.kind === "ghost") rank = RANK_GHOST;
  if (lane === "closed-hat" || lane === "open-hat") {
    rank += (1 - hatDensity) * RANK_HAT_WEIGHT;
  }
  rank += (jitter - 0.5) * RANK_JITTER;
  return Math.min(0.999, Math.max(0, rank));
}

function velocityFor(
  hit: Hit,
  lane: DrumLane,
  rand: () => number,
): number {
  let velocity = VELOCITY_BY_LANE[lane];
  if (hit.accent >= HIT_MAIN) velocity *= 1;
  else if (hit.accent >= 0.5) velocity *= 0.9;
  else if (hit.accent >= 0.4) velocity *= 0.78;
  if (hit.kind === "ghost") {
    velocity =
      VELOCITY_GHOST_MIN + rand() * (VELOCITY_GHOST_MAX - VELOCITY_GHOST_MIN);
  }
  velocity += (rand() - 0.5) * VELOCITY_JITTER;
  return clamp01(velocity);
}

/** Map a position in sixteenths onto the step grid. */
function toStep(sixteenth: number, stepsPerBar: number): number {
  return Math.round((sixteenth * stepsPerBar) / SIXTEENTHS_PER_BAR);
}

export function drumStepsPerBar(steps: DrumBlock["steps"]): number {
  return steps === 8 ? 8 : steps === 32 ? 32 : 16;
}

/** The step length the engine plays the drum grid with. */
export function drumStepLength(steps: DrumBlock["steps"]): "8n" | "16n" | "32n" {
  if (steps === 8) return "8n";
  if (steps === 32) return "32n";
  return "16n";
}

type Prepared = {
  archetype: DrumArchetypeId;
  stepsPerBar: number;
  totalSteps: number;
  /** The hits of every lane, per bar. */
  lanes: { lane: DrumLane; hits: Hit[][] }[];
  ranks: Map<string, number>;
  velocities: Map<string, number>;
};

function prepare(params: DrumParams): Prepared {
  const block = params.drums;
  const style = (DRUM_STYLES as readonly string[]).includes(block.style)
    ? block.style
    : "breakbeat";
  const archetype = weightedPick(
    mulberry32(subSeed(params.seed, SALTS.archetype)),
    STYLE_WEIGHTS[style],
    DRUM_ARCHETYPES,
  );

  const stepsPerBar = drumStepsPerBar(block.steps);
  const totalSteps = stepsPerBar * DRUM_BARS;

  const lanes: { lane: DrumLane; hits: Hit[][] }[] = [];
  const ranks = new Map<string, number>();
  const velocities = new Map<string, number>();

  for (const lane of DRUM_LANES) {
    const rand = mulberry32(subSeed(params.seed, LANE_SALTS[lane]));
    // The variation of the archetype this lane uses. It is drawn once, so
    // both bars of the pattern share it.
    const variant = Math.floor(rand() * 3);
    const bars: Hit[][] = [];
    for (let bar = 0; bar < DRUM_BARS; bar++) {
      let hits = laneSkeleton(archetype, lane, bar, rand, variant);
      hits = addGhosts(hits, lane, bar, rand, block.ghostNotes);
      hits = addFill(hits, lane, bar, rand, block.fills);
      hits.sort((a, b) => a.pos - b.pos);
      bars.push(hits);
      for (const entry of hits) {
        const key = `${lane}:${bar}:${entry.pos}`;
        ranks.set(key, rankFor(entry, lane, rand(), block.hatDensity));
        velocities.set(key, velocityFor(entry, lane, rand));
      }
    }
    lanes.push({ lane, hits: bars });
  }

  return { archetype, stepsPerBar, totalSteps, lanes, ranks, velocities };
}

/**
 * The open hat is damped by the next hat. The distance is counted in steps
 * and stored in the event, so the tempo can change the sound without
 * changing the events.
 */
function chokeDistances(
  steps: DrumEvent[][],
  totalSteps: number,
): Map<string, number> {
  // Every hat, in step order, with the step it sits on.
  const hats: { step: number; lane: DrumLane }[] = [];
  steps.forEach((events, step) => {
    for (const event of events) {
      if (event.lane === "closed-hat" || event.lane === "open-hat") {
        hats.push({ step, lane: event.lane });
      }
    }
  });
  const distances = new Map<string, number>();
  for (const hat of hats) {
    if (hat.lane !== "open-hat") continue;
    const next = hats.find((other) => other.step > hat.step);
    if (next) {
      distances.set(`${hat.step}:open-hat`, next.step - hat.step);
      continue;
    }
    // The pattern loops: the first hat of the next round damps the last one.
    const first = hats[0];
    if (first) {
      distances.set(`${hat.step}:open-hat`, first.step + totalSteps - hat.step);
    }
  }
  return distances;
}

export function generateDrums(params: DrumParams): DrumResult {
  const { archetype, stepsPerBar, totalSteps, lanes, ranks, velocities } =
    prepare(params);
  const density = params.density;

  const steps: DrumEvent[][] = Array.from({ length: totalSteps }, () => []);
  for (const { lane, hits: bars } of lanes) {
    for (let bar = 0; bar < bars.length; bar++) {
      for (const entry of bars[bar]) {
        const step = bar * stepsPerBar + toStep(entry.pos, stepsPerBar);
        if (step < 0 || step >= totalSteps) continue;
        const key = `${lane}:${bar}:${entry.pos}`;
        const rank = ranks.get(key) ?? 1;
        if (rank >= density) continue;
        steps[step].push({
          step,
          lane,
          velocity: velocities.get(key) ?? 0.6,
          choke: 0,
        });
      }
    }
  }

  // The choke is decided after the events exist, because it depends on which
  // hats actually survived the density setting.
  const distances = chokeDistances(steps, totalSteps);
  for (const events of steps) {
    for (const event of events) {
      if (event.lane !== "open-hat") continue;
      event.choke = distances.get(`${event.step}:open-hat`) ?? 0;
    }
  }

  const used = new Set<DrumLane>();
  for (const events of steps) {
    for (const event of events) used.add(event.lane);
  }

  return {
    steps,
    archetype,
    totalSteps,
    stepsPerBar,
    lanes: DRUM_LANES.filter((lane) => used.has(lane)),
  };
}

/** Every event of the pattern, in step order. */
export function drumEvents(result: DrumResult): DrumEvent[] {
  return result.steps.flat();
}

export const DRUM_KIT_NAMES = DRUM_KITS;
export type { DrumKitName };
