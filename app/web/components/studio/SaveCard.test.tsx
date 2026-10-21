// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SaveCard } from "./SaveCard";

describe("SaveCard", () => {
  it("announces save status in a polite live region", () => {
    render(
      <SaveCard
        title=""
        parentSlug={null}
        status={<span>Saved.</span>}
        disabled={false}
        request={{}}
        onTitleChange={() => {}}
        onSave={() => {}}
      />,
    );

    const region = screen.getByRole("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.getAttribute("aria-atomic")).toBe("true");
    expect(region.textContent).toContain("Saved.");
  });

  it("associates the title label and disables save when asked", () => {
    render(
      <SaveCard
        title="Rain"
        parentSlug={null}
        status={null}
        disabled
        request={{}}
        onTitleChange={() => {}}
        onSave={() => {}}
      />,
    );

    const input = screen.getByLabelText(/Title \(optional\)/) as HTMLInputElement;
    expect(input.value).toBe("Rain");
    expect(input.id).toBe("title");
    const save = screen.getByRole("button", { name: "Save & get link" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });
});
