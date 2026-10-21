import {
  NOTE_LENGTHS,
  WAVEFORMS,
  type GeneratorId,
} from "@gms/shared";

export type SelectOption = string | number;

export type SelectField = {
  kind: "select";
  key: string;
  label: string;
  options: readonly SelectOption[];
  defaultValue: SelectOption;
};

export type SliderField = {
  kind: "slider";
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  // Human unit for assistive tech (e.g. "percent", "Hz", "octaves"). Purely
  // presentational metadata; it never reaches the audio engine.
  unit?: string;
};

export type Field = SelectField | SliderField;

export type GeneratorMeta = {
  id: GeneratorId;
  name: string;
  blockName: string;
  rows: number;
  lede: string;
  fields: readonly Field[];
};

const select = (
  key: string,
  label: string,
  options: readonly SelectOption[],
  defaultValue: SelectOption,
): SelectField => ({ kind: "select", key, label, options, defaultValue });

const slider = (
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  defaultValue: number,
  unit?: string,
): SliderField => ({
  kind: "slider",
  key,
  label,
  min,
  max,
  step,
  defaultValue,
  unit,
});

export const GENERATORS: readonly GeneratorMeta[] = [
  {
    id: "arpeggio",
    name: "Arpeggio",
    blockName: "arpeggio",
    rows: 6,
    lede: "Broken chords that step through the scale, one note at a time.",
    fields: [
      select("pattern", "Pattern", ["up", "down", "up-down", "random"], "up-down"),
      slider("octaves", "Octaves", 1, 4, 1, 2, "octaves"),
      select("stepLength", "Step length", ["4n", "8n", "16n", "32n"], "16n"),
    ],
  },
  {
    id: "ambient-pad",
    name: "Ambient pad",
    blockName: "pad",
    rows: 8,
    lede: "Slow, wide chords that swell and dissolve into the background.",
    fields: [
      select("waveform", "Waveform", WAVEFORMS, "sine"),
      slider("chordSize", "Chord size", 2, 5, 1, 3, "notes"),
      select("voicing", "Voicing", ["close", "open", "wide"], "open"),
      slider("chordLengthBars", "Chord bars", 1, 8, 1, 2, "bars"),
      slider("attack", "Attack (s)", 0.01, 8, 0.01, 2),
      slider("release", "Release (s)", 0.1, 12, 0.1, 4),
      slider("drift", "Drift", 0, 1, 0.05, 0.3, "percent"),
    ],
  },
  {
    id: "drum-pattern",
    name: "Drum pattern",
    blockName: "drums",
    rows: 6,
    lede: "Kick, snare and hats laid out on a step grid.",
    fields: [
      select(
        "style",
        "Style",
        ["four-on-floor", "breakbeat", "halftime", "trap"],
        "breakbeat",
      ),
      select("kit", "Kit", ["acoustic", "electronic", "lofi"], "electronic"),
      select("steps", "Steps", [8, 16, 32], 16),
      slider("ghostNotes", "Ghost notes", 0, 1, 0.05, 0.2, "percent"),
      slider("fills", "Fills", 0, 1, 0.05, 0.2, "percent"),
      slider("hatDensity", "Hat density", 0, 1, 0.05, 0.6, "percent"),
    ],
  },
  {
    id: "bassline",
    name: "Bassline",
    blockName: "bass",
    rows: 4,
    lede: "A low, steady voice that anchors the harmony.",
    fields: [
      select("waveform", "Waveform", WAVEFORMS, "sawtooth"),
      slider("octave", "Octave", 1, 3, 1, 2, "octaves"),
      select(
        "style",
        "Style",
        ["root", "octave", "walking", "syncopated"],
        "walking",
      ),
      select("noteLength", "Note length", NOTE_LENGTHS, "8n"),
      slider("glide", "Glide", 0, 1, 0.05, 0.1, "percent"),
      slider("cutoff", "Cutoff (Hz)", 100, 8000, 50, 1200, "Hz"),
    ],
  },
  {
    id: "texture",
    name: "Texture",
    blockName: "texture",
    rows: 0,
    lede: "Filtered noise that drifts and shimmers underneath.",
    fields: [
      select("noiseType", "Noise", ["white", "pink", "brown"], "pink"),
      select(
        "filterType",
        "Filter",
        ["lowpass", "highpass", "bandpass"],
        "lowpass",
      ),
      slider("filterFrequency", "Frequency (Hz)", 20, 20000, 10, 2000, "Hz"),
      slider("movementRate", "Move rate (Hz)", 0.01, 10, 0.01, 0.4, "Hz"),
      slider("movementDepth", "Move depth", 0, 1, 0.05, 0.5, "percent"),
      slider("crackle", "Crackle", 0, 1, 0.05, 0.1, "percent"),
    ],
  },
  {
    id: "melody",
    name: "Melody",
    blockName: "melody",
    rows: 8,
    lede: "A single line that rises, falls and breathes.",
    fields: [
      select("waveform", "Waveform", WAVEFORMS, "triangle"),
      select(
        "contour",
        "Contour",
        ["ascending", "descending", "arch", "wave", "random"],
        "arch",
      ),
      slider("octaveRange", "Octave range", 1, 3, 1, 2, "octaves"),
      select("noteLength", "Note length", NOTE_LENGTHS, "8n"),
      slider("restProbability", "Rests", 0, 1, 0.05, 0.2, "percent"),
      slider("leapiness", "Leapiness", 0, 1, 0.05, 0.3, "percent"),
      slider("phraseLengthBars", "Phrase bars", 1, 8, 1, 4, "bars"),
    ],
  },
];

export const GENERATOR_BY_ID = Object.fromEntries(
  GENERATORS.map((generator) => [generator.id, generator]),
) as Record<GeneratorId, GeneratorMeta>;

// Generators with a real audio engine and preview. The rest are visible but
// marked "coming soon" and cannot be saved.
export const SUPPORTED_GENERATOR_IDS = [
  "arpeggio",
  "melody",
  "bassline",
  "drum-pattern",
] as const satisfies readonly GeneratorId[];

export function isGeneratorSupported(generatorId: GeneratorId): boolean {
  return (SUPPORTED_GENERATOR_IDS as readonly GeneratorId[]).includes(
    generatorId,
  );
}

/**
 * The one rule that decides whether the save button is live: a generator
 * needs a working engine behind it, a valid request and no save in flight.
 */
export function saveDisabledFor(
  generatorId: GeneratorId,
  valid: boolean,
  saving: boolean,
): boolean {
  return !valid || !isGeneratorSupported(generatorId) || saving;
}
