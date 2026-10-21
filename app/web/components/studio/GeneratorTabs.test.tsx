// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GENERATORS } from "@/lib/generators";
import { GeneratorTabs } from "./GeneratorTabs";

describe("GeneratorTabs", () => {
  it("renders one tab per generator and marks the active one", () => {
    render(<GeneratorTabs activeId="arpeggio" onSelect={() => {}} />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(GENERATORS.length);

    const active = screen.getByRole("tab", { name: /Arpeggio/ });
    expect(active.getAttribute("aria-selected")).toBe("true");
    expect(active.tabIndex).toBe(0);
    expect(active.getAttribute("aria-controls")).toBe("generator-panel");

    const other = screen.getByRole("tab", { name: /Melody/ });
    expect(other.getAttribute("aria-selected")).toBe("false");
    expect(other.tabIndex).toBe(-1);
  });

  it("labels the tablist", () => {
    render(<GeneratorTabs activeId="arpeggio" onSelect={() => {}} />);
    expect(screen.getByRole("tablist", { name: "Generators" })).toBeTruthy();
  });

  it("moves to the next tab on ArrowRight", () => {
    const onSelect = vi.fn();
    render(<GeneratorTabs activeId="arpeggio" onSelect={onSelect} />);

    fireEvent.keyDown(screen.getByRole("tab", { name: /Arpeggio/ }), {
      key: "ArrowRight",
    });

    expect(onSelect).toHaveBeenCalledWith("ambient-pad");
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: /Ambient pad/ }),
    );
  });

  it("wraps backwards from the first tab on ArrowLeft", () => {
    const onSelect = vi.fn();
    render(<GeneratorTabs activeId="arpeggio" onSelect={onSelect} />);

    fireEvent.keyDown(screen.getByRole("tab", { name: /Arpeggio/ }), {
      key: "ArrowLeft",
    });

    expect(onSelect).toHaveBeenCalledWith(GENERATORS[GENERATORS.length - 1].id);
  });

  it("jumps to the first and last tabs with Home and End", () => {
    const onSelect = vi.fn();
    render(<GeneratorTabs activeId="melody" onSelect={onSelect} />);

    const active = screen.getByRole("tab", { name: /Melody/ });
    fireEvent.keyDown(active, { key: "Home" });
    expect(onSelect).toHaveBeenLastCalledWith(GENERATORS[0].id);

    fireEvent.keyDown(active, { key: "End" });
    expect(onSelect).toHaveBeenLastCalledWith(GENERATORS[GENERATORS.length - 1].id);
  });
});
