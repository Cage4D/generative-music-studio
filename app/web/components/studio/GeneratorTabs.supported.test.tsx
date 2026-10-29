// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GeneratorId } from "@gms/shared";
import {
  GENERATORS,
  isGeneratorSupported,
  saveDisabledFor,
} from "@/lib/generators";
import { GeneratorTabs } from "./GeneratorTabs";

describe("generator support", () => {
  it("renders every real tab without a soon badge", () => {
    render(<GeneratorTabs activeId="arpeggio" onSelect={() => {}} />);

    for (const generator of GENERATORS) {
      const tab = screen.getByRole("tab", { name: generator.name });
      expect(tab.textContent).not.toMatch(/soon/i);
      expect(tab.querySelector(".soon")).toBeNull();
      expect(isGeneratorSupported(generator.id)).toBe(true);
    }
  });

  it("keeps saving enabled for texture", () => {
    expect(isGeneratorSupported("texture")).toBe(true);
    // A valid request and no save in flight: the button is live.
    expect(saveDisabledFor("texture", true, false)).toBe(false);
  });

  it("keeps saving disabled while a save is running or the request is invalid", () => {
    for (const generator of GENERATORS) {
      expect(saveDisabledFor(generator.id, true, true)).toBe(true);
      expect(saveDisabledFor(generator.id, false, false)).toBe(true);
    }
  });

  it("keeps a future unknown generator disabled instead of crashing", () => {
    const future = "future-generator" as GeneratorId;
    expect(isGeneratorSupported(future)).toBe(false);
    expect(saveDisabledFor(future, true, false)).toBe(true);
  });
});
