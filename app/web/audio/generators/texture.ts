import { mulberry32 } from "../../lib/prng";
import { buildPool } from "../theory";
import {
  TEXTURE_ARCHETYPES,
  type TextureArchetypeId,
  type TextureEvent,
  type TextureParams,
  type TextureResult,
  type TextureVoiceKind,
} from "../types";

/**
 * Texture is a sparse scatter of short gestures, not a melody. Every seed
 * draws in a fixed order:
 *
 *   1. an archetype and its timbre family (structure),
 *   2. the gesture slots inside each bar (timing),
 *   3. the pitch centre and filter brightness (brightness),
 *   4. the length of each gesture (duration),
 *   5. the velocity of each gesture (velocity),
 *   6. how many gestures survive the density/crackle settings (density).
 *
 * Each concern has its own sub-seed, so changing one setting never reshuffles
 * the rest. Tempo, swing, effects, noise type, filter type and filter
 * frequency are playback-only: they never enter the event stream.
 */

export const TEXTURE_STEPS_PER_BAR = 16;
export const TEXTURE_BARS = 4;
export const TEXTURE_TOTAL_STEPS = TEXTURE_STEPS_PER_BAR * TEXTURE_BARS;

/**
 * Hard CPU/level limits. A bar may start at most six gestures and at most six
 * gestures may be sounding on any step. The deterministic dropping rule is:
 * while a bar or a step is over the limit, drop the gesture that started
 * latest; ties go to the gesture generated later.
 */
export const TEXTURE_MAX_EVENTS_PER_BAR = 6;
export const TEXTURE_MAX_SIMULTANEOUS = 6;

const SALTS = {
  structure: 0x6b1f39a7,
  timing: 0x1c74e2d5,
  brightness: 0x2d85f3e6,
  duration: 0x3e96a4f7,
  velocity: 0x4fa7b508,
  density: 0x50b8c619,
} as const;

const TONAL_LOW = 60; // C4
const TONAL_HIGH = 84; // C6

type Profile = {
  voice: TextureVoiceKind | "mixed";
  baseCount: number;
  slots: readonly number[];
  brightness: [number, number];
  duration: [number, number];
  velocity: [number, number];
};

const DUST_SLOTS = [0, 2, 3, 5, 7, 9, 10, 12, 14, 15] as const;
const RAIN_SLOTS = [0, 2, 4, 6, 8, 10, 12, 14] as const;
const SHIMMER_SLOTS = [0, 5, 10, 14] as const;
const BREATH_SLOTS = [0, 8] as const;
const METALLIC_SLOTS = [1, 3, 6, 9, 11, 14] as const;
const ALL_SLOTS = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
] as const;

const PROFILES: Record<TextureArchetypeId, Profile> = {
  "dust-grains": {
    voice: "dust",
    baseCount: 6,
    slots: DUST_SLOTS,
    brightness: [0.35, 0.85],
    duration: [1, 1],
    velocity: [0.08, 0.26],
  },
  "rain-pulse": {
    voice: "rain",
    baseCount: 6,
    slots: RAIN_SLOTS,
    brightness: [0.35, 0.72],
    duration: [1, 2],
    velocity: [0.1, 0.28],
  },
  "shimmer-swells": {
    voice: "shimmer",
    baseCount: 3,
    slots: SHIMMER_SLOTS,
    brightness: [0.65, 1],
    duration: [6, 16],
    velocity: [0.12, 0.32],
  },
  "breath-noise": {
    voice: "breath",
    baseCount: 2,
    slots: BREATH_SLOTS,
    brightness: [0.15, 0.5],
    duration: [10, 24],
    velocity: [0.08, 0.22],
  },
  "metallic-drips": {
    voice: "shimmer",
    baseCount: 4,
    slots: METALLIC_SLOTS,
    brightness: [0.8, 1],
    duration: [1, 2],
    velocity: [0.12, 0.34],
  },
  "granular-cloud": {
    voice: "mixed",
    baseCount: 8,
    slots: ALL_SLOTS,
    brightness: [0.3, 0.85],
    duration: [1, 1],
    velocity: [0.05, 0.2],
  },
};

