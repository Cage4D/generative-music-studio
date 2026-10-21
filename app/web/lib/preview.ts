import { generateArpeggio } from "../audio/generators/arpeggio";
import {
  bassStepsPerBar,
  generateBassline,
} from "../audio/generators/bassline";
import { generateMelody } from "../audio/generators/melody";
import {
  ARPEGGIO_STEPS,
  type ArpeggioParams,
  type ArpeggioPatternName,
  type BassBlock,
  type BassStyleName,
  type BasslineParams,
  type MelodyContourName,
  type MelodyParams,
  type NoteLength,
  type StepLength,
  type Waveform,
} from "../audio/types";
import { mulberry32 } from "./prng";
import { GENERATOR_BY_ID } from "./generators";
import { PAGE_STEPS } from "./paging";
import type { GeneratorBlock, StudioState } from "./studio-state";

export type GridNote = {
  /** 0..1: how hard the note is hit. */
  velocity: number;
  /** 0..1: how long the note lasts, relative to the longest note. */
  duration: number;
};

export type GridPreview = {
  kind: "grid";
  rows: number;
  totalSteps: number;
  cells: boolean[];
  /** Optional per-cell note detail, parallel to `cells`. */
  notes?: (GridNote | undefined)[];
  duration: number;
  barEvery?: number;
};

export type PadPreview = {
  kind: "pad";
  duration: number;
  blocks: {
    flex: number;
    bars: { width: number; marginLeft: number }[];
  }[];
};

export type TexturePreview = {
  kind: "texture";
  duration: number;
  bars: { height: number; duration: number; delay: number }[];
};

export type Preview = GridPreview | PadPreview | TexturePreview;

// Everything the preview rendering depends on. Effects and swing are excluded
// because generateArpeggio ignores them, so changing them must not force a
// preview rebuild.
export type PreviewInputs = Pick<
  StudioState,
  "generatorId" | "seed" | "tempo" | "density" | "root" | "scale" | "blocks"
>;

const num = (block: GeneratorBlock, key: string): number => Number(block[key]);
const str = (block: GeneratorBlock, key: string): string => String(block[key]);
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function buildPad(block: GeneratorBlock, tempo: number, rand: () => number): PadPreview {
  const chordLengthBars = num(block, "chordLengthBars");
  const chordSize = num(block, "chordSize");
  const count = Math.ceil(8 / chordLengthBars);

  const blocks = Array.from({ length: count }, () => {
    const bars = Array.from({ length: chordSize }, () => {
      const width = 40 + rand() * 60;
      return { width, marginLeft: rand() * (100 - width) };
    });
    return { flex: chordLengthBars, bars };
  });

  return { kind: "pad", duration: 1920 / tempo, blocks };
}

function buildTexture(
  block: GeneratorBlock,
  rand: () => number,
): TexturePreview {
  const movementRate = num(block, "movementRate");
  const movementDepth = num(block, "movementDepth");
  const duration = Math.min(6, Math.max(0.6, 2 / movementRate));

  const bars = Array.from({ length: 44 }, () => ({
    height: 15 + (25 + rand() * 60) * (0.35 + movementDepth * 0.65),
    duration,
    delay: -(rand() * 3),
  }));

  return { kind: "texture", duration: 1, bars };
}

function buildGrid(
  inputs: PreviewInputs,
  rand: () => number,
): GridPreview {
  const block = inputs.blocks[inputs.generatorId];
  const generator = GENERATOR_BY_ID[inputs.generatorId];
  const rows = generator.rows;
  const isDrums = inputs.generatorId === "drum-pattern";
  const totalSteps = isDrums ? num(block, "steps") : 16;
  const cells: boolean[] = [];

  if (isDrums) {
    const probabilities = [0.3, 0.22, num(block, "hatDensity"), 0.18];
    const fourOnFloor = str(block, "style") === "four-on-floor";
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < totalSteps; column++) {
        let on = rand() < probabilities[row] * (0.5 + inputs.density);
        if (fourOnFloor && row === 0) on = column % 4 === 0;
        cells.push(on);
      }
    }
  } else {
    const picks = Array.from({ length: totalSteps }, () => [
      Math.floor(rand() * rows),
      rand() < inputs.density,
    ] as const);
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < totalSteps; column++) {
        const [pickRow, active] = picks[column];
        cells.push(active && pickRow === row);
      }
    }
  }

  return {
    kind: "grid",
    rows,
    totalSteps,
    cells,
    duration: (totalSteps * 15) / inputs.tempo,
  };
}

