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

// The bass has its own instrument family: a sine sub, a filtered saw, a soft
// square and a short pluck. They are separate persistent instruments in the
// engine, so the arpeggio/melody kinds stay untouched.
export const BASS_VOICE_KINDS = [
  "sub",
  "saw-lowpass",
  "soft-square",
  "pluck-bass",
] as const;

export type BassVoiceKind = (typeof BASS_VOICE_KINDS)[number];

export type AnyVoiceKind = VoiceKind | BassVoiceKind;

export const ALL_VOICE_KINDS = [
  ...VOICE_KINDS,
  ...BASS_VOICE_KINDS,
] as const;

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

// The arpeggio and the melody share the same four voices. The bass has its
// own family, so each generator reports its own voice type.
export type LeadVoice = PluckVoice | BellVoice | SoftVoice | BuzzVoice;

export type Voice = LeadVoice | BassVoice;

// --- Bass ----------------------------------------------------------------

export type SubVoice = {
  kind: "sub";
  waveform: Waveform;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  gain: number;
  glide: number;
};

export type SawLowpassVoice = {
  kind: "saw-lowpass";
  waveform: Waveform;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  filterFrequency: number;
  filterQ: number;
  gain: number;
  glide: number;
};

export type SoftSquareVoice = {
  kind: "soft-square";
  waveform: Waveform;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  filterFrequency: number;
  filterQ: number;
  gain: number;
  glide: number;
};

export type PluckBassVoice = {
  kind: "pluck-bass";
  waveform: Waveform;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  filterFrequency: number;
  filterQ: number;
  gain: number;
  glide: number;
};

export type BassVoice =
  | SubVoice
  | SawLowpassVoice
  | SoftSquareVoice
  | PluckBassVoice;

// The bass is monophonic and low: the root anchors the line, the pool only
// holds a handful of scale tones above it.
export const BASS_ARCHETYPES = [
  "root-pulse",
  "octave-bounce",
  "walking",
  "syncopated-funk",
  "pedal-with-fills",
  "sub-swell",
] as const;

export type BassArchetypeId = (typeof BASS_ARCHETYPES)[number];

export const BASS_STYLES = ["root", "octave", "walking", "syncopated"] as const;

export type BassStyleName = (typeof BASS_STYLES)[number];

export type BassBlock = {
  waveform: Waveform;
  octave: number;
  style: BassStyleName;
  noteLength: NoteLength;
  glide: number;
  cutoff: number;
};

export type BasslineParams = {
  seed: number;
  tempo: number;
  root: NoteName;
  scale: ScaleName;
  density: number;
  swing: number;
  effects: StudioEffects;
  bass: BassBlock;
};

export type BasslineResult = {
  events: (NoteEvent | null)[];
  voice: BassVoice;
  archetype: BassArchetypeId;
  range: ArpeggioRange;
  // Ascending pitches the line may use, root first. The preview maps them to
  // rows so the grid shows the position relative to the root.
  pool: number[];
};

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
  voice: LeadVoice;
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
  voice: LeadVoice;
  archetype: MelodyArchetypeId;
  range: ArpeggioRange;
};