function subSeed(seed: number, salt: number): number {
  let h = (seed ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function lerp(range: readonly [number, number], t: number): number {
  return range[0] + (range[1] - range[0]) * clamp01(t);
}

function pick<T>(rand: () => number, values: readonly T[]): T {
  return values[Math.min(values.length - 1, Math.floor(rand() * values.length))];
}

function tonalPool(params: TextureParams): number[] {
  const pool = buildPool(params.root, params.scale, 4).filter(
    (midi) => midi >= TONAL_LOW && midi <= TONAL_HIGH,
  );
  return pool.length > 0 ? pool : [60, 64, 67, 72];
}

function shuffled<T>(rand: () => number, values: readonly T[]): T[] {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * A stable rotation derived from the movement settings. The rotation changes
 * the slots (so movement is audible in the event stream) without touching the
 * brightness, duration or velocity streams.
 */
function movementPhase(params: TextureParams): number {
  const block = params.texture;
  return Math.abs(
    Math.floor(block.movementRate * 3 + block.movementDepth * 2) % 16,
  );
}

function pickSlots(
  rand: () => number,
  slots: readonly number[],
  count: number,
  phase: number,
): number[] {
  const rotated = [...new Set(slots.map((slot) => (slot + phase) % 16))];
  const target = Math.min(count, rotated.length, TEXTURE_MAX_EVENTS_PER_BAR);
  return shuffled(rand, rotated)
    .slice(0, target)
    .sort((a, b) => a - b);
}

function voiceFor(
  profile: Profile,
  bar: number,
  slot: number,
  bias: number,
): TextureVoiceKind {
  if (profile.voice !== "mixed") return profile.voice;
  // Granular cloud shares the dust and rain sources, but never lets the two
  // families drift into one texture: the split is fixed by the seed.
  return (bar + slot + Math.floor(bias * 5)) % 5 < 3 ? "dust" : "rain";
}

type Candidate = TextureEvent & { order: number };

/** Deterministic per-bar cap: drop the latest-starting gesture first. */
function applyBarCap(events: Candidate[], bar: number): Candidate[] {
  let kept = events;
  const inBar = (event: Candidate) => Math.floor(event.step / TEXTURE_STEPS_PER_BAR) === bar;
  while (kept.filter(inBar).length > TEXTURE_MAX_EVENTS_PER_BAR) {
    const candidates = kept.filter(inBar).sort(
      (a, b) => b.step - a.step || b.order - a.order,
    );
    kept = kept.filter((event) => event !== candidates[0]);
  }
  return kept;
}

/** Deterministic overlap cap: drop the latest-starting active gesture first. */
function applySimultaneousCap(events: Candidate[]): Candidate[] {
  let kept = events;
  for (let step = 0; step < TEXTURE_TOTAL_STEPS; step++) {
    while (true) {
      const active = kept.filter(
        (event) =>
          event.step <= step && step < event.step + event.durationSteps,
      );
      if (active.length <= TEXTURE_MAX_SIMULTANEOUS) break;
      active.sort((a, b) => b.step - a.step || b.order - a.order);
      kept = kept.filter((event) => event !== active[0]);
    }
  }
  return kept;
}

function enforceCaps(events: Candidate[]): TextureEvent[] {
  let kept = events;
  for (let bar = 0; bar < TEXTURE_BARS; bar++) {
    kept = applyBarCap(kept, bar);
  }
  kept = applySimultaneousCap(kept);
  return kept
    .sort((a, b) => a.step - b.step || a.order - b.order)
    .map((event) => ({
      step: event.step,
      pitch: event.pitch,
      brightness: event.brightness,
      velocity: event.velocity,
      durationSteps: event.durationSteps,
      voice: event.voice,
    }));
}

export function generateTexture(params: TextureParams): TextureResult {
  const randStructure = mulberry32(subSeed(params.seed, SALTS.structure));
  const randTiming = mulberry32(subSeed(params.seed, SALTS.timing));
  const randBrightness = mulberry32(subSeed(params.seed, SALTS.brightness));
  const randDuration = mulberry32(subSeed(params.seed, SALTS.duration));
  const randVelocity = mulberry32(subSeed(params.seed, SALTS.velocity));
  const randDensity = mulberry32(subSeed(params.seed, SALTS.density));

  const archetype = pick(randStructure, TEXTURE_ARCHETYPES);
  const profile = PROFILES[archetype];
  const mixBias = randStructure();
  const pool = tonalPool(params);
  const block = params.texture;
  const phase = movementPhase(params);
  const densityScale = 0.45 + clamp01(params.density) * 1.1;
  const events: Candidate[] = [];
  let order = 0;

  for (let bar = 0; bar < TEXTURE_BARS; bar++) {
    const jitter = (randDensity() - 0.5) * 1.4;
    const count = clampInt(
      profile.baseCount * densityScale + jitter,
      1,
      TEXTURE_MAX_EVENTS_PER_BAR,
    );
    const slots = pickSlots(randTiming, profile.slots, count, phase);

    for (const slot of slots) {
      const roll = clamp01(lerp(profile.brightness, randBrightness()));
      const pitch = pool[Math.min(pool.length - 1, Math.floor(roll * pool.length))];
      const depthJitter = (randBrightness() - 0.5) * block.movementDepth * 0.25;
      const durationRoll = randDuration();
      const velocityRoll = randVelocity();
      const step = bar * TEXTURE_STEPS_PER_BAR + slot;
      const maxDuration = Math.max(1, TEXTURE_TOTAL_STEPS - step);
      const durationSteps = clampInt(
        lerp(profile.duration, durationRoll),
        1,
        maxDuration,
      );
      const velocity = clamp01(
        lerp(profile.velocity, velocityRoll) *
          (1 + (randVelocity() - 0.5) * block.movementDepth * 0.25),
      );

      events.push({
        step,
        pitch,
        brightness: clamp01(roll + depthJitter),
        velocity,
        durationSteps,
        voice: voiceFor(profile, bar, slot, mixBias),
        order: order++,
      });
    }

    // Crackle is a quiet dust overlay, never a defect: at most four extra
    // grains per bar, each at a very low bounded velocity with a full envelope.
    const extra = clampInt(block.crackle * 4, 0, 4);
    const used = new Set(slots);
    for (let i = 0; i < extra; i++) {
      let slot = Math.floor(randDensity() * TEXTURE_STEPS_PER_BAR);
      let tries = 0;
      while (used.has(slot) && tries < TEXTURE_STEPS_PER_BAR) {
        slot = (slot + 1) % TEXTURE_STEPS_PER_BAR;
        tries++;
      }
      if (used.has(slot)) continue;
      used.add(slot);
      const roll = 0.45 + randBrightness() * 0.3;
      const bit = Math.floor(randBrightness() * pool.length);
      const step = bar * TEXTURE_STEPS_PER_BAR + slot;
      events.push({
        step,
        pitch: pool[Math.min(pool.length - 1, bit)],
        brightness: clamp01(roll),
        velocity: 0.04 + randDensity() * 0.08,
        durationSteps: 1,
        voice: "dust",
        order: order++,
      });
    }
  }

  return {
    events: enforceCaps(events),
    archetype,
    totalSteps: TEXTURE_TOTAL_STEPS,
    stepsPerBar: TEXTURE_STEPS_PER_BAR,
  };
}
