import { NOTE_NAMES } from "@gms/shared";
import { mulberry32 } from "../../lib/prng";
import { SCALE_INTERVALS } from "../theory";
import {
  BASS_ARCHETYPES,
  BASS_STYLES,
  BASS_VOICE_KINDS,
  type BassArchetypeId,
  type BassBlock,
  type BassStyleName,
  type BassVoice,
  type BassVoiceKind,
  type BasslineParams,
  type BasslineResult,
  type NoteEvent,
  type NoteLength,
  type Waveform,
} from "../types";

/**
 * The bassline is monophonic and lives in the low register. Every seed draws
 * in a fixed order:
 *
 *   1. an archetype (its rhythmic skeleton and its note-choice rule),
 *   2. the pool / range / structure parameters,
 *   3. the voice kind and its timbre.
 *
 * Each concern has its own sub-seed, so changing one setting never reshuffles
 * the others, and playback-only settings (tempo, swing, effects, waveform,
 * cutoff, glide) never touch the notes.
 */

// The bass is anchored to the root: the root sits here (D2 = 73 Hz) and the
// `octave` setting moves the whole line down or up in 12-semit steps.
const BASS_BASE_MIDI = 36;
// The register setting moves the line between C1 and C3.
const BASS_OCTAVE_MIN = 1;
const BASS_OCTAVE_MAX = 3;

// A sub voice on this fundamental would put energy below ~40 Hz, so it is
// only offered when the root is high enough.
const SUB_MIN_HZ = 45;

// The fifth of the line, as a semitone offset above the root.
const FIFTH = 7;
// The octave above the root.
const OCTAVE = 12;

// Steps are the note grid: one step is one note of `noteLength`. Two bars.
export const BASS_BARS = 2;

const SIXTEENTHS_PER_BAR = 16;

// Density ranks. The downbeat is the most important onset, the ghost notes
// the least, so thinning keeps the groove and drops the decoration.
const RANK_DOWNBEAT = 0.05;
const RANK_BEAT_THREE = 0.16;
const RANK_BEAT = 0.3;
const RANK_OFFBEAT = 0.55;
const RANK_GHOST = 0.82;
const RANK_JITTER = 0.12;

const VEL_BASE = 0.42;
const VEL_RANGE = 0.3;
const VEL_ACCENT = 0.2;
const VEL_GHOST = 0.18;
const VEL_JITTER = 0.05;

// Per-voice gains. The bass dominates the limiter, so every voice keeps at
// least ~6 dB of headroom below unity.
const GAIN_BY_KIND: Record<BassVoiceKind, number> = {
  sub: 0.4,
  "saw-lowpass": 0.34,
  "soft-square": 0.3,
  "pluck-bass": 0.36,
};

// The style setting is a prior over the archetype draw: it leans the seed
// towards a family of archetypes without taking the choice away from it, so
// every archetype stays reachable from every style.
const STYLE_WEIGHTS: Record<BassStyleName, Record<BassArchetypeId, number>> = {
  root: {
    "root-pulse": 4,
    "pedal-with-fills": 3,
    "octave-bounce": 1,
    walking: 1,
    "syncopated-funk": 1,
    "sub-swell": 1,
  },
  octave: {
    "octave-bounce": 4,
    "sub-swell": 3,
    "root-pulse": 1,
    walking: 1,
    "syncopated-funk": 1,
    "pedal-with-fills": 1,
  },
  walking: {
    walking: 4,
    "root-pulse": 1,
    "octave-bounce": 1,
    "syncopated-funk": 1,
    "pedal-with-fills": 1,
    "sub-swell": 1,
  },
  syncopated: {
    "syncopated-funk": 4,
    "root-pulse": 1,
    "octave-bounce": 1,
    walking: 1,
    "pedal-with-fills": 1,
    "sub-swell": 1,
  },
};

// The waveform setting is playback-only: it picks the instrument family the
// seed may choose from, and therefore the timbre, but never the notes.
const KINDS_BY_WAVEFORM: Record<Waveform, BassVoiceKind[]> = {
  sine: ["sub", "pluck-bass"],
  triangle: ["pluck-bass", "soft-square"],
  square: ["soft-square", "saw-lowpass"],
  sawtooth: ["saw-lowpass", "pluck-bass"],
};

