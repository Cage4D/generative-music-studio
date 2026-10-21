import { NOTE_NAMES } from "@gms/shared";
import { mulberry32 } from "../../lib/prng";
import { BASE_MIDI, SCALE_INTERVALS } from "../theory";
import {
  MELODY_ARCHETYPES,
  PHRASE_STEPS,
  VOICE_KINDS,
  type MelodyArchetypeId,
  type MelodyContourName,
  type MelodyParams,
  type MelodyResult,
  type NoteEvent,
  type LeadVoice,
  type VoiceKind,
  type Waveform,
} from "../types";

// Melody is monophonic. Per-voice gains sit ~6 dB below unity so the melody
// leaves headroom under the master limiter.
const MELODY_GAIN_BY_KIND: Record<VoiceKind, number> = {
  pluck: 0.5,
  bell: 0.32,
  soft: 0.6,
  buzz: 0.42,
};

const GATE_BY_KIND: Record<VoiceKind, number> = {
  pluck: 0.5,
  bell: 0.8,
  soft: 0.9,
  buzz: 0.6,
};

const SOFT_WAVEFORMS: readonly Waveform[] = ["sine", "triangle"];

const RANK_BASE = 0.62;
const RANK_EVEN = 0.42;
const RANK_BEAT = 0.2;
const RANK_DOWNBEAT = 0.07;
const RANK_JITTER = 0.16;

const VEL_BASE = 0.4;
const VEL_RANGE = 0.35;
const VEL_ACCENT = 0.18;
const VEL_JITTER = 0.06;

