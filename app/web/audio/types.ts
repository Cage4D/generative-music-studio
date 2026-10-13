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

export type Voice = {
  waveform: Waveform;
  attack: number;
  decay: number;
  release: number;
  gain: number;
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
  voice: Voice;
  range: ArpeggioRange;
};
