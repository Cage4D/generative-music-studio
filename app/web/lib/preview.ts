import { generateArpeggio } from "../audio/generators/arpeggio";
import {
  bassStepsPerBar,
  generateBassline,
} from "../audio/generators/bassline";
import { generateDrums } from "../audio/generators/drums";
import { generatePads } from "../audio/generators/pads";
import { generateMelody } from "../audio/generators/melody";
import {
  ARPEGGIO_STEPS,
  DRUM_LANES,
  type ArpeggioParams,
  type ArpeggioPatternName,
  type BassBlock,
  type BassStyleName,
  type BasslineParams,
  type DrumBlock,
  type DrumKitName,
  type DrumParams,
  type DrumStyleName,
  type MelodyContourName,
  type MelodyParams,
  type NoteLength,
  type StepLength,
  type Waveform,
  type PadBlock,
  type PadParams,
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
  const generator = GENERATOR_BY_ID[inputs.generatorId];
  const rows = generator.rows;
  const totalSteps = 16;
  const cells: boolean[] = [];

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

export function drumFields(block: GeneratorBlock): DrumBlock {
  return {
    style: str(block, "style") as DrumStyleName,
    kit: str(block, "kit") as DrumKitName,
    steps: num(block, "steps") as DrumBlock["steps"],
    ghostNotes: num(block, "ghostNotes"),
    fills: num(block, "fills"),
    hatDensity: num(block, "hatDensity"),
  };
}

export function drumParams(state: StudioState): DrumParams {
  return {
    seed: state.seed,
    tempo: state.tempo,
    root: state.root,
    scale: state.scale,
    density: state.density,
    swing: state.swing,
    effects: state.effects,
    drums: drumFields(state.blocks["drum-pattern"]),
  };
}

// The length of one drum step, in milliseconds, for the three step grids.
const DRUM_STEP_MS: Record<DrumBlock["steps"], number> = {
  8: 30,
  16: 15,
  32: 7.5,
};

/**
 * The drum preview is the real pattern: one row per lane, one column per
 * step. The note size carries the velocity, so a ghost note reads as a small
 * dot next to a full hit.
 */
function buildDrumGrid(inputs: PreviewInputs): GridPreview {
  const block = inputs.blocks["drum-pattern"];
  const params: DrumParams = {
    seed: inputs.seed,
    tempo: inputs.tempo,
    root: inputs.root,
    scale: inputs.scale,
    density: inputs.density,
    swing: 0,
    effects: {},
    drums: drumFields(block),
  };
  const result = generateDrums(params);
  const rows = DRUM_LANES.length;
  const totalSteps = result.totalSteps;
  const cells = Array.from({ length: rows * totalSteps }, () => false);
  const notes: (GridNote | undefined)[] = Array.from(
    { length: rows * totalSteps },
    () => undefined,
  );

  result.steps.forEach((events, step) => {
    for (const event of events) {
      const row = DRUM_LANES.indexOf(event.lane);
      if (row < 0) continue;
      const index = row * totalSteps + step;
      cells[index] = true;
      notes[index] = { velocity: clamp01(event.velocity), duration: 1 };
    }
  });

  return {
    kind: "grid",
    rows,
    totalSteps,
    cells,
    notes,
    // The brighter cells mark the beats, like the other grids do.
    barEvery: Math.max(1, Math.round(result.stepsPerBar / 4)),
    duration: (totalSteps * DRUM_STEP_MS[params.drums.steps]) / inputs.tempo,
  };
}

export function engineParamsFor(
  state: StudioState,
): ArpeggioParams | MelodyParams | BasslineParams | DrumParams | PadParams | null {
  if (state.generatorId === "arpeggio") return arpeggioParams(state);
  if (state.generatorId === "melody") return melodyParams(state);
  if (state.generatorId === "bassline") return basslineParams(state);
  if (state.generatorId === "drum-pattern") return drumParams(state);
  if (state.generatorId === "ambient-pad") return padParams(state);
  return null;
}


export function padFields(block: GeneratorBlock): PadBlock {
  return {
    waveform: str(block, "waveform") as Waveform,
    chordSize: num(block, "chordSize"),
    voicing: str(block, "voicing") as PadBlock["voicing"],
    chordLengthBars: num(block, "chordLengthBars"),
    attack: num(block, "attack"),
    release: num(block, "release"),
    drift: num(block, "drift"),
  };
}

export function padParams(state: StudioState): PadParams {
  return {
    seed: state.seed,
    tempo: state.tempo,
    root: state.root,
    scale: state.scale,
    density: state.density,
    swing: state.swing,
    effects: state.effects,
    pad: padFields(state.blocks["ambient-pad"]),
  };
}

function buildPadGrid(inputs: PreviewInputs): PadPreview {
  const params: PadParams = {
    seed: inputs.seed,
    tempo: inputs.tempo,
    root: inputs.root,
    scale: inputs.scale,
    density: inputs.density,
    swing: 0,
    effects: {},
    pad: padFields(inputs.blocks["ambient-pad"]),
  };
  const result = generatePads(params);
  const blocks = result.events.slice(0, 4).map((ev, i) => ({
    flex: Math.max(1, ev.durationSteps / 16),
    bars: Array.from({ length: Math.max(1, Math.min(4, ev.pitches.length)) }, () => ({
      width: 30 + (inputs.seed % 40),
      marginLeft: (i * 15) % 40,
    })),
  }));
  if (blocks.length === 0) {
    blocks.push({ flex: 2, bars: [{ width: 40, marginLeft: 10 }] });
  }
  return {
    kind: "pad",
    duration: (1920 / inputs.tempo),
    blocks,
  };
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
  if (inputs.generatorId === "drum-pattern") {
    return buildDrumGrid(inputs);
  }
  if (inputs.generatorId === "ambient-pad") {
    return buildPadGrid(inputs);
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