// Independent sub-seeds so changing one concern never reshuffles another:
// rhythm, pitch, motif (contour shape), velocity, and density ranks each get
// their own stream. Structure seeds the archetype/pool/register/voice.
const SALTS = {
  structure: 0x51ed270b,
  rhythm: 0x1b56c4e9,
  pitch: 0x2c1b3c6d,
  motif: 0x3d2a5e8f,
  velocity: 0x4e3f7a91,
  density: 0x5f4b8c13,
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

function clampIndex(value: number, last: number): number {
  return Math.max(0, Math.min(last, value));
}

function pick<T>(rand: () => number, values: readonly T[]): T {
  return values[Math.floor(rand() * values.length)];
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

function contourTarget(shape: MelodyContourName, t: number): number {
  const u = clamp01(t);
  switch (shape) {
    case "ascending":
      return u;
    case "descending":
      return 1 - u;
    case "arch":
      return u < 0.5 ? 2 * u : 2 - 2 * u;
    case "wave":
      return 0.5 - 0.5 * Math.cos(2 * Math.PI * u);
    case "random":
      return u;
  }
}

function buildMelodyPool(
  intervalSet: readonly number[],
  octaveRange: number,
  base: number,
): number[] {
  const pool: number[] = [];
  for (let octave = 0; octave < octaveRange; octave++) {
    for (const interval of intervalSet) {
      pool.push(base + interval + octave * 12);
    }
  }
  return pool.sort((a, b) => a - b);
}

function resolveIndex(pool: number[], base: number, near: number): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < pool.length; i++) {
    if (mod(pool[i] - base, 12) !== 0) continue;
    const distance = Math.abs(i - near);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

function buildVoice(rand: () => number, waveform: Waveform): LeadVoice {
  const kind = pick(rand, VOICE_KINDS);
  switch (kind) {
    case "pluck":
      return {
        kind,
        waveform,
        attack: 0.005 + rand() * 0.01,
        decay: 0.12 + rand() * 0.16,
        sustain: rand() * 0.15,
        release: 0.2 + rand() * 0.25,
        filterStart: 500 + rand() * 2000,
        filterEnd: 1500 + rand() * 4000,
        filterSweep: 0.08 + rand() * 0.12,
        gain: MELODY_GAIN_BY_KIND.pluck,
      };
    case "bell":
      return {
        kind,
        carrier: waveform,
        modulator: pick(rand, SOFT_WAVEFORMS),
        harmonicity: pick(rand, [1.4, 1.5, 2.4, 2.7, 3.5]),
        modulationIndex: 4 + rand() * 10,
        attack: 0.005 + rand() * 0.01,
        decay: 0.6 + rand() * 0.8,
        sustain: rand() * 0.05,
        release: 0.4 + rand() * 0.6,
        gain: MELODY_GAIN_BY_KIND.bell,
      };
    case "soft":
      return {
        kind,
        waveform,
        attack: 0.15 + rand() * 0.35,
        decay: 0.2 + rand() * 0.3,
        sustain: 0.5 + rand() * 0.3,
        release: 0.5 + rand() * 0.5,
        vibratoFrequency: 3 + rand() * 2.5,
        vibratoDepth: 0.05 + rand() * 0.1,
        gain: MELODY_GAIN_BY_KIND.soft,
      };
    case "buzz":
      return {
        kind,
        waveform,
        attack: 0.005 + rand() * 0.015,
        decay: 0.2 + rand() * 0.3,
        sustain: 0.2 + rand() * 0.3,
        release: 0.25 + rand() * 0.25,
        filterFrequency: 800 + rand() * 1200,
        filterQ: 1 + rand() * 3,
        gain: MELODY_GAIN_BY_KIND.buzz,
      };
  }
}

function buildSkeleton(
  archetype: MelodyArchetypeId,
  numBlocks: number,
  blockLen: number,
  rand: () => number,
): boolean[] {
  const total = numBlocks * blockLen;
  const skeleton = new Array<boolean>(total).fill(false);

  switch (archetype) {
    case "stepwise-arch": {
      const onsets = Math.round(blockLen * (0.4 + rand() * 0.3));
      const baseRotation = Math.floor(rand() * blockLen);
      const shift = 1 + Math.floor(rand() * 3);
      for (let b = 0; b < numBlocks; b++) {
        const pattern = euclid(onsets, blockLen, mod(baseRotation + b * shift, blockLen));
        for (let i = 0; i < blockLen; i++) skeleton[b * blockLen + i] = pattern[i];
      }
      break;
    }
    case "motif-and-variation": {
      const motif = Array.from({ length: blockLen }, () => rand() < 0.5);
      for (let b = 0; b < numBlocks; b++) {
        for (let i = 0; i < blockLen; i++) {
          let on = motif[i];
          if (b > 0 && rand() < 0.15) on = !on;
          skeleton[b * blockLen + i] = on;
        }
      }
      break;
    }
    case "call-and-response": {
      const call = Array.from({ length: blockLen }, () => rand() < 0.55);
      const response = Array.from({ length: blockLen }, () => rand() < 0.38);
      for (let b = 0; b < numBlocks; b++) {
        const pattern = b % 2 === 0 ? call : response;
        for (let i = 0; i < blockLen; i++) skeleton[b * blockLen + i] = pattern[i];
      }
      break;
    }
    case "leap-and-fill": {
      const fillRate = 0.3 + rand() * 0.4;
      for (let b = 0; b < numBlocks; b++) {
        for (let i = 0; i < blockLen; i++) {
          skeleton[b * blockLen + i] = i % 4 === 0 || rand() < fillRate;
        }
      }
      break;
    }
    case "pedal-ostinato": {
      const spacing = pick(rand, [1, 2, 2, 4]);
      for (let b = 0; b < numBlocks; b++) {
        for (let i = 0; i < blockLen; i++) {
          skeleton[b * blockLen + i] = i % spacing === 0 && rand() < 0.85;
        }
      }
      break;
    }
    case "sparse-lyrical": {
      const onsets = 2 + Math.floor(rand() * 3);
      const baseRotation = Math.floor(rand() * blockLen);
      for (let b = 0; b < numBlocks; b++) {
        const pattern = euclid(onsets, blockLen, mod(baseRotation + b * 3, blockLen));
        for (let i = 0; i < blockLen; i++) skeleton[b * blockLen + i] = pattern[i];
      }
      break;
    }
  }

  // Phrase endings always sound so the melody can resolve.
  for (let e = blockLen - 1; e < total; e += blockLen) skeleton[e] = true;
  return skeleton;
}

function buildRanks(total: number, blockLen: number, rand: () => number): number[] {
  const ranks = new Array<number>(total).fill(0);
  for (let step = 0; step < total; step++) {
    const jitter = rand();
    let rank = RANK_BASE;
    if (step % 2 === 0) rank = RANK_EVEN;
    const inBar = step % blockLen;
    if (inBar % 4 === 0) rank = RANK_BEAT;
    if (inBar === 0) rank = RANK_DOWNBEAT;
    rank += (jitter - 0.5) * RANK_JITTER;
    ranks[step] = Math.min(0.999, Math.max(0, rank));
  }
  // Phrase endings survive any density above zero.
  for (let e = blockLen - 1; e < total; e += blockLen) ranks[e] = 0;
  return ranks;
}

function buildRests(total: number, blockLen: number, rand: () => number): number[] {
  const rests = Array.from({ length: total }, () => rand());
  for (let e = blockLen - 1; e < total; e += blockLen) rests[e] = 1;
  return rests;
}

function buildVelocities(
  total: number,
  blockLen: number,
  rand: () => number,
): number[] {
  const velocities = new Array<number>(total).fill(0);
  for (let step = 0; step < total; step++) {
    let velocity = VEL_BASE + rand() * VEL_RANGE;
    const inBar = step % blockLen;
    if (inBar % 4 === 0) velocity += VEL_ACCENT;
    if (inBar === 0) velocity += VEL_ACCENT * 0.5;
    velocity += (rand() - 0.5) * VEL_JITTER;
    velocities[step] = clamp01(velocity);
  }
  return velocities;
}

function buildPath(
  archetype: MelodyArchetypeId,
  contour: MelodyContourName,
  leapiness: number,
  pool: number[],
  base: number,
  total: number,
  blockLen: number,
  randPitch: () => number,
  randMotif: () => number,
): number[] {
  const last = Math.max(0, pool.length - 1);
  const leap = Math.max(1, Math.round(clamp01(leapiness) * 6));
  const path = new Array<number>(total).fill(0);

  const targetAt = (i: number): number => {
    if (contour === "random") return randPitch() * last;
    return contourTarget(contour, total <= 1 ? 0 : i / (total - 1)) * last;
  };

  const stepTo = (idx: number, target: number, allow: number): number => {
    const delta = target - idx + (randPitch() - 0.5) * 1.5;
    const limit = Math.max(1, allow);
    const step = Math.max(-limit, Math.min(limit, Math.round(delta)));
    return clampIndex(idx + step, last);
  };

  if (archetype === "motif-and-variation") {
    const motifLength = 3 + Math.floor(randMotif() * 4);
    const motif: number[] = [];
    for (let i = 0; i < motifLength; i++) {
      motif.push(Math.round((randMotif() * 2 - 1) * (1 + clamp01(leapiness) * 3)));
    }
    const repetitions = Math.ceil(total / motifLength);
    const transposes: number[] = [];
    for (let r = 0; r < repetitions; r++) {
      transposes.push(r === 0 ? 0 : Math.round((randMotif() * 2 - 1) * (1 + clamp01(leapiness) * 2)));
    }
    let idx = clampIndex(Math.round(targetAt(0)), last);
    for (let i = 0; i < total; i++) {
      if (i % motifLength === 0) {
        idx = clampIndex(Math.round(targetAt(i)) + transposes[Math.floor(i / motifLength)], last);
      } else {
        idx = clampIndex(idx + motif[i % motifLength], last);
      }
      path[i] = idx;
    }
  } else if (archetype === "call-and-response") {
    const half = Math.max(1, Math.floor(total / 2));
    let idx = clampIndex(Math.round(targetAt(0)), last);
    for (let i = 0; i < half; i++) {
      idx = stepTo(idx, targetAt(i), leap);
      path[i] = idx;
    }
    for (let i = half; i < total; i++) {
      const j = half - 1 - (i - half);
      path[i] = j >= 0 ? path[j] : path[half - 1];
    }
  } else if (archetype === "leap-and-fill") {
    let idx = clampIndex(Math.round(targetAt(0)), last);
    for (let i = 0; i < total; i++) {
      const accent = i % 4 === 0;
      idx = stepTo(idx, targetAt(i), accent ? leap : 1 + Math.round(clamp01(leapiness)));
      path[i] = idx;
    }
  } else if (archetype === "pedal-ostinato") {
    const pedal = clampIndex(Math.round(randMotif() * last), last);
    for (let i = 0; i < total; i++) {
      const phase = i % 8;
      if (phase === 0) {
        path[i] = clampIndex(Math.round(targetAt(i)), last);
      } else if (phase === 1) {
        path[i] = clampIndex(Math.round((path[i - 1] + pedal) / 2), last);
      } else {
        path[i] = pedal;
      }
    }
  } else if (archetype === "sparse-lyrical") {
    let idx = clampIndex(Math.round(targetAt(0)), last);
    let hold = 0;
    for (let i = 0; i < total; i++) {
      if (hold <= 0) {
        idx = stepTo(idx, targetAt(i), 1 + Math.round(clamp01(leapiness) * 2));
        hold = 2 + Math.floor(randMotif() * 4);
      }
      hold -= 1;
      path[i] = idx;
    }
  } else {
    let idx = clampIndex(Math.round(targetAt(0)), last);
    for (let i = 0; i < total; i++) {
      idx = stepTo(idx, targetAt(i), 1 + Math.round(clamp01(leapiness) * 2));
      path[i] = idx;
    }
  }

  // Resolve each phrase ending to the tonic nearest the current pitch.
  for (let e = blockLen - 1; e < total; e += blockLen) {
    path[e] = resolveIndex(pool, base, e > 0 ? path[e - 1] : path[e]);
  }
  return path;
}

type Prepared = {
  archetype: MelodyArchetypeId;
  pool: number[];
  base: number;
  voice: LeadVoice;
  total: number;
  blockLen: number;
  skeleton: boolean[];
  ranks: number[];
  rests: number[];
  velocities: number[];
  path: number[];
};

function prepare(params: MelodyParams): Prepared {
  const randStructure = mulberry32(subSeed(params.seed, SALTS.structure));
  const intervals = SCALE_INTERVALS[params.scale];

  // 1. Archetype first.
  const archetype = pick(randStructure, MELODY_ARCHETYPES);

  // 2. Scale-degree pool: the tonic plus a seeded subset of the other degrees.
  const degreeCount = Math.min(intervals.length, 3 + Math.floor(randStructure() * 3));
  const others: number[] = [];
  for (let degree = 1; degree < intervals.length; degree++) others.push(degree);
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(randStructure() * (i + 1));
    const swap = others[i];
    others[i] = others[j];
    others[j] = swap;
  }
  const degreeSet = [0, ...others.slice(0, Math.max(0, degreeCount - 1))].sort((a, b) => a - b);

  // Register.
  const octaveShift = pick(randStructure, [-12, 0, 12]);

  // Voice kind and its timbre parameters.
  const voice = buildVoice(randStructure, params.melody.waveform);

  const rootPc = NOTE_NAMES.indexOf(params.root);
  const base = BASE_MIDI + rootPc + octaveShift;
  const octaveRange = Math.max(1, Math.min(3, Math.round(params.melody.octaveRange)));
  const intervalSet = degreeSet.map((degree) => SCALE_INTERVALS[params.scale][degree]);
  const pool = buildMelodyPool(intervalSet, octaveRange, base);

  const numBlocks = Math.max(1, Math.min(8, Math.round(params.melody.phraseLengthBars)));
  const blockLen = PHRASE_STEPS;
  const total = numBlocks * blockLen;

  const skeleton = buildSkeleton(archetype, numBlocks, blockLen, mulberry32(subSeed(params.seed, SALTS.rhythm)));
  const ranks = buildRanks(total, blockLen, mulberry32(subSeed(params.seed, SALTS.density)));
  const rests = buildRests(total, blockLen, mulberry32(subSeed(params.seed, SALTS.rhythm)));
  const velocities = buildVelocities(total, blockLen, mulberry32(subSeed(params.seed, SALTS.velocity)));
  const path = buildPath(
    archetype,
    params.melody.contour,
    params.melody.leapiness,
    pool,
    base,
    total,
    blockLen,
    mulberry32(subSeed(params.seed, SALTS.pitch)),
    mulberry32(subSeed(params.seed, SALTS.motif)),
  );

  return { archetype, pool, base, voice, total, blockLen, skeleton, ranks, rests, velocities, path };
}

export function generateMelody(params: MelodyParams): MelodyResult {
  const { archetype, pool, voice, total, skeleton, ranks, rests, velocities, path } = prepare(params);
  const gate = GATE_BY_KIND[voice.kind];
  const events: (NoteEvent | null)[] = new Array(total).fill(null);

  for (let step = 0; step < total; step++) {
    if (!skeleton[step]) continue;
    if (ranks[step] >= params.density) continue;
    if (rests[step] < params.melody.restProbability) continue;
    events[step] = {
      step,
      midi: pool[path[step]],
      velocity: velocities[step],
      gate,
    };
  }

  return {
    events,
    voice,
    archetype,
    range: { min: pool[0], max: pool[pool.length - 1] },
  };
}

export function melodyPool(params: MelodyParams): number[] {
  return prepare(params).pool;
}