export function arpeggioParams(state: StudioState): ArpeggioParams {
  const block = state.blocks.arpeggio;
  return {
    seed: state.seed,
    tempo: state.tempo,
    root: state.root,
    scale: state.scale,
    density: state.density,
    swing: state.swing,
    effects: state.effects,
    arpeggio: {
      pattern: str(block, "pattern") as ArpeggioPatternName,
      octaves: num(block, "octaves"),
      stepLength: str(block, "stepLength") as StepLength,
    },
  };
}

function buildArpeggioGrid(inputs: PreviewInputs): GridPreview {
  const block = inputs.blocks.arpeggio;
  const params: ArpeggioParams = {
    seed: inputs.seed,
    tempo: inputs.tempo,
    root: inputs.root,
    scale: inputs.scale,
    density: inputs.density,
    swing: 0,
    effects: {},
    arpeggio: {
      pattern: str(block, "pattern") as ArpeggioPatternName,
      octaves: num(block, "octaves"),
      stepLength: str(block, "stepLength") as StepLength,
    },
  };
  const { events, range } = generateArpeggio(params);
  const rows = GENERATOR_BY_ID.arpeggio.rows;
  const totalSteps = ARPEGGIO_STEPS;
  const cells = Array.from({ length: rows * totalSteps }, () => false);

  for (const event of events) {
    if (!event) continue;
    const normalized = (event.midi - range.min) / (range.max - range.min + 1);
    const fromBottom = Math.min(rows - 1, Math.floor(normalized * rows));
    const row = rows - 1 - fromBottom;
    cells[row * totalSteps + event.step] = true;
  }

  return {
    kind: "grid",
    rows,
    totalSteps,
    cells,
    duration: (totalSteps * 15) / inputs.tempo,
  };
}

export function basslineFields(block: GeneratorBlock): BassBlock {
  return {
    waveform: str(block, "waveform") as Waveform,
    octave: num(block, "octave"),
    style: str(block, "style") as BassStyleName,
    noteLength: str(block, "noteLength") as NoteLength,
    glide: num(block, "glide"),
    cutoff: num(block, "cutoff"),
  };
}

export function basslineParams(state: StudioState): BasslineParams {
  return {
    seed: state.seed,
    tempo: state.tempo,
    root: state.root,
    scale: state.scale,
    density: state.density,
    swing: state.swing,
    effects: state.effects,
    bass: basslineFields(state.blocks.bassline),
  };
}

/**
 * The bass preview is always one page of 16 columns. A column is an eighth
 * note of the two-bar phrase, so a finer note grid is projected onto it.
 */
export function bassColumnOfStep(step: number, noteLength: NoteLength): number {
  const stepsPerBar = bassStepsPerBar(noteLength);
  const sixteenths = (step * 16) / stepsPerBar;
  const column = Math.floor(sixteenths / 2);
  return Math.max(0, Math.min(PAGE_STEPS - 1, column));
}

