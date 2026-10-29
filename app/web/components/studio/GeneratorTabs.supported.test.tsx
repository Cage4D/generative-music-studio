// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  GENERATORS,
  isGeneratorSupported,
  saveDisabledFor,
} from "@/lib/generators";
import type { GeneratorId } from "@gms/shared";
import { GeneratorTabs } from "./GeneratorTabs";

const COMING_SOON: GeneratorId[] = ["texture"];
const SUPPORTED: GeneratorId[] = ["arpeggio", "melody", "bassline", "drum-pattern", "ambient-pad"];

function tabFor(id: GeneratorId): HTMLElement {
  const generator = GENERATORS.find((entry) => entry.id === id);
  if (!generator) throw new Error(`unknown generator ${id}`);
  return screen.getByRole("tab", { name: new RegExp(generator.name, "i") });
}

describe("generator support", () => {
  it("does not mark the bassline tab as coming soon", () => {
    render(<GeneratorTabs activeId="bassline" onSelect={() => {}} />);

    const tab = tabFor("bassline");
    expect(tab.textContent).not.toMatch(/soon/i);
    expect(tab.querySelector(".soon")).toBeNull();
  });

  it("does not mark the drums tab as coming soon", () => {
    render(<GeneratorTabs activeId="drum-pattern" onSelect={() => {}} />);
    const tab = tabFor("drum-pattern");
    expect(tab.textContent).not.toMatch(/soon/i);
    expect(tab.querySelector(".soon")).toBeNull();
  });

  it("keeps the coming soon label on the generators that are not built yet", () => {
    for (const id of COMING_SOON) {
      const { unmount } = render(
        <GeneratorTabs activeId={id} onSelect={() => {}} />,
      );
      const tab = tabFor(id);
      expect(tab.textContent).toMatch(/soon/i);
      expect(tab.querySelector(".soon")).not.toBeNull();
      unmount();
    }
  });

  it("never marks a supported generator as coming soon", () => {
    for (const id of SUPPORTED) {
      const { unmount } = render(
        <GeneratorTabs activeId={id} onSelect={() => {}} />,
      );
      expect(tabFor(id).textContent).not.toMatch(/soon/i);
      unmount();
    }
  });

  it("enables saving for the bassline", () => {
    expect(isGeneratorSupported("bassline")).toBe(true);
    // A valid request and no save in flight: the button is live.
    expect(saveDisabledFor("bassline", true, false)).toBe(false);
  });

  it("enables saving for the drums", () => {
    expect(isGeneratorSupported("drum-pattern")).toBe(true);
    expect(saveDisabledFor("drum-pattern", true, false)).toBe(false);
  });

  it("keeps saving disabled for the generators that are coming soon", () => {
    for (const id of COMING_SOON) {
      expect(isGeneratorSupported(id)).toBe(false);
      expect(saveDisabledFor(id, true, false)).toBe(true);
    }
  });

  it("keeps saving disabled while a save is running or the request is invalid", () => {
    expect(saveDisabledFor("bassline", true, true)).toBe(true);
    expect(saveDisabledFor("bassline", false, false)).toBe(true);
    expect(saveDisabledFor("drum-pattern", true, true)).toBe(true);
    expect(saveDisabledFor("drum-pattern", false, false)).toBe(true);
  });
});

describe("ambient-pad tab behavior", () => {
  it("renders ambient-pad without soon label and allows saving while texture is still coming soon", () => {
    const { unmount: unmountPad } = render(<GeneratorTabs activeId="ambient-pad" onSelect={() => {}} />);
    const padTab = tabFor("ambient-pad");
    expect(padTab.textContent).not.toMatch(/soon/i);
    expect(padTab.querySelector(".soon")).toBeNull();
    expect(isGeneratorSupported("ambient-pad")).toBe(true);
    expect(saveDisabledFor("ambient-pad", true, false)).toBe(false);
    unmountPad();

    const { unmount: unmountTexture } = render(<GeneratorTabs activeId="texture" onSelect={() => {}} />);
    const texTab = tabFor("texture");
    expect(texTab.textContent).toMatch(/soon/i);
    expect(texTab.querySelector(".soon")).not.toBeNull();
    expect(isGeneratorSupported("texture")).toBe(false);
    expect(saveDisabledFor("texture", true, false)).toBe(true);
    unmountTexture();
  });
});
