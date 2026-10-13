import { describe, expect, it } from "vitest";
import { effectAmount, FILTER_MAX_HZ, FILTER_MIN_HZ, filterCutoff } from "./effects";

describe("effectAmount", () => {
  it("treats a missing effect as off", () => {
    expect(effectAmount({}, "reverb")).toBe(0);
    expect(effectAmount({ reverb: 0.4 }, "reverb")).toBe(0.4);
  });
});

describe("filterCutoff", () => {
  it("is wide open at level 0 and closed near level 1", () => {
    expect(filterCutoff(0)).toBe(FILTER_MAX_HZ);
    expect(filterCutoff(1)).toBeCloseTo(FILTER_MIN_HZ, 6);
  });

  it("falls as the level rises and clamps out-of-range input", () => {
    expect(filterCutoff(0.5)).toBeLessThan(filterCutoff(0));
    expect(filterCutoff(0.5)).toBeGreaterThan(filterCutoff(1));
    expect(filterCutoff(-1)).toBe(FILTER_MAX_HZ);
    expect(filterCutoff(2)).toBeCloseTo(FILTER_MIN_HZ, 6);
  });
});