const OSCILLATOR_BY_KIND: Record<BassVoiceKind, Waveform> = {
  sub: "sine",
  "saw-lowpass": "sawtooth",
  "soft-square": "square",
  "pluck-bass": "triangle",
};

const SALTS = {
  structure: 0x2f6b31d7,
  pool: 0x3a7c42e8,
  rhythm: 0x4b8d53f9,
  pitch: 0x5c9e640a,
  density: 0x6daf751b,
  velocity: 0x7eb0862c,
  voice: 0x8fc1973d,
} as const;

function subSeed(seed: number, salt: number): number {
  let h = (seed ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

function mod(value: number, size: number): number {
  return ((value % size) + size) % size;
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

/** Steps per bar for a note length: 8n = 8 steps, 16n = 16 steps. */
export function bassStepsPerBar(noteLength: NoteLength): number {
  const denominator = Number.parseInt(noteLength.slice(0, -1), 10);
  return Number.isFinite(denominator) && denominator > 0 ? denominator : 8;
}

export function bassTotalSteps(noteLength: NoteLength): number {
  return bassStepsPerBar(noteLength) * BASS_BARS;
}

/** Map a position in sixteenths onto the step grid. */
function toStep(sixteenth: number, stepsPerBar: number): number {
  return Math.round((sixteenth * stepsPerBar) / SIXTEENTHS_PER_BAR);
}

/** Map a duration in sixteenths onto the step grid. */
function toGate(sixteenth: number, stepsPerBar: number): number {
  const steps = (sixteenth * stepsPerBar) / SIXTEENTHS_PER_BAR;
  return Math.max(0.2, steps * 0.92);
}

type Slot = {
  /** Position inside the bar, in sixteenth notes. */
  pos: number;
  /** Duration in sixteenth notes. */
  length: number;
  /** 1 = downbeat, 0.6 = other beats, 0.3 = offbeat, 0.15 = ghost. */
  accent: number;
  /** Free slot for the archetype's own bookkeeping. */
  tag?: number;
};

function rankFor(slot: Slot, jitter: number): number {
  const inBar = mod(slot.pos, SIXTEENTHS_PER_BAR);
  let rank = RANK_OFFBEAT;
  if (inBar === 0) rank = RANK_DOWNBEAT;
  else if (inBar === 8) rank = RANK_BEAT_THREE;
  else if (inBar % 4 === 0) rank = RANK_BEAT;
  if (slot.accent <= 0.2) rank = RANK_GHOST;
  rank += (jitter - 0.5) * RANK_JITTER;
  return Math.min(0.999, Math.max(0, rank));
}

function velocityFor(slot: Slot, jitter: number): number {
  let velocity = VEL_BASE + jitter * VEL_RANGE * 0.4;
  if (slot.accent >= 1) velocity += VEL_ACCENT;
  else if (slot.accent >= 0.6) velocity += VEL_ACCENT * 0.5;
  else if (slot.accent <= 0.2) velocity -= VEL_GHOST;
  velocity += (jitter - 0.5) * VEL_JITTER;
  return clamp01(velocity);
}

/** The scale degrees the bass is allowed to use, as offsets above the root. */
function scaleOffsets(
  scale: keyof typeof SCALE_INTERVALS,
): { colour: number; seventh: number } {
  const intervals = SCALE_INTERVALS[scale];
  const exact = (wanted: number) =>
    intervals.findIndex((interval) => interval === wanted);
  const third = exact(3);
  const colour = third >= 0 ? 3 : exact(4) >= 0 ? 4 : 2;
  const seventh = exact(10) >= 0 ? 10 : exact(11) >= 0 ? 11 : 9;
  return { colour, seventh };
}

type PoolChoice = {
  /** The semitone offsets above the root the line may use, ascending. */
  offsets: number[];
  /** Whether the octave above the root may be used. */
  octave: boolean;
};

function buildPoolChoice(
  archetype: BassArchetypeId,
  rand: () => number,
  scale: keyof typeof SCALE_INTERVALS,
): PoolChoice {
  const { colour, seventh } = scaleOffsets(scale);
  switch (archetype) {
    case "root-pulse": {
      // Root and fifth, sometimes the colour on the weak beats.
      const useColour = rand() < 0.45;
      return {
        offsets: useColour ? [0, colour, FIFTH] : [0, FIFTH],
        octave: false,
      };
    }
    case "octave-bounce": {
      return { offsets: [0, FIFTH], octave: true };
    }
    case "walking": {
      // A walk through the scale: root, colour, fifth, seventh.
      const drop = rand();
      const offsets = [0, colour, FIFTH];
      if (drop < 0.5) offsets.push(seventh);
      return { offsets, octave: drop >= 0.75 };
    }
    case "syncopated-funk": {
      return { offsets: [0, colour, FIFTH], octave: true };
    }
    case "pedal-with-fills": {
      return { offsets: [0, colour, FIFTH], octave: rand() < 0.6 };
    }
    case "sub-swell": {
      return { offsets: [0, FIFTH], octave: true };
    }
  }
}

/** The rhythmic skeleton of an archetype, in sixteenth notes per bar. */
function buildSlots(
  archetype: BassArchetypeId,
  rand: () => number,
): Slot[][] {
  const bars: Slot[][] = [];
  for (let bar = 0; bar < BASS_BARS; bar++) {
    let slots: Slot[] = [];
    switch (archetype) {
      case "root-pulse": {
        slots = [0, 4, 8, 12].map((pos) => ({
          pos,
          length: 3.6,
          accent: pos === 0 || pos === 8 ? 1 : 0.6,
        }));
        // One beat now and then is left empty.
        if (rand() < 0.2) {
          const gap = Math.floor(rand() * slots.length);
          slots.splice(gap, 1);
        }
        // Offbeat pickups on some beats.
        if (rand() < 0.55) {
          slots.push({
            pos: pick(rand, [2, 6, 10, 14]),
            length: 1.6,
            accent: 0.3,
          });
        }
        if (rand() < 0.25) {
          slots.push({
            pos: pick(rand, [2, 6, 10, 14]),
            length: 1.2,
            accent: 0.2,
          });
        }
        break;
      }
      case "octave-bounce": {
        // A steady bounce on the eighths, with the odd gap and pickup.
        const positions = [0, 2, 4, 6, 8, 10, 12, 14];
        slots = positions.map((pos) => ({
          pos,
          length: 1.6,
          accent: pos % 4 === 0 ? 0.6 : 0.3,
        }));
        if (rand() < 0.35) {
          const gap = Math.floor(rand() * slots.length);
          slots.splice(gap, 1);
        }
        if (rand() < 0.4) {
          slots.push({
            pos: pick(rand, [1, 3, 5, 7, 9, 11, 13, 15]),
            length: 1.1,
            accent: 0.2,
          });
        }
        break;
      }
      case "walking": {
        slots = [0, 4, 8, 12].map((pos) => ({
          pos,
          length: 3.6,
          accent: pos === 0 || pos === 8 ? 1 : 0.6,
        }));
        // Passing notes between the beats.
        const extra = rand();
        if (extra < 0.35) {
          slots.push({
            pos: pick(rand, [2, 6, 10, 14]),
            length: 1.4,
            accent: 0.35,
          });
        } else if (extra < 0.5) {
          slots.push({ pos: pick(rand, [2, 6]), length: 1.4, accent: 0.35 });
          slots.push({ pos: pick(rand, [10, 14]), length: 1.4, accent: 0.35 });
        }
        // A sixteenth pickup into the next bar.
        if (rand() < 0.25) {
          slots.push({ pos: 15, length: 0.9, accent: 0.2 });
        }
        break;
      }
      case "syncopated-funk": {
        const push = pick(rand, [0, 0, 1, -1]);
        const pattern = [0, 3, 6, 10, 12, 14];
        slots = pattern.map((pos, index) => ({
          pos: mod(pos + (index % 2 === 0 ? 0 : push), SIXTEENTHS_PER_BAR),
          length: index === 0 ? 2.4 : 1.6,
          accent: index === 0 ? 1 : index === 4 ? 0.6 : 0.3,
        }));
        // A ghost note doubles the syncopation.
        if (rand() < 0.6) {
          slots.push({ pos: pick(rand, [7, 15, 2]), length: 1.2, accent: 0.15 });
        }
        // A sixteenth before the downbeat.
        if (rand() < 0.35) {
          slots.push({ pos: 15, length: 0.9, accent: 0.2 });
        }
        break;
      }
      case "pedal-with-fills": {
        if (bar === 0) {
          slots = [{ pos: 0, length: 15, accent: 1 }];
        } else {
          slots = [{ pos: 0, length: 7, accent: 1 }];
          const fill = pick(rand, [2, 3, 4]);
          const start = 16 - fill * 2;
          for (let i = 0; i < fill; i++) {
            slots.push({
              pos: start + i * 2,
              length: 1.6,
              accent: i === fill - 1 ? 0.6 : 0.3,
              tag: i,
            });
          }
        }
        break;
      }
      case "sub-swell": {
        // Long held notes, with the odd move near the end of the bar.
        const holds = rand() < 0.5 ? 2 : 1;
        if (holds === 1) {
          slots = [{ pos: 0, length: 15, accent: 1 }];
        } else {
          slots = [
            { pos: 0, length: 8, accent: 1 },
            { pos: 8, length: 7, accent: 0.6, tag: 1 },
          ];
        }
        break;
      }
    }
    slots.sort((a, b) => a.pos - b.pos);
    bars.push(slots);
  }
  return bars;
}

/**
 * The note-choice rule of an archetype: which pool entry each slot plays.
 * Strong beats always favour the root and the fifth.
 */
function buildPitchPath(
  archetype: BassArchetypeId,
  offsets: number[],
  bars: Slot[][],
  rand: () => number,
): number[][] {
  const root = 0;
  const fifthIndex = Math.max(0, offsets.indexOf(FIFTH));
  const top = offsets.length - 1;

  const paths: number[][] = [];
  for (const slots of bars) {
    const path = new Array<number>(slots.length).fill(root);
    switch (archetype) {
      case "root-pulse": {
        slots.forEach((slot, index) => {
          const inBar = mod(slot.pos, SIXTEENTHS_PER_BAR);
          if (inBar === 0 || inBar === 8) path[index] = root;
          else if (inBar === 4 || inBar === 12) path[index] = fifthIndex;
          else path[index] = rand() < 0.5 ? root : Math.min(fifthIndex + 1, top);
        });
        break;
      }
      case "octave-bounce": {
        // Bounce between the root and the top of the pool.
        const cycle = offsets.length > 2 && rand() < 0.5 ? [0, top, 0, 1] : [0, top];
        slots.forEach((slot, index) => {
          path[index] = cycle[index % cycle.length];
        });
        break;
      }
      case "walking": {
        // A shaped walk through the pool: the seed picks the shape of the
        // line, so two walks rarely land on the same notes.
        const shape = pick(rand, ["arch", "wave", "stair", "fall"] as const);
        const notes = slots.length;
        const span = Math.max(1, notes - 1);
        for (let i = 0; i < notes; i++) {
          if (i === 0 || i === notes - 1) {
            path[i] = root;
            continue;
          }
          const at = i / span;
          let height = 0;
          if (shape === "arch") height = Math.sin(Math.PI * at);
          else if (shape === "wave") height = Math.abs(Math.sin(2 * Math.PI * at));
          else if (shape === "stair") height = i % 2 === 0 ? 0.6 : 1;
          else height = 1 - at;
          const jitter = rand() < 0.35 ? (rand() < 0.5 ? -1 : 1) : 0;
          const index = Math.round(height * top) + jitter;
          path[i] = Math.max(0, Math.min(top, index));
        }
        break;
      }
      case "syncopated-funk": {
        const lift = rand() < 0.4;
        slots.forEach((slot, index) => {
          const inBar = mod(slot.pos, SIXTEENTHS_PER_BAR);
          if (inBar === 0) path[index] = root;
          else if (inBar === 6) path[index] = fifthIndex;
          else if (inBar === 10) path[index] = top;
          else if (inBar === 12) path[index] = lift ? top : root;
          else if (slot.accent <= 0.2) path[index] = Math.min(1, top);
          else path[index] = rand() < 0.6 ? fifthIndex : root;
        });
        break;
      }
      case "pedal-with-fills": {
        // The pedal holds the root, the fill runs up the pool.
        slots.forEach((slot, index) => {
          if (slot.tag === undefined) {
            path[index] = root;
          } else {
            path[index] = Math.min(top, slot.tag + 1);
          }
        });
        break;
      }
      case "sub-swell": {
        // The root holds; the rare move reaches for the fifth.
        slots.forEach((slot, index) => {
          if (slot.tag === 1) path[index] = rand() < 0.5 ? fifthIndex : top;
          else path[index] = root;
        });
        break;
      }
    }
    paths.push(path);
  }
  return paths;
}

function buildBassVoice(
  rand: () => number,
  block: BassBlock,
  archetype: BassArchetypeId,
  rootHz: number,
): BassVoice {
  // A sine sub would put energy below ~40 Hz on a low root, so it is only
  // offered when the fundamental is high enough to stay clean.
  const preferred = KINDS_BY_WAVEFORM[block.waveform] ?? BASS_VOICE_KINDS;
  const candidates = preferred.filter(
    (kind) => kind !== "sub" || rootHz >= SUB_MIN_HZ,
  );
  const fallback = BASS_VOICE_KINDS.filter(
    (kind) => kind !== "sub" || rootHz >= SUB_MIN_HZ,
  );
  const kind = pick(rand, candidates.length > 0 ? candidates : fallback);

  const glide = Math.min(0.08, Math.max(0, block.glide) * 0.08);

  // Envelopes: the archetype decides how long the note lives.
  const swell = archetype === "sub-swell";
  const pluck = archetype === "syncopated-funk" || kind === "pluck-bass";
  const attack = swell ? 0.04 + rand() * 0.1 : 0.005 + rand() * 0.015;
  const decay = pluck ? 0.08 + rand() * 0.1 : 0.12 + rand() * 0.2;
  const sustain = swell
    ? 0.75 + rand() * 0.2
    : pluck
      ? 0.05 + rand() * 0.1
      : 0.3 + rand() * 0.3;
  const release = swell ? 0.35 + rand() * 0.35 : 0.12 + rand() * 0.2;

  // The user's cutoff sets the filter; the seed only nudges it.
  const cutoff = Math.min(
    8000,
    Math.max(100, block.cutoff * (0.85 + rand() * 0.3)),
  );
  const waveform = OSCILLATOR_BY_KIND[kind];

  switch (kind) {
    case "sub":
      return {
        kind,
        waveform,
        attack,
        decay,
        sustain,
        release,
        gain: GAIN_BY_KIND.sub,
        glide,
      };
    case "saw-lowpass":
      return {
        kind,
        waveform,
        attack,
        decay,
        sustain,
        release,
        filterFrequency: cutoff,
        filterQ: 0.7 + rand() * 1.3,
        gain: GAIN_BY_KIND["saw-lowpass"],
        glide,
      };
    case "soft-square":
      return {
        kind,
        waveform,
        attack,
        decay,
        sustain,
        release,
        filterFrequency: Math.min(cutoff, 1200),
        filterQ: 0.5 + rand(),
        gain: GAIN_BY_KIND["soft-square"],
        glide,
      };
    case "pluck-bass":
      return {
        kind,
        waveform,
        attack,
        decay,
        sustain,
        release,
        filterFrequency: cutoff,
        filterQ: 0.7 + rand() * 1.6,
        gain: GAIN_BY_KIND["pluck-bass"],
        glide,
      };
  }
}

type Prepared = {
  archetype: BassArchetypeId;
  pool: number[];
  offsets: number[];
  baseMidi: number;
  voice: BassVoice;
  totalSteps: number;
  stepsPerBar: number;
  bars: Slot[][];
  paths: number[][];
  ranks: number[][];
  velocities: number[][];
};

function prepare(params: BasslineParams): Prepared {
  const randStructure = mulberry32(subSeed(params.seed, SALTS.structure));
  const randPool = mulberry32(subSeed(params.seed, SALTS.pool));
  const randRhythm = mulberry32(subSeed(params.seed, SALTS.rhythm));
  const randPitch = mulberry32(subSeed(params.seed, SALTS.pitch));
  const randDensity = mulberry32(subSeed(params.seed, SALTS.density));
  const randVelocity = mulberry32(subSeed(params.seed, SALTS.velocity));
  const randVoice = mulberry32(subSeed(params.seed, SALTS.voice));

  const style = (BASS_STYLES as readonly string[]).includes(params.bass.style)
    ? params.bass.style
    : "root";

  // 1. The archetype comes first.
  const archetype = weightedPick(
    randStructure,
    STYLE_WEIGHTS[style],
    BASS_ARCHETYPES,
  );

  // 2. Pool, range and structure.
  const choice = buildPoolChoice(archetype, randPool, params.scale);
  const octave = Math.min(
    BASS_OCTAVE_MAX,
    Math.max(BASS_OCTAVE_MIN, Math.round(params.bass.octave || 2)),
  );
  const rootPc = NOTE_NAMES.indexOf(params.root);
  const baseMidi = BASS_BASE_MIDI + (octave - 2) * 12 + rootPc;
  const offsets = [...new Set(choice.offsets)].sort((a, b) => a - b);
  if (choice.octave && !offsets.includes(OCTAVE)) offsets.push(OCTAVE);
  const pool = offsets.map((offset) => baseMidi + offset);

  const stepsPerBar = bassStepsPerBar(params.bass.noteLength);
  const totalSteps = stepsPerBar * BASS_BARS;
  const bars = buildSlots(archetype, randRhythm);
  const paths = buildPitchPath(archetype, offsets, bars, randPitch);

  // Density ranks are fixed per slot and never depend on the density itself.
  const ranks: number[][] = [];
  const velocities: number[][] = [];
  for (const slots of bars) {
    ranks.push(slots.map((slot) => rankFor(slot, randDensity())));
    velocities.push(slots.map((slot) => velocityFor(slot, randVelocity())));
  }

  // 3. The voice, with its timbre.
  const rootHz = 440 * Math.pow(2, (baseMidi - 69) / 12);
  const voice = buildBassVoice(randVoice, params.bass, archetype, rootHz);

  return {
    archetype,
    pool,
    offsets,
    baseMidi,
    voice,
    totalSteps,
    stepsPerBar,
    bars,
    paths,
    ranks,
    velocities,
  };
}

export function generateBassline(params: BasslineParams): BasslineResult {
  const {
    archetype,
    pool,
    offsets,
    baseMidi,
    voice,
    totalSteps,
    stepsPerBar,
    bars,
    paths,
    ranks,
    velocities,
  } = prepare(params);

  const events: (NoteEvent | null)[] = new Array(totalSteps).fill(null);

  for (let bar = 0; bar < bars.length; bar++) {
    const slots = bars[bar];
    for (let index = 0; index < slots.length; index++) {
      const slot = slots[index];
      const step = bar * stepsPerBar + toStep(slot.pos, stepsPerBar);
      if (step >= totalSteps) continue;

      // The pitch is decided before the density test, so thinning never
      // changes which note would have been played.
      const offset = offsets[mod(paths[bar][index], offsets.length)];
      const midi = baseMidi + offset;
      const velocity = velocities[bar][index];

      if (ranks[bar][index] >= params.density) continue;

      events[step] = {
        step,
        midi,
        velocity,
        gate: toGate(slot.length, stepsPerBar),
      };
    }
  }

  return {
    events,
    voice,
    archetype,
    range: { min: pool[0], max: pool[pool.length - 1] },
    pool,
  };
}

export function basslinePool(params: BasslineParams): number[] {
  return prepare(params).pool;
}
