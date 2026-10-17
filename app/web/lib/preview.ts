import { generateArpeggio } from "../audio/generators/arpeggio";
import {
  ARPEGGIO_STEPS,
  type ArpeggioParams,
  type ArpeggioPatternName,
  type StepLength,
} from "../audio/types";
import { mulberry32 } from "./prng";
import { GENERATOR_BY_ID } from "./generators";
import type { GeneratorBlock, StudioState } from "./studio-state";

export type GridPreview = {
  kind: "grid";
  rows: number;
  totalSteps: number;
  cells: boolean[];
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

export function buildPreviewFrom(inputs: PreviewInputs): Preview {
  const rand = mulberry32(inputs.seed);
  const block = inputs.blocks[inputs.generatorId];

  if (inputs.generatorId === "arpeggio") {
    return buildArpeggioGrid(inputs);
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
