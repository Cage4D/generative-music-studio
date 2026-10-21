// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createDefaultState } from "@/lib/studio-state";
import { ParamsPanel } from "./ParamsPanel";

describe("ParamsPanel", () => {
  it("associates a label with every slider and reports a human value", () => {
    const state = createDefaultState();
    render(
      <ParamsPanel
        state={state}
        onSharedChange={() => {}}
        onBlockChange={() => {}}
        onEffectChange={() => {}}
      />,
    );

    const density = screen.getByLabelText("Density");
    expect(density.getAttribute("aria-valuetext")).toBe(
      `${Math.round(state.density * 100)} percent`,
    );

    const tempo = screen.getByLabelText("Tempo");
    expect(tempo.getAttribute("aria-valuetext")).toBe(`${state.tempo} BPM`);
  });

  it("passes through named units for generator sliders", () => {
    render(
      <ParamsPanel
        state={{ ...createDefaultState(), generatorId: "arpeggio" }}
        onSharedChange={() => {}}
        onBlockChange={() => {}}
        onEffectChange={() => {}}
      />,
    );

    const octaves = screen.getByLabelText("Octaves");
    expect(octaves.getAttribute("aria-valuetext")).toBe("2 octaves");
  });

  it("associates select labels with their controls", () => {
    render(
      <ParamsPanel
        state={createDefaultState()}
        onSharedChange={() => {}}
        onBlockChange={() => {}}
        onEffectChange={() => {}}
      />,
    );

    expect(screen.getByLabelText("Root").tagName).toBe("SELECT");
    expect(screen.getByLabelText("Scale").tagName).toBe("SELECT");
    expect(screen.getByLabelText("Pattern").tagName).toBe("SELECT");
  });
});
