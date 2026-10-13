import { NOTE_NAMES } from "@gms/shared";
import { mulberry32 } from "../../lib/prng";
import { BASE_MIDI, SCALE_INTERVALS } from "../theory";
import {
  ARPEGGIO_BARS,
  ARPEGGIO_STEPS,
  STEPS_PER_BAR,
  type ArpeggioParams,
  type ArpeggioPatternName,
  type ArpeggioResult,
  type NoteEvent,
  type Voice,
  type Waveform,
} from "../types";

const WAVEFORMS: readonly Waveform[] = [
  "triangle",
  "sine",
  "square",
  "sawtooth",
];

const GAIN_BY_WAVEFORM: Record<Waveform, number> = {
  triangle: 1.0,
  sine: 0.85,
  square: 0.5,
  sawtooth: 0.55,
};

const BAR_SHIFTS = [-2, 0, 2, 3];
const GATE_FRACTIONS = [0.4, 0.9, 1.6];

const VELOCITY_BASE = 0.35;
const VELOCITY_BASE_RANGE = 0.25;
const VELOCITY_JITTER = 0.06;
const ACCENT_BOOST = 0.3;

const ATTACK_MIN = 0.005;
const ATTACK_RANGE = 0.045;
const DECAY_MIN = 0.1;
const DECAY_RANGE = 0.3;
const RELEASE_MIN = 0.2;
const RELEASE_RANGE = 0.6;

const ACCENT_STEPS = 4;
const FILL_START = ARPEGGIO_STEPS - 4;

function mod(value: number, size: number): number {
  return ((value % size) + size) % size;
}

function pick<T>(rand: () => number, values: readonly T[]): T {
  return values[Math.floor(rand() * values.length)];
}

type Prepared = {
  rand: () => number;
  pool: number[];
  startOffset: number;
  stride: number;
  barShift: number[];
  accentTemplate: boolean[];
  gates: number[];
  voice: Voice;
};

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

function prepare(params: ArpeggioParams): Prepared {
  const rand = mulberry32(params.seed);
  const scaleLength = SCALE_INTERVALS[params.scale].length;

  // 1. Degrees: k distinct degrees, always including degree 0.
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

  // 2. Starting pool index and stride.
  const poolLength = degrees.length * params.arpeggio.octaves;
  const startOffset = Math.floor(rand() * poolLength);
  const stride = 1 + Math.floor(rand() * 3);

  // 3. Octave shift.
  const octaveShift = rand() < 0.5 ? 0 : 12;

  // 4. Accent template (4 steps, at least one accent), repeated across the bar.
  const accentTemplate = Array.from({ length: ACCENT_STEPS }, () => rand() < 0.5);
  if (!accentTemplate.some(Boolean)) accentTemplate[0] = true;

  // 5. One gate fraction per bar.
  const gates = Array.from({ length: ARPEGGIO_BARS }, () =>
    pick(rand, GATE_FRACTIONS),
  );

  // 6. Per-bar transposition in pool-index steps (bar 1 stays put).
  const barShift = [0];
  for (let bar = 1; bar < ARPEGGIO_BARS; bar++) barShift.push(pick(rand, BAR_SHIFTS));

  // 7. Voice.
  const waveform = pick(rand, WAVEFORMS);
  const voice: Voice = {
    waveform,
    attack: ATTACK_MIN + rand() * ATTACK_RANGE,
    decay: DECAY_MIN + rand() * DECAY_RANGE,
    release: RELEASE_MIN + rand() * RELEASE_RANGE,
    gain: GAIN_BY_WAVEFORM[waveform],
  };

  return {
    rand,
    pool: buildPool(params, degrees, octaveShift),
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
  effectiveStep: number,
  startOffset: number,
  stride: number,
  size: number,
  rNote: number,
): number {
  if (pattern === "random") return Math.floor(rNote * size);
  if (pattern === "up-down") {
    const period = 2 * (size - 1);
    if (period <= 0) return 0;
    const position = mod(startOffset + effectiveStep * stride, period);
    return position < size ? position : period - position;
  }
  const direction = pattern === "down" ? -1 : 1;
  return startOffset + direction * effectiveStep * stride;
}

export function generateArpeggio(params: ArpeggioParams): ArpeggioResult {
  const { rand, pool, startOffset, stride, barShift, accentTemplate, gates, voice } =
    prepare(params);
  const size = pool.length;
  const pattern = params.arpeggio.pattern;
  const events: (NoteEvent | null)[] = [];

  for (let step = 0; step < ARPEGGIO_STEPS; step++) {
    const rRest = rand();
    const rNote = rand();
    const rVel = rand();

    if (rRest >= params.density) {
      events.push(null);
      continue;
    }

    const bar = Math.floor(step / STEPS_PER_BAR);
    const effectiveStep = step >= FILL_START ? 2 * (FILL_START - 1) - step : step;
    const walked = walkIndex(
      pattern,
      effectiveStep,
      startOffset,
      stride,
      size,
      rNote,
    );
    const index = mod(walked + barShift[bar], size);

    let velocity = VELOCITY_BASE + rVel * VELOCITY_BASE_RANGE;
    if (accentTemplate[step % ACCENT_STEPS]) velocity += ACCENT_BOOST;
    velocity += (rNote - 0.5) * VELOCITY_JITTER;

    events.push({
      step,
      midi: pool[index],
      velocity: Math.min(1, Math.max(0, velocity)),
      gate: gates[bar],
    });
  }

  return { events, voice, range: { min: pool[0], max: pool[size - 1] } };
}

export function arpeggioPool(params: ArpeggioParams): number[] {
  return prepare(params).pool;
}
