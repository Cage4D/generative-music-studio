import type { NoteName, ScaleName, StudioEffects } from "../lib/studio-state";

export const ARPEGGIO_STEPS = 64;
export const STEPS_PER_BAR = 16;
export const ARPEGGIO_BARS = ARPEGGIO_STEPS / STEPS_PER_BAR;

export type ArpeggioPatternName = "up" | "down" | "up-down" | "random";

export type StepLength = "4n" | "8n" | "16n" | "32n";

export type ArpeggioBlock = {
  pattern: ArpeggioPatternName;
  octaves: number;
  stepLength: StepLength;
};

export type ArpeggioParams = {
  seed: number;
  tempo: number;
  root: NoteName;
  scale: ScaleName;
  density: number;
  swing: number;
  effects: StudioEffects;
  arpeggio: ArpeggioBlock;
};

export type Waveform = "triangle" | "sine" | "square" | "sawtooth";

export const ARCHETYPES = [
  "rolling",
  "polymeter",
  "euclid",
  "broken-chord",
  "leap",
  "echo",
] as const;

export type ArchetypeId = (typeof ARCHETYPES)[number];

export const VOICE_KINDS = ["pluck", "bell", "soft", "buzz"] as const;

export type VoiceKind = (typeof VOICE_KINDS)[number];

export type PluckVoice = {
  kind: "pluck";
  waveform: Waveform;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  filterStart: number;
  filterEnd: number;
  filterSweep: number;
  gain: number;
};

export type BellVoice = {
  kind: "bell";
  carrier: Waveform;
  modulator: Waveform;
  harmonicity: number;
  modulationIndex: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  gain: number;
};

export type SoftVoice = {
  kind: "soft";
  waveform: Waveform;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  vibratoFrequency: number;
  vibratoDepth: number;
  gain: number;
};

export type BuzzVoice = {
  kind: "buzz";
  waveform: Waveform;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  filterFrequency: number;
  filterQ: number;
  gain: number;
};

export type Voice = PluckVoice | BellVoice | SoftVoice | BuzzVoice;

export type NoteEvent = {
  step: number;
  midi: number;
  velocity: number;
  gate: number;
};

export type ArpeggioRange = {
  min: number;
  max: number;
};

export type ArpeggioResult = {
  events: (NoteEvent | null)[];
  voice: Voice;
  archetype: ArchetypeId;
  range: ArpeggioRange;
};

// --- Melody ---------------------------------------------------------------

// A phrase is built from fixed 16-step blocks; `phraseLengthBars` blocks make
// the loop. The sequence subdivision comes from the melody's `noteLength`.
export const PHRASE_STEPS = 16;

export const MELODY_ARCHETYPES = [
  "stepwise-arch",
  "motif-and-variation",
  "call-and-response",
  "leap-and-fill",
  "pedal-ostinato",
  "sparse-lyrical",
] as const;

export type MelodyArchetypeId = (typeof MELODY_ARCHETYPES)[number];

export type NoteLength = "2n" | "4n" | "8n" | "16n" | "32n";

export type MelodyContourName =
  | "ascending"
  | "descending"
  | "arch"
  | "wave"
  | "random";

export type MelodyBlock = {
  waveform: Waveform;
  contour: MelodyContourName;
  octaveRange: number;
  noteLength: NoteLength;
  restProbability: number;
  leapiness: number;
  phraseLengthBars: number;
};

export type MelodyParams = {
  seed: number;
  tempo: number;
  root: NoteName;
  scale: ScaleName;
  density: number;
  swing: number;
  effects: StudioEffects;
  melody: MelodyBlock;
};

export type MelodyResult = {
  events: (NoteEvent | null)[];
  voice: Voice;
  archetype: MelodyArchetypeId;
  range: ArpeggioRange;
};
