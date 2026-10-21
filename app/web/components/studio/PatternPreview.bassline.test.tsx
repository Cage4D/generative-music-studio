// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GENERATOR_BY_ID } from "@/lib/generators";
import { buildPreview } from "@/lib/preview";
import { createDefaultState } from "@/lib/studio-state";
import type { GeneratorId } from "@gms/shared";
import { PatternPreview } from "./PatternPreview";

function gridOf(generatorId: GeneratorId) {
  const state = { ...createDefaultState(), generatorId };
  const preview = buildPreview(state);
  if (preview.kind !== "grid") throw new Error("expected a grid preview");
  const { container } = render(<PatternPreview preview={preview} />);
  const grid = container.querySelector(".g") as HTMLElement;
  const cells = Array.from(grid.querySelectorAll("i"));
  return { preview, grid, cells };
}

/** The cell size part of the row template, without the row count. */
function cellSizeToken(grid: HTMLElement): string {
  return grid.style.gridTemplateRows.replace(/repeat\(\d+,/, "repeat(N,");
}

describe("bassline preview cells", () => {
  it("uses the same cell size token as the melody preview", () => {
    const bass = gridOf("bassline");
    const melody = gridOf("melody");

    expect(bass.grid.style.gridTemplateRows).toContain("var(--cell)");
    expect(cellSizeToken(bass.grid)).toBe(cellSizeToken(melody.grid));
    // Same 16 column layout.
    expect(bass.grid.style.gridTemplateColumns).toBe(
      melody.grid.style.gridTemplateColumns,
    );
  });

  it("uses the same cell classes as the melody preview", () => {
    const bass = gridOf("bassline");
    const melody = gridOf("melody");

    const vocabulary = (cells: HTMLElement[]) =>
      new Set(cells.flatMap((cell) => cell.className.split(" ")));

    const bassClasses = vocabulary(bass.cells);
    const melodyClasses = vocabulary(melody.cells);
    for (const name of bassClasses) expect(melodyClasses.has(name)).toBe(true);
    for (const name of melodyClasses) expect(bassClasses.has(name)).toBe(true);
    expect(bassClasses.has("on")).toBe(true);
  });

  it("keeps the pitch in a small fixed number of rows relative to the root", () => {
    const { preview, cells } = gridOf("bassline");

    expect(preview.rows).toBe(GENERATOR_BY_ID.bassline.rows);
    expect(preview.rows).toBeLessThanOrEqual(4);

    // Every note is drawn, and the rows they use are the bottom ones.
    const usedRows = new Set<number>();
    cells.forEach((cell, index) => {
      if (!cell.className.includes("on")) return;
      const row = Math.floor(index / 16);
      usedRows.add(row);
    });
    expect(usedRows.size).toBeGreaterThan(0);
    expect(Math.min(...usedRows)).toBeGreaterThanOrEqual(preview.rows - 4);
    expect(Math.max(...usedRows)).toBe(preview.rows - 1);
  });

  it("scales the note with the duration and the velocity, and caps the width", () => {
    const { cells } = gridOf("bassline");

    const notes = cells.filter((cell) => cell.className.includes("on"));
    expect(notes.length).toBeGreaterThan(0);

    const widths = new Set<string>();
    for (const note of notes) {
      const width = Number(note.style.width.replace("%", ""));
      const height = Number(note.style.height.replace("%", ""));
      // The note never grows past its cell, and never shrinks away.
      expect(width).toBeGreaterThan(0);
      expect(width).toBeLessThanOrEqual(100);
      expect(height).toBeGreaterThan(0);
      expect(height).toBeLessThanOrEqual(100);
      widths.add(note.style.width);
    }
    // The duration is visible in the note width.
    expect(widths.size).toBeGreaterThan(1);
  });

  it("leaves the melody notes at the full cell size", () => {
    const { cells } = gridOf("melody");

    for (const note of cells.filter((cell) => cell.className.includes("on"))) {
      expect(note.style.width).toBe("");
      expect(note.style.height).toBe("");
    }
  });
});
