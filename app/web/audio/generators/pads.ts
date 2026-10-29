import { NOTE_NAMES } from "@gms/shared";
import { mulberry32 } from "../../lib/prng";
import { BASE_MIDI, SCALE_INTERVALS } from "../theory";
import {
  PAD_ARCHETYPES,
  type PadChordEvent,
  type PadParams,
  type PadResult,
  type PadVoice,
  type PadVoiceKind,
} from "../types";

const PAD_STEPS_PER_BAR = 16;

const SALTS = {
  structure: 0x9a3b52c1,
  harmony: 0x7d82a913,
  voicing: 0x2f61e874,
  rhythm: 0x81c4d726,
  velocity: 0x56ab932f,
  voice: 0xc83e7d12,
};

function subSeed(seed: number, salt: number): number {
  return (seed ^ salt) >>> 0;
}

function pick<T>(rand: () => number, values: readonly T[]): T {
  return values[Math.floor(rand() * values.length)];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

const PAD_VOICE_KINDS: PadVoiceKind[] = ["warm", "glass", "airy", "soft-organ"];

function buildPadVoice(rand: () => number): PadVoice {
  const kind = pick(rand, PAD_VOICE_KINDS);
  // Keep gains small for headroom; all sustained.
  const gains: Record<PadVoiceKind, number> = {
    warm: 0.16,
    glass: 0.14,
    airy: 0.12,
    "soft-organ": 0.14,
  };
  return { kind, gain: gains[kind] };
}

// Build scale pool in register C3-C5 range
function buildScalePool(params: PadParams, octaves = 4): number[] {
  const rootPc = NOTE_NAMES.indexOf(params.root);
  const intervals = SCALE_INTERVALS[params.scale];
  const pool: number[] = [];
  // Start around BASE_MIDI (48 = C3) and go to ~C5 (72)
  for (let octave = 0; octave < octaves; octave++) {
    for (const interval of intervals) {
      const midi = BASE_MIDI + rootPc + interval + octave * 12;
      if (midi >= 48 && midi <= 72) pool.push(midi);
    }
  }
  return pool.sort((a, b) => a - b);
}

function getChordTones(pool: number[], degree: number, chordSize: number, voicing: "close" | "open" | "wide"): number[] {
  // Simple triad/extended construction from scale degrees
  const len = pool.length;
  if (len === 0) return [];
  // Pick root from scale degrees
  const rootIdx = degree % len;
  const tones = [pool[rootIdx]];
  // Add 3rd, 5th, 7th etc
  if (chordSize >= 2) {
    const idx3 = (rootIdx + 2) % len;
    tones.push(pool[idx3]);
  }
  if (chordSize >= 3) {
    const idx5 = (rootIdx + 4) % len;
    tones.push(pool[idx5]);
  }
  if (chordSize >= 4) {
    tones.push(pool[(rootIdx + 6) % len]);
  }
  if (chordSize >= 5) {
    tones.push(pool[(rootIdx + 9) % len]);
  }
  // Apply voicing
  if (voicing === "open") {
    // Spread out - move some notes up an octave if they cluster
    if (tones.length >= 3) {
      tones[1] = tones[1] + 12;
    }
  } else if (voicing === "wide") {
    if (tones.length >= 2) {
      tones[1] = tones[1] + 12;
    }
    if (tones.length >= 4) {
      tones[3] = tones[3] + 12;
    }
  }
  // Ensure all in range roughly C3-C5
  const result = tones.map((t) => Math.max(48, Math.min(72, t)));
  // Remove duplicates while preserving order
  const seen = new Set<number>();
  const unique: number[] = [];
  for (const t of result) {
    if (!seen.has(t)) {
      seen.add(t);
      unique.push(t);
    }
  }
  // Cap to at most 4 notes total
  return unique.slice(0, 4);
}

// Deterministic note-dropping rule for overlapping chords to enforce max 6 simultaneous notes
function applyOverlapLimit(events: PadChordEvent[], maxSimultaneous = 6): PadChordEvent[] {
  // Build timeline of active notes
  const timeline: Array<{ start: number; end: number; eventIdx: number; noteIdx: number; pitch: number }> = [];
  for (let ei = 0; ei < events.length; ei++) {
    const ev = events[ei];
    const endStep = ev.step + ev.durationSteps;
    for (let ni = 0; ni < ev.pitches.length; ni++) {
      timeline.push({ start: ev.step, end: endStep, eventIdx: ei, noteIdx: ni, pitch: ev.pitches[ni] });
    }
  }
  // For each point, count overlaps - but easier to check by scanning
  // Determine which notes to drop: when > maxSimultaneous overlap, drop from newest/later events deterministically
  const toDrop = new Set<string>();
  // Check all pairs of events for overlap
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const e1 = events[i];
      const e2 = events[j];
      const e1End = e1.step + e1.durationSteps;
      const e2End = e2.step + e2.durationSteps;
      if (e1.step < e2End && e2.step < e1End) {
        // They overlap - count total simultaneous
      }
    }
  }
  // Global check: for each step range, count
  // Find max step
  const maxStep = Math.max(...events.map((e) => e.step + e.durationSteps), 0);
  for (let step = 0; step < maxStep; step++) {
    const active: Array<{ eventIdx: number; noteIdx: number }> = [];
    for (let ei = 0; ei < events.length; ei++) {
      const ev = events[ei];
      if (step >= ev.step && step < ev.step + ev.durationSteps) {
        for (let ni = 0; ni < ev.pitches.length; ni++) {
          active.push({ eventIdx: ei, noteIdx: ni });
        }
      }
    }
    if (active.length > maxSimultaneous) {
      // Drop from latest events (highest eventIdx) deterministically
      const excess = active.length - maxSimultaneous;
      // Sort by event index descending to drop newer events first
      const sorted = [...active].sort((a, b) => b.eventIdx - a.eventIdx || b.noteIdx - a.noteIdx);
      for (let k = 0; k < excess; k++) {
        toDrop.add(`${sorted[k].eventIdx}:${sorted[k].noteIdx}`);
      }
    }
  }
  // Apply drops
  const result: PadChordEvent[] = [];
  for (let ei = 0; ei < events.length; ei++) {
    const ev = events[ei];
    const keptPitches: number[] = [];
    for (let ni = 0; ni < ev.pitches.length; ni++) {
      if (!toDrop.has(`${ei}:${ni}`)) {
        keptPitches.push(ev.pitches[ni]);
      }
    }
    if (keptPitches.length > 0) {
      result.push({ ...ev, pitches: keptPitches });
    }
  }
  return result;
}

