// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { pageCount } from "@/lib/paging";
import { buildPreview } from "@/lib/preview";
import { createDefaultState } from "@/lib/studio-state";
import { PatternPreview } from "./PatternPreview";

describe("PatternPreview", () => {
  it("exposes the preview as an image with a text alternative", () => {
    render(
      <PatternPreview
        preview={buildPreview(createDefaultState())}
        alt="Arpeggio pattern, seed 1234"
      />,
    );

    expect(
      screen.getByRole("img", { name: "Arpeggio pattern, seed 1234" }),
    ).toBeTruthy();
  });

  it("labels page controls and marks the active page", () => {
    const state = { ...createDefaultState(), generatorId: "melody" as const };
    const preview = buildPreview(state);
    if (preview.kind !== "grid") throw new Error("expected a grid preview");
    const pages = pageCount(preview.totalSteps);
    expect(pages).toBeGreaterThan(1);

    render(
      <PatternPreview preview={preview} page={1} onSelectPage={() => {}} />,
    );

    expect(
      screen
        .getByRole("button", { name: `Show page 2 of ${pages}` })
        .getAttribute("aria-current"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: `Show page 1 of ${pages}` })
        .getAttribute("aria-current"),
    ).toBeNull();
  });
});
