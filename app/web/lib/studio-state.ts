import {
  SEED_MAX,
  type GeneratorId,
  type NOTE_NAMES,
  type SCALES,
} from "@gms/shared";
import { GENERATOR_BY_ID, GENERATORS } from "./generators";

export const EFFECT_IDS = [
  "reverb",
  "delay",
  "chorus",
  "phaser",
  "distortion",
  "filter",
  "vibrato",
  "tremolo",
] as const;

export type EffectId = (typeof EFFECT_IDS)[number];

export type NoteName = (typeof NOTE_NAMES)[number];
export type ScaleName = (typeof SCALES)[number];

export type GeneratorBlock = Record<string, string | number>;

export type StudioEffects = Partial<Record<EffectId, number>>;

export type SharedParams = {
  tempo: number;
  root: NoteName;
  scale: ScaleName;
  density: number;
  swing: number;
};

export type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "waking" }
  | { kind: "saved"; slug: string }
  | { kind: "error"; message: string; retryable: boolean };

export type StudioState = {
  generatorId: GeneratorId;
  seed: number;
  tempo: number;
  root: NoteName;
  scale: ScaleName;
  density: number;
  swing: number;
  effects: StudioEffects;
  blocks: Record<GeneratorId, GeneratorBlock>;
  title: string;
  parentSlug: string | null;
  playing: boolean;
  saveStatus: SaveStatus;
};

export function blockNameFor(generatorId: GeneratorId): string {
  return GENERATOR_BY_ID[generatorId].blockName;
}

export function defaultBlock(generatorId: GeneratorId): GeneratorBlock {
  const block: GeneratorBlock = {};
  for (const field of GENERATOR_BY_ID[generatorId].fields) {
    block[field.key] = field.defaultValue;
  }
  return block;
}

function defaultBlocks(): Record<GeneratorId, GeneratorBlock> {
  return Object.fromEntries(
    GENERATORS.map((generator) => [
      generator.id,
      defaultBlock(generator.id),
    ]),
  ) as Record<GeneratorId, GeneratorBlock>;
}

export function createDefaultState(): StudioState {
  return {
    generatorId: "arpeggio",
    seed: 1839204412,
    tempo: 96,
    root: "D",
    scale: "dorian",
    density: 0.6,
    swing: 0.1,
    effects: { reverb: 0.35, delay: 0.2 },
    blocks: defaultBlocks(),
    title: "",
    parentSlug: null,
    playing: false,
    saveStatus: { kind: "idle" },
  };
}

export function clampSeed(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(SEED_MAX, Math.max(0, Math.floor(value)));
}

export type StudioAction =
  | { type: "selectGenerator"; generatorId: GeneratorId }
  | { type: "setShared"; patch: Partial<SharedParams> }
  | { type: "setSeed"; value: number }
  | { type: "setBlockField"; key: string; value: string | number }
  | { type: "setEffect"; key: EffectId; value: number }
  | { type: "setTitle"; value: string }
  | { type: "setParentSlug"; value: string | null }
  | { type: "togglePlay" }
  | { type: "setSaveStatus"; value: SaveStatus }
  | { type: "hydrate"; state: StudioState };

export function studioReducer(
  state: StudioState,
  action: StudioAction,
): StudioState {
  switch (action.type) {
    case "selectGenerator":
      return {
        ...state,
        generatorId: action.generatorId,
        saveStatus: { kind: "idle" },
      };

    case "setShared":
      return { ...state, ...action.patch, saveStatus: { kind: "idle" } };

    case "setSeed":
      return {
        ...state,
        seed: clampSeed(action.value),
        saveStatus: { kind: "idle" },
      };

    case "setBlockField":
      return {
        ...state,
        blocks: {
          ...state.blocks,
          [state.generatorId]: {
            ...state.blocks[state.generatorId],
            [action.key]: action.value,
          },
        },
        saveStatus: { kind: "idle" },
      };

    case "setEffect": {
      const effects = { ...state.effects };
      if (action.value) effects[action.key] = action.value;
      else delete effects[action.key];
      return { ...state, effects, saveStatus: { kind: "idle" } };
    }

    case "setTitle":
      return { ...state, title: action.value, saveStatus: { kind: "idle" } };

    case "setParentSlug":
      return { ...state, parentSlug: action.value };

    case "togglePlay":
      return { ...state, playing: !state.playing };

    case "setSaveStatus":
      return { ...state, saveStatus: action.value };

    case "hydrate":
      return action.state;
  }
}