export function generatePads(params: PadParams): PadResult {
  const randStructure = mulberry32(subSeed(params.seed, SALTS.structure));
  const randHarmony = mulberry32(subSeed(params.seed, SALTS.harmony));
  const randRhythm = mulberry32(subSeed(params.seed, SALTS.rhythm));
  const randVelocity = mulberry32(subSeed(params.seed, SALTS.velocity));
  const randVoice = mulberry32(subSeed(params.seed, SALTS.voice));

  const archetype = pick(randStructure, PAD_ARCHETYPES);

  const pool = buildScalePool(params);
  const bars = Math.max(1, Math.min(8, Math.round(params.pad.chordLengthBars || 2)));
  const totalBars = 8; // Keep consistent length like other generators
  const stepsPerBar = PAD_STEPS_PER_BAR;
  const totalSteps = totalBars * stepsPerBar;

  const events: PadChordEvent[] = [];
  const chordSize = Math.max(2, Math.min(4, Math.round(params.pad.chordSize))); // At most 4 notes per chord

  // Determine chord change points based on archetype
  let changeInterval = bars * stepsPerBar;
  if (archetype === "drifting-triads") {
    changeInterval = bars * stepsPerBar;
  } else if (archetype === "suspended-clouds") {
    changeInterval = Math.max(stepsPerBar * 2, changeInterval);
  } else if (archetype === "open-fifths") {
    changeInterval = bars * stepsPerBar;
  } else if (archetype === "slow-arp-swells") {
    changeInterval = Math.max(stepsPerBar, changeInterval / 2);
  } else if (archetype === "modal-shift") {
    changeInterval = bars * stepsPerBar;
  } else if (archetype === "drone-plus-colour-tones") {
    changeInterval = totalSteps; // Drone stays long
  }

  // Generate chord progression
  const numChords = Math.max(1, Math.floor(totalSteps / changeInterval));
  const voicing = (["close", "open", "wide"] as const).includes(params.pad.voicing)
    ? params.pad.voicing
    : "open";

  for (let ci = 0; ci < numChords; ci++) {
    const startStep = ci * changeInterval;
    if (startStep >= totalSteps) break;
    // Choose degree
    const degree = Math.floor(randHarmony() * Math.min(pool.length, 7));
    const pitches = getChordTones(pool, degree, chordSize, voicing);
    if (pitches.length === 0) continue;
    const velocity = clamp01(0.4 + randVelocity() * 0.4);
    const durationSteps = Math.min(changeInterval + Math.floor(randRhythm() * 4), totalSteps - startStep); // Long sustained chords
    events.push({
      step: startStep,
      pitches,
      velocity,
      durationSteps,
    });
  }

  // For drone-plus-colour-tones, add a long drone
  if (archetype === "drone-plus-colour-tones" && events.length > 0) {
    // Make first chord very long as drone
    events[0].durationSteps = totalSteps;
    // Maybe add colour tones
  }

  // Apply overlap limiting (max 6 simultaneous notes)
  const limitedEvents = applyOverlapLimit(events, 6);

  const voice = buildPadVoice(randVoice);

  return {
    events: limitedEvents,
    voice,
    archetype,
  };
}
