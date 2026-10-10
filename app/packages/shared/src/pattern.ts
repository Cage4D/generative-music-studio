import { z } from "zod";

export const SEED_MAX = 4_294_967_295;

export const NOTE_NAMES = [
  "C", "C#", "D", "D#", "E", "F",
  "F#", "G", "G#", "A", "A#", "B",
] as const;

export const SCALES = [
  "major",
  "minor",
  "dorian",
  "phrygian",
  "lydian",
  "mixolydian",
  "pentatonic-major",
  "pentatonic-minor",
] as const;

export const WAVEFORMS = ["sine", "triangle", "square", "sawtooth"] as const;

export const NOTE_LENGTHS = ["2n", "4n", "8n", "16n", "32n"] as const;

export const GENERATOR_IDS = [
  "arpeggio",
  "ambient-pad",
  "drum-pattern",
  "bassline",
  "texture",
  "melody",
] as const;

const level = z.number().min(0).max(1);

const EffectsSchema = z.strictObject({
  reverb: level.optional(),
  delay: level.optional(),
  chorus: level.optional(),
  phaser: level.optional(),
  distortion: level.optional(),
  filter: level.optional(),
  vibrato: level.optional(),
  tremolo: level.optional(),
});

const BaseParamsShape = {
  seed: z.number().int().min(0).max(SEED_MAX),
  tempo: z.number().int().min(40).max(220),
  root: z.enum(NOTE_NAMES),
  scale: z.enum(SCALES),
  density: level,
  swing: level,
  effects: EffectsSchema,
};

const ArpeggioParamsSchema = z.strictObject({
  ...BaseParamsShape,
  arpeggio: z.strictObject({
    pattern: z.enum(["up", "down", "up-down", "random"]),
    octaves: z.number().int().min(1).max(4),
    stepLength: z.enum(["4n", "8n", "16n", "32n"]),
  }),
});

export const ArpeggioPatternSchema = z.strictObject({
  generatorId: z.literal("arpeggio"),
  params: ArpeggioParamsSchema,
});

const AmbientPadParamsSchema = z.strictObject({
  ...BaseParamsShape,
  pad: z.strictObject({
    waveform: z.enum(WAVEFORMS),
    chordSize: z.number().int().min(2).max(5),
    voicing: z.enum(["close", "open", "wide"]),
    chordLengthBars: z.number().int().min(1).max(8),
    attack: z.number().min(0.01).max(8),
    release: z.number().min(0.1).max(12),
    drift: level,
  }),
});

export const AmbientPadPatternSchema = z.strictObject({
  generatorId: z.literal("ambient-pad"),
  params: AmbientPadParamsSchema,
});

const DrumPatternParamsSchema = z.strictObject({
  ...BaseParamsShape,
  drums: z.strictObject({
    style: z.enum(["four-on-floor", "breakbeat", "halftime", "trap"]),
    kit: z.enum(["acoustic", "electronic", "lofi"]),
    steps: z.union([z.literal(8), z.literal(16), z.literal(32)]),
    ghostNotes: level,
    fills: level,
    hatDensity: level,
  }),
});

export const DrumPatternPatternSchema = z.strictObject({
  generatorId: z.literal("drum-pattern"),
  params: DrumPatternParamsSchema,
});

const BasslineParamsSchema = z.strictObject({
  ...BaseParamsShape,
  bass: z.strictObject({
    waveform: z.enum(WAVEFORMS),
    octave: z.number().int().min(1).max(3),
    style: z.enum(["root", "octave", "walking", "syncopated"]),
    noteLength: z.enum(NOTE_LENGTHS),
    glide: level,
    cutoff: z.number().int().min(100).max(8000),
  }),
});

export const BasslinePatternSchema = z.strictObject({
  generatorId: z.literal("bassline"),
  params: BasslineParamsSchema,
});

const TextureParamsSchema = z.strictObject({
  ...BaseParamsShape,
  texture: z.strictObject({
    noiseType: z.enum(["white", "pink", "brown"]),
    filterType: z.enum(["lowpass", "highpass", "bandpass"]),
    filterFrequency: z.number().int().min(20).max(20000),
    movementRate: z.number().min(0.01).max(10),
    movementDepth: level,
    crackle: level,
  }),
});

export const TexturePatternSchema = z.strictObject({
  generatorId: z.literal("texture"),
  params: TextureParamsSchema,
});

const MelodyParamsSchema = z.strictObject({
  ...BaseParamsShape,
  melody: z.strictObject({
    waveform: z.enum(WAVEFORMS),
    contour: z.enum(["ascending", "descending", "arch", "wave", "random"]),
    octaveRange: z.number().int().min(1).max(3),
    noteLength: z.enum(NOTE_LENGTHS),
    restProbability: level,
    leapiness: level,
    phraseLengthBars: z.number().int().min(1).max(8),
  }),
});

export const MelodyPatternSchema = z.strictObject({
  generatorId: z.literal("melody"),
  params: MelodyParamsSchema,
});

export const PatternSchema = z.discriminatedUnion("generatorId", [
  ArpeggioPatternSchema,
  AmbientPadPatternSchema,
  DrumPatternPatternSchema,
  BasslinePatternSchema,
  TexturePatternSchema,
  MelodyPatternSchema,
]);

export type Pattern = z.infer<typeof PatternSchema>;
export type GeneratorId = (typeof GENERATOR_IDS)[number];
export type ArpeggioPattern = z.infer<typeof ArpeggioPatternSchema>;
export type AmbientPadPattern = z.infer<typeof AmbientPadPatternSchema>;
export type DrumPatternPattern = z.infer<typeof DrumPatternPatternSchema>;
export type BasslinePattern = z.infer<typeof BasslinePatternSchema>;
export type TexturePattern = z.infer<typeof TexturePatternSchema>;
export type MelodyPattern = z.infer<typeof MelodyPatternSchema>;