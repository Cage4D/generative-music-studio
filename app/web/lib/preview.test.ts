import { describe, expect, it } from "vitest";
import { generateArpeggio } from "../audio/generators/arpeggio";
import { ARPEGGIO_STEPS, STEPS_PER_BAR } from "../audio/types";
import { arpeggioParams, buildPreview } from "./preview";
import { createDefaultState } from "./studio-state";

describe("arpeggio preview", () => {
  it("draws a 64 by 6 grid from the generated events", () => {
    const state = createDefaultState();
    const preview = buildPreview(state);
    expect(preview.kind).toBe("grid");
    if (preview.kind !== "grid") return;

    expect(preview.rows).toBe(6);
    expect(preview.columns).toBe(ARPEGGIO_STEPS);
    expect(preview.barEvery).toBe(STEPS_PER_BAR);
    expect(preview.cells).toHaveLength(ARPEGGIO_STEPS * 6);

    const { events } = generateArpeggio(arpeggioParams(state));
    const notes = events.filter((event) => event !== null);
    expect(preview.cells.filter(Boolean)).toHaveLength(notes.length);
  });

  it("puts the highest pitch above every other note", () => {
    const state = createDefaultState();
    const { events, range } = generateArpeggio(arpeggioParams(state));
    const notes = events.filter((event) => event !== null);
    const highest = notes.reduce((a, b) => (b.midi > a.midi ? b : a));

    const preview = buildPreview(state);
    expect(preview.kind).toBe("grid");
    if (preview.kind !== "grid") return;

    const rows = preview.rows;
    const rowOf = (midi: number) => {
      const normalized = (midi - range.min) / (range.max - range.min + 1);
      return rows - 1 - Math.min(rows - 1, Math.floor(normalized * rows));
    };

    const highestRow = rowOf(highest.midi);
    const topRow = preview.cells.slice(0, preview.columns);
    expect(topRow[highest.step]).toBe(true);
    for (const note of notes) {
      expect(highestRow).toBeLessThanOrEqual(rowOf(note.midi));
    }
  });
});