function buildBasslineGrid(inputs: PreviewInputs): GridPreview {
  const params: BasslineParams = {
    seed: inputs.seed,
    tempo: inputs.tempo,
    root: inputs.root,
    scale: inputs.scale,
    density: inputs.density,
    swing: 0,
    effects: {},
    bass: basslineFields(inputs.blocks.bassline),
  };
  const { events, pool } = generateBassline(params);
  const rows = GENERATOR_BY_ID.bassline.rows;
  const totalSteps = PAGE_STEPS;
  const cells = Array.from({ length: rows * totalSteps }, () => false);
  const notes: (GridNote | undefined)[] = Array.from(
    { length: rows * totalSteps },
    () => undefined,
  );
  // The pitch of the line, relative to the root, compressed into the few rows
  // the grid has: the lowest pool tone is the bottom row.
  const lowest = pool[0];
  const highest = pool[pool.length - 1];
  const span = highest - lowest;
  const longestGate = events.reduce(
    (longest, event) => Math.max(longest, event?.gate ?? 0),
    0,
  );

  for (const event of events) {
    if (!event) continue;
    const normalized = span === 0 ? 0 : (event.midi - lowest) / span;
    const fromBottom = Math.round(normalized * (rows - 1));
    const row = rows - 1 - fromBottom;
    const column = bassColumnOfStep(event.step, params.bass.noteLength);
    const index = row * totalSteps + column;
    cells[index] = true;
    notes[index] = {
      velocity: clamp01(event.velocity),
      duration:
        longestGate > 0 ? clamp01(event.gate / longestGate) : 1,
    };
  }

  return {
    kind: "grid",
    rows,
    totalSteps,
    cells,
    notes,
    duration: (totalSteps * 30) / inputs.tempo,
  };
}

function melodyFields(block: GeneratorBlock): MelodyParams["melody"] {  return {
    waveform: str(block, "waveform") as Waveform,
    contour: str(block, "contour") as MelodyContourName,
    octaveRange: num(block, "octaveRange"),
    noteLength: str(block, "noteLength") as NoteLength,
    restProbability: num(block, "restProbability"),
    leapiness: num(block, "leapiness"),
    phraseLengthBars: num(block, "phraseLengthBars"),
  };
}

export function melodyParams(state: StudioState): MelodyParams {
  return {
    seed: state.seed,
    tempo: state.tempo,
    root: state.root,
    scale: state.scale,
    density: state.density,
    swing: state.swing,
    effects: state.effects,
    melody: melodyFields(state.blocks.melody),
  };
}

export function engineParamsFor(
  state: StudioState,
): ArpeggioParams | MelodyParams | BasslineParams | null {
  if (state.generatorId === "arpeggio") return arpeggioParams(state);
  if (state.generatorId === "melody") return melodyParams(state);
  if (state.generatorId === "bassline") return basslineParams(state);
  return null;
}

function buildMelodyGrid(inputs: PreviewInputs): GridPreview {
  const params: MelodyParams = {
    seed: inputs.seed,
    tempo: inputs.tempo,
    root: inputs.root,
    scale: inputs.scale,
    density: inputs.density,
    swing: 0,
    effects: {},
    melody: melodyFields(inputs.blocks.melody),
  };
  const { events, range } = generateMelody(params);
  const rows = GENERATOR_BY_ID.melody.rows;
  const totalSteps = events.length;
  const cells = Array.from({ length: rows * totalSteps }, () => false);
  const span = range.max - range.min;

  for (const event of events) {
    if (!event) continue;
    const normalized = span === 0 ? 0.5 : (event.midi - range.min) / span;
    const row = Math.max(0, Math.min(rows - 1, Math.round((1 - normalized) * (rows - 1))));
    cells[row * totalSteps + event.step] = true;
  }

  return {
    kind: "grid",
    rows,
    totalSteps,
    cells,
    duration: (totalSteps * 15) / inputs.tempo,
  };
}

export function buildPreviewFrom(inputs: PreviewInputs): Preview {
  const rand = mulberry32(inputs.seed);
  const block = inputs.blocks[inputs.generatorId];

  if (inputs.generatorId === "arpeggio") {
    return buildArpeggioGrid(inputs);
  }
  if (inputs.generatorId === "melody") {
    return buildMelodyGrid(inputs);
  }
  if (inputs.generatorId === "bassline") {
    return buildBasslineGrid(inputs);
  }
  if (inputs.generatorId === "ambient-pad") {
    return buildPad(block, inputs.tempo, rand);
  }
  if (inputs.generatorId === "texture") {
    return buildTexture(block, rand);
  }
  return buildGrid(inputs, rand);
}

export function buildPreview(state: StudioState): Preview {
  return buildPreviewFrom({
    generatorId: state.generatorId,
    seed: state.seed,
    tempo: state.tempo,
    density: state.density,
    root: state.root,
    scale: state.scale,
    blocks: state.blocks,
  });
}
