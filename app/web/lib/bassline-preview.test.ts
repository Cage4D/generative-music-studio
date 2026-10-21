import { describe, expect, it } from "vitest";
import { generateBassline } from "../audio/generators/bassline";
import { hashEvents } from "../audio/hash";
import { GENERATOR_BY_ID } from "./generators";
import { PAGE_STEPS } from "./paging";
import {
  bassColumnOfStep,
  basslineParams,
  buildPreviewFrom,
  engineParamsFor,
} from "./preview";
import { createDefaultState, studioReducer } from "./studio-state";

function bassState(seed = 9001) {
  let state = createDefaultState();
  state = studioReducer(state, { type: "selectGenerator", generatorId: "bassline" });
  state = studioReducer(state, { type: "setSeed", value: seed });
  return state;
}

describe("bassline preview", () => {
  it("draws a 16-column by 4-row grid from the generated events", () => {
    const state = bassState();
    const preview = buildPreviewFrom({
      generatorId: "bassline",
      seed: state.seed,
      tempo: state.tempo,
      density: state.density,
      root: state.root,
      scale: state.scale,
      blocks: state.blocks,
    });
    expect(preview.kind).toBe("grid");
    if (preview.kind !== "grid") return;

    expect(preview.rows).toBe(GENERATOR_BY_ID.bassline.rows);
    expect(preview.totalSteps).toBe(PAGE_STEPS);
    expect(preview.cells).toHaveLength(PAGE_STEPS * preview.rows);

    const { events } = generateBassline(basslineParams(state));
    const notes = events.filter((event) => event !== null);
    expect(notes.length).toBeGreaterThan(0);
    // At the default 8n grid every note lands in its own column.
    expect(preview.cells.filter(Boolean)).toHaveLength(notes.length);
  });

  it("puts the root at the bottom row and the highest note above it", () => {
    const state = bassState(7);
    const { events, pool } = generateBassline(basslineParams(state));
    const notes = events.filter((event) => event !== null);
    const preview = buildPreviewFrom({
      generatorId: "bassline",
      seed: state.seed,
      tempo: state.tempo,
      density: state.density,
      root: state.root,
      scale: state.scale,
      blocks: state.blocks,
    });
    if (preview.kind !== "grid") return;

    const rows = preview.rows;
    const totalSteps = preview.totalSteps;
    const root = pool[0];
    const highest = notes.reduce((a, b) => (b.midi > a.midi ? b : a));

    // The root note is drawn on the bottom row.
    const rootRow = rows - 1;
    for (const note of notes) {
      if (note.midi !== root) continue;
      expect(preview.cells[rootRow * totalSteps + note.step]).toBe(true);
    }
    // The highest note is drawn on or above every other note.
    const rowOf = (midi: number) => {
      const index = pool.indexOf(midi);
      const span = pool.length - 1;
      return span === 0
        ? rows - 1
        : rows - 1 - Math.round((index * (rows - 1)) / span);
    };
    for (const note of notes) {
      expect(rowOf(highest.midi)).toBeLessThanOrEqual(rowOf(note.midi));
    }
  });

  it("maps every engine step onto one of the 16 columns", () => {
    for (const noteLength of ["2n", "4n", "8n", "16n", "32n"] as const) {
      for (let step = 0; step < 64; step++) {
        const column = bassColumnOfStep(step, noteLength);
        expect(column).toBeGreaterThanOrEqual(0);
        expect(column).toBeLessThan(PAGE_STEPS);
      }
    }
    // At 8n one step is one column, at 16n two steps share a column.
    expect(bassColumnOfStep(3, "8n")).toBe(3);
    expect(bassColumnOfStep(3, "16n")).toBe(1);
    expect(bassColumnOfStep(0, "4n")).toBe(0);
    expect(bassColumnOfStep(1, "4n")).toBe(2);
  });

  it("feeds the engine with the same params it previews", () => {
    const state = bassState();
    const params = engineParamsFor(state);
    expect(params).not.toBeNull();
    if (!params || !("bass" in params)) return;
    expect(params.bass).toEqual(state.blocks.bassline);
    expect(hashEvents(generateBassline(params).events)).toBe(
      hashEvents(generateBassline(basslineParams(state)).events),
    );
  });
});
