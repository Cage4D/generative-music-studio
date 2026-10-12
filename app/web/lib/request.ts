import { blockNameFor, type StudioState } from "./studio-state";

export function buildRequest(state: StudioState) {
  const block = state.blocks[state.generatorId];
  const params = {
    seed: state.seed,
    tempo: state.tempo,
    root: state.root,
    scale: state.scale,
    density: state.density,
    swing: state.swing,
    effects: state.effects,
    [blockNameFor(state.generatorId)]: block,
  };

  return {
    title: state.title.trim() || undefined,
    parentSlug: state.parentSlug ?? undefined,
    pattern: { generatorId: state.generatorId, params },
  };
}
