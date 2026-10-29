import { describe, expect, it } from "vitest";
import { generateTexture } from "../audio/generators/texture";
import { buildPreview, textureParams } from "./preview";
import { createDefaultState, studioReducer } from "./studio-state";

function textureState(seed = 1) {
  let state = createDefaultState();
  state = studioReducer(state, {
    type: "selectGenerator",
    generatorId: "texture",
  });
  state = studioReducer(state, { type: "setSeed", value: seed });
  return state;
}

describe("texture preview", () => {
  it("draws the real generated gestures on the shared grid", () => {
    const state = textureState();
    const preview = buildPreview(state);
    expect(preview.kind).toBe("grid");
    if (preview.kind !== "grid") return;

    const { events, totalSteps } = generateTexture(textureParams(state));
    expect(preview.rows).toBe(6);
    expect(preview.totalSteps).toBe(totalSteps);
    expect(preview.cells).toHaveLength(6 * totalSteps);
    expect(preview.cells.filter(Boolean)).toHaveLength(events.length);

    for (const note of preview.notes ?? []) {
      if (!note) continue;
      // The dot is capped small so the scatter never fills the cell.
      expect(note.duration).toBeLessThan(0.25);
      expect(note.velocity).toBeLessThanOrEqual(0.6);
    }
  });
});
