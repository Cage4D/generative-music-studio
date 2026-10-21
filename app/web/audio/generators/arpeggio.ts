import { NOTE_NAMES } from "@gms/shared";
import { mulberry32 } from "../../lib/prng";
import { BASE_MIDI, SCALE_INTERVALS } from "../theory";
import {
  ARCHETYPES,
  ARPEGGIO_BARS,
  ARPEGGIO_STEPS,
  STEPS_PER_BAR,
  VOICE_KINDS,
  type ArchetypeId,
  type ArpeggioParams,
  type ArpeggioPatternName,
  type ArpeggioResult,
  type NoteEvent,
  type LeadVoice,
  type VoiceKind,
  type Waveform,
} from "../types";

const PLUCK_WAVEFORMS: readonly Waveform[] = ["square", "sawtooth", "triangle"];
const SOFT_WAVEFORMS: readonly Waveform[] = ["sine", "triangle"];
const BUZZ_WAVEFORMS: readonly Waveform[] = ["sawtooth", "square"];

const GAIN_BY_KIND: Record<VoiceKind, number> = {
  pluck: 0.75,
  bell: 0.5,
  soft: 0.95,
  buzz: 0.6,
};

const ONSET_COUNTS: Record<ArchetypeId, readonly number[]> = {
  rolling: [12, 13, 14, 15],
  polymeter: [10, 11, 12, 13],
  euclid: [5, 7, 9, 11],
  "broken-chord": [9, 10, 11, 12],
  leap: [7, 8, 9, 10],
  echo: [8, 9, 10, 11],
};

const BAR_ROT_STEPS = [0, 1, 2, 3, 5, 7];
const CYCLE_LENGTHS = [3, 5, 6, 7];
const BAR_SHIFTS = [-2, 0, 2, 3];
const GATE_FRACTIONS = [0.4, 0.9, 1.6];

const VELOCITY_BASE = 0.35;
const VELOCITY_BASE_RANGE = 0.25;
const VELOCITY_JITTER = 0.06;
const ACCENT_BOOST = 0.3;

const RANK_BASE = 0.62;
const RANK_EVEN = 0.42;
const RANK_BEAT = 0.2;
const RANK_DOWNBEAT = 0.07;
const RANK_ESSENTIAL = 0.18;
const RANK_JITTER = 0.16;

const ACCENT_STEPS = 4;
const ECHO_DELAY = 3;
const ECHO_VELOCITY = 0.45;

