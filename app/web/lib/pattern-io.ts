import type { Pattern } from "@gms/shared";
import { GENERATOR_BY_ID } from "./generators";
import { defaultBlock, type GeneratorBlock, type StudioState } from "./studio-state";

function blockFromPattern(pattern: Pattern): GeneratorBlock {
  const { generatorId } = pattern;
  const blockName = GENERATOR_BY_ID[generatorId].blockName;
  const source = (pattern.params as Record<string, unknown>)[blockName];
  const block = defaultBlock(generatorId);

  if (source && typeof source === "object") {
    for (const field of GENERATOR_BY_ID[generatorId].fields) {
      const value = (source as Record<string, unknown>)[field.key];
      if (typeof value === "number" || typeof value === "string") {
        block[field.key] = value;
      }
    }
  }

  return block;
}

// Load a stored pattern back into editor state. `parentSlug` is the pattern this
// session descends from (the remix source), not necessarily the stored one.
export function hydrateState(
  base: StudioState,
  pattern: Pattern,
  parentSlug: string | null,
  title = "",
): StudioState {
  return {
    ...base,
    generatorId: pattern.generatorId,
    seed: pattern.params.seed,
    tempo: pattern.params.tempo,
    root: pattern.params.root,
    scale: pattern.params.scale,
    density: pattern.params.density,
    swing: pattern.params.swing,
    effects: pattern.params.effects,
    blocks: {
      ...base.blocks,
      [pattern.generatorId]: blockFromPattern(pattern),
    },
    title,
    parentSlug,
    playing: false,
    saveStatus: { kind: "idle" },
  };
}
