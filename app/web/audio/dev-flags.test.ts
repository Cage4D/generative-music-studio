import { describe, expect, it } from "vitest";
import { parseRemovedFx } from "./dev-flags";

describe("parseRemovedFx", () => {
  it("returns nothing for an absent flag", () => {
    expect(parseRemovedFx(null)).toEqual({ fxOff: false, removedFx: [] });
    expect(parseRemovedFx("")).toEqual({ fxOff: false, removedFx: [] });
  });

  it("treats off as removing everything", () => {
    expect(parseRemovedFx("off")).toEqual({ fxOff: true, removedFx: [] });
  });

  it("parses a single effect name", () => {
    expect(parseRemovedFx("reverb")).toEqual({
      fxOff: false,
      removedFx: ["reverb"],
    });
  });

  it("parses a comma-separated list", () => {
    expect(parseRemovedFx("reverb,delay")).toEqual({
      fxOff: false,
      removedFx: ["reverb", "delay"],
    });
    expect(parseRemovedFx(" reverb , delay , ")).toEqual({
      fxOff: false,
      removedFx: ["reverb", "delay"],
    });
  });

  it("ignores unknown names", () => {
    expect(parseRemovedFx("reverb,nope,delay")).toEqual({
      fxOff: false,
      removedFx: ["reverb", "delay"],
    });
  });
});
