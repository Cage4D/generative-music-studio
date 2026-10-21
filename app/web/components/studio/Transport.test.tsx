// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Transport } from "./Transport";

describe("Transport", () => {
  it("reflects playback state on the play button", () => {
    const { rerender } = render(
      <Transport
        seed={1}
        playing={false}
        seedCopied={false}
        onTogglePlay={() => {}}
        onSeedChange={() => {}}
        onShuffle={() => {}}
        onCopySeed={() => {}}
      />,
    );

    const play = screen.getByRole("button", { name: "Play" });
    expect(play.getAttribute("aria-pressed")).toBe("false");
    expect(play.querySelector("span")?.getAttribute("aria-hidden")).toBe("true");

    rerender(
      <Transport
        seed={1}
        playing
        seedCopied={false}
        onTogglePlay={() => {}}
        onSeedChange={() => {}}
        onShuffle={() => {}}
        onCopySeed={() => {}}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Stop" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("labels the seed field and announces a copied seed", () => {
    render(
      <Transport
        seed={42}
        playing={false}
        seedCopied
        onTogglePlay={() => {}}
        onSeedChange={() => {}}
        onShuffle={() => {}}
        onCopySeed={() => {}}
      />,
    );

    expect((screen.getByLabelText("Seed") as HTMLInputElement).value).toBe("42");
    expect(screen.getByText("Seed copied to clipboard")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy seed" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Shuffle seed" })).toBeTruthy();
  });
});