function mod(value: number, size: number): number {
  return ((value % size) + size) % size;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function pick<T>(rand: () => number, values: readonly T[]): T {
  return values[Math.floor(rand() * values.length)];
}

function randInt(rand: () => number, max: number): number {
  return Math.floor(rand() * max);
}

function euclid(onsets: number, size: number, rotation: number): boolean[] {
  const pattern = new Array<boolean>(size).fill(false);
  let bucket = 0;
  for (let i = 0; i < size; i++) {
    bucket += onsets;
    if (bucket >= size) {
      bucket -= size;
      pattern[mod(i + rotation, size)] = true;
    }
  }
  return pattern;
}

function rankFor(step: number, essential: boolean, jitter: number): number {
  let rank = RANK_BASE;
  if (step % 2 === 0) rank = RANK_EVEN;
  const inBar = step % STEPS_PER_BAR;
  if (inBar % 4 === 0) rank = RANK_BEAT;
  if (inBar === 0) rank = RANK_DOWNBEAT;
  if (essential) rank = Math.min(rank, RANK_ESSENTIAL);
  rank += (jitter - 0.5) * RANK_JITTER;
  return Math.min(0.999, Math.max(0, rank));
}

function buildPool(
  params: ArpeggioParams,
  degrees: number[],
  octaveShift: number,
): number[] {
  const rootPc = NOTE_NAMES.indexOf(params.root);
  const intervals = SCALE_INTERVALS[params.scale];
  const base = BASE_MIDI + rootPc + octaveShift;
  const pool: number[] = [];
  for (let octave = 0; octave < params.arpeggio.octaves; octave++) {
    for (const degree of degrees) {
      pool.push(base + intervals[degree] + octave * 12);
    }
  }
  return pool.sort((a, b) => a - b);
}

function buildVoice(rand: () => number): LeadVoice {
  const kind = pick(rand, VOICE_KINDS);
  switch (kind) {
    case "pluck":
      return {
        kind,
        waveform: pick(rand, PLUCK_WAVEFORMS),
        attack: 0.002 + rand() * 0.008,
        decay: 0.12 + rand() * 0.16,
        sustain: rand() * 0.15,
        release: 0.15 + rand() * 0.25,
        filterStart: 500 + rand() * 2000,
        filterEnd: 1500 + rand() * 4500,
        filterSweep: 0.08 + rand() * 0.12,
        gain: GAIN_BY_KIND.pluck,
      };
    case "bell":
      return {
        kind,
        carrier: pick(rand, SOFT_WAVEFORMS),
        modulator: pick(rand, SOFT_WAVEFORMS),
        harmonicity: pick(rand, [1.4, 1.5, 2.4, 2.7, 3.5]),
        modulationIndex: 4 + rand() * 10,
        attack: 0.002 + rand() * 0.008,
        decay: 0.6 + rand() * 0.8,
        sustain: rand() * 0.05,
        release: 0.4 + rand() * 0.6,
        gain: GAIN_BY_KIND.bell,
      };
    case "soft":
      return {
        kind,
        waveform: pick(rand, SOFT_WAVEFORMS),
        attack: 0.15 + rand() * 0.35,
        decay: 0.2 + rand() * 0.3,
        sustain: 0.5 + rand() * 0.3,
        release: 0.5 + rand() * 0.5,
        vibratoFrequency: 3 + rand() * 2.5,
        vibratoDepth: 0.05 + rand() * 0.1,
        gain: GAIN_BY_KIND.soft,
      };
    case "buzz":
      return {
        kind,
        waveform: pick(rand, BUZZ_WAVEFORMS),
        attack: 0.005 + rand() * 0.015,
        decay: 0.2 + rand() * 0.3,
        sustain: 0.2 + rand() * 0.3,
        release: 0.2 + rand() * 0.3,
        filterFrequency: 800 + rand() * 1200,
        filterQ: 1 + rand() * 3,
        gain: GAIN_BY_KIND.buzz,
      };
  }
}

type Prepared = {
  rand: () => number;
  pool: number[];
  archetype: ArchetypeId;
  skeleton: boolean[];
  cycleLength: number;
  shape: number[];
  startOffset: number;
  stride: number;
  barShift: number[];
  accentTemplate: boolean[];
  gates: number[];
  voice: LeadVoice;
};

function prepare(params: ArpeggioParams): Prepared {
  const rand = mulberry32(params.seed);
  const scaleLength = SCALE_INTERVALS[params.scale].length;

  // 1. Archetype is always the first thing drawn.
  const archetype = pick(rand, ARCHETYPES);

  // 2. Degrees: k distinct degrees, always including degree 0.
  const k = Math.min(scaleLength, 3 + Math.floor(rand() * 3));
  const nonzero: number[] = [];
  for (let degree = 1; degree < scaleLength; degree++) nonzero.push(degree);
  for (let i = nonzero.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const swap = nonzero[i];
    nonzero[i] = nonzero[j];
    nonzero[j] = swap;
  }
  const degrees = [0, ...nonzero.slice(0, k - 1)].sort((a, b) => a - b);

  // 3. Starting pool index and stride.
  const poolLength = degrees.length * params.arpeggio.octaves;
  const startOffset = randInt(rand, poolLength);
  const stride = 1 + Math.floor(rand() * 3);

  // 4. Register.
  const octaveShift = pick(rand, [-12, 0, 12]);

  // 5. Accent template (4 steps, at least one accent), repeated across the bar.
  const accentTemplate = Array.from({ length: ACCENT_STEPS }, () => rand() < 0.5);
  if (!accentTemplate.some(Boolean)) accentTemplate[0] = true;

  // 6. One gate fraction per bar.
  const gates = Array.from({ length: ARPEGGIO_BARS }, () =>
    pick(rand, GATE_FRACTIONS),
  );

  // 7. Per-bar transposition in pool-index steps (bar 1 stays put).
  const barShift = [0];
  for (let bar = 1; bar < ARPEGGIO_BARS; bar++) barShift.push(pick(rand, BAR_SHIFTS));

  // 8. Archetype rhythm: a seeded onset skeleton per bar.
  const onsetK = pick(rand, ONSET_COUNTS[archetype]);
  const baseRotation = randInt(rand, STEPS_PER_BAR);
  const barRotStep = pick(rand, BAR_ROT_STEPS);
  const skeleton: boolean[] = new Array(ARPEGGIO_STEPS).fill(false);
  for (let bar = 0; bar < ARPEGGIO_BARS; bar++) {
    const rotation =
      archetype === "euclid"
        ? baseRotation
        : mod(baseRotation + bar * barRotStep, STEPS_PER_BAR);
    const bar_ = euclid(onsetK, STEPS_PER_BAR, rotation);
    for (let i = 0; i < STEPS_PER_BAR; i++) {
      skeleton[bar * STEPS_PER_BAR + i] = bar_[i];
    }
  }

  // 9. Archetype phrasing parameters.
  const cycleLength = pick(rand, CYCLE_LENGTHS);
  const shapeLength = 4 + Math.floor(rand() * 3);
  const shapeWidth = Math.max(1, Math.min(4, poolLength));
  const shape = Array.from({ length: shapeLength }, () => randInt(rand, shapeWidth));

  // 10. Voice kind and its seeded parameters.
  const voice = buildVoice(rand);

  return {
    rand,
    pool: buildPool(params, degrees, octaveShift),
    archetype,
    skeleton,
    cycleLength,
    shape,
    startOffset,
    stride,
    barShift,
    accentTemplate,
    gates,
    voice,
  };
}

function walkIndex(
  pattern: ArpeggioPatternName,
  walkPos: number,
  startOffset: number,
  stride: number,
  size: number,
  rNote: number,
): number {
  if (pattern === "random") return mod(Math.floor(rNote * size), size);
  if (pattern === "up-down") {
    const period = 2 * (size - 1);
    if (period <= 0) return 0;
    const position = mod(startOffset + walkPos * stride, period);
    return position < size ? position : period - position;
  }
  const direction = pattern === "down" ? -1 : 1;
  return startOffset + direction * walkPos * stride;
}

export function generateArpeggio(params: ArpeggioParams): ArpeggioResult {
  const {
    rand,
    pool,
    archetype,
    skeleton,
    cycleLength,
    shape,
    startOffset,
    stride,
    barShift,
    accentTemplate,
    gates,
    voice,
  } = prepare(params);

  const size = pool.length;
  const pattern = params.arpeggio.pattern;
  const highStart = Math.max(1, Math.floor(size / 2));
  const events: (NoteEvent | null)[] = new Array(ARPEGGIO_STEPS).fill(null);

  let walkPos = 0;
  let candidateIndex = 0;
  let shapeIndex = 0;
  let repeat = 0;

  for (let step = 0; step < ARPEGGIO_STEPS; step++) {
    // Fixed draw count per step so density never reshuffles pitch.
    const rNote = rand();
    const rVel = rand();
    const rJitter = rand();

    if (!skeleton[step]) continue;

    const bar = Math.floor(step / STEPS_PER_BAR);
    const inBar = step % STEPS_PER_BAR;

    let essential = inBar % 4 === 0;
    if (archetype === "polymeter" && candidateIndex % cycleLength === 0) {
      essential = true;
    }
    if (archetype === "broken-chord" && shapeIndex === 0) essential = true;
    if (archetype === "leap" && candidateIndex % 2 === 0) essential = true;

    const rank = rankFor(step, essential, rJitter);

    // Pitch is computed before the density test so it never depends on density.
    let index = 0;
    switch (archetype) {
      case "rolling": {
        if (candidateIndex % 2 === 0) {
          index = 0;
        } else {
          index = walkIndex(pattern, walkPos, startOffset, stride, size, rNote);
          walkPos += 1;
        }
        break;
      }
      case "polymeter": {
        const cyclePos = walkPos % cycleLength;
        index = walkIndex(pattern, cyclePos, startOffset, stride, size, rNote);
        walkPos += 1;
        break;
      }
      case "euclid": {
        index = walkIndex(pattern, walkPos, startOffset, stride, size, rNote);
        walkPos += 1;
        break;
      }
      case "broken-chord": {
        const direction = pattern === "down" ? -1 : 1;
        const shapeVal = shape[shapeIndex];
        index = mod(shapeVal + repeat * stride * direction, size);
        shapeIndex += 1;
        if (shapeIndex >= shape.length) {
          shapeIndex = 0;
          repeat += 1;
        }
        break;
      }
      case "leap": {
        if (candidateIndex % 2 === 0) {
          index = 0;
        } else {
          index = highStart + mod(walkPos, Math.max(1, size - highStart));
          walkPos += 1;
        }
        break;
      }
      case "echo": {
        index = walkIndex(pattern, walkPos, startOffset, stride, size, rNote);
        walkPos += 1;
        break;
      }
    }

    candidateIndex += 1;

    if (rank >= params.density) continue;

    const poolIndex = mod(index + barShift[bar], size);
    let velocity = VELOCITY_BASE + rVel * VELOCITY_BASE_RANGE;
    if (accentTemplate[step % ACCENT_STEPS]) velocity += ACCENT_BOOST;
    if (archetype === "polymeter" && (candidateIndex - 1) % cycleLength === 0) {
      velocity += ACCENT_BOOST * 0.5;
    }
    velocity += (rJitter - 0.5) * VELOCITY_JITTER;

    events[step] = {
      step,
      midi: pool[poolIndex],
      velocity: clamp01(velocity),
      gate: gates[bar],
    };
  }

  // Echo: a quieter repeat of each sounding onset, three steps later, on the
  // grid. Only placed where the skeleton has no onset so the density superset
  // property is preserved.
  if (archetype === "echo") {
    for (let step = 0; step < ARPEGGIO_STEPS - ECHO_DELAY; step++) {
      const event = events[step];
      if (!event) continue;
      const echoStep = step + ECHO_DELAY;
      if (Math.floor(echoStep / STEPS_PER_BAR) !== Math.floor(step / STEPS_PER_BAR)) {
        continue;
      }
      if (skeleton[echoStep] || events[echoStep]) continue;
      events[echoStep] = {
        step: echoStep,
        midi: event.midi,
        velocity: clamp01(event.velocity * ECHO_VELOCITY),
        gate: event.gate,
      };
    }
  }

  return {
    events,
    voice,
    archetype,
    range: { min: pool[0], max: pool[size - 1] },
  };
}

export function arpeggioPool(params: ArpeggioParams): number[] {
  return prepare(params).pool;
}
