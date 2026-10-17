import { describe, expect, it } from "vitest";
import { columnOf, PAGE_STEPS, pageCount, pageOf } from "./paging";

describe("pageCount", () => {
  it("rounds up to whole pages of 16", () => {
    expect(PAGE_STEPS).toBe(16);
    expect(pageCount(0)).toBe(1);
    expect(pageCount(1)).toBe(1);
    expect(pageCount(16)).toBe(1);
    expect(pageCount(17)).toBe(2);
    expect(pageCount(32)).toBe(2);
    expect(pageCount(64)).toBe(4);
  });
});

describe("pageOf over 64 steps", () => {
  it("maps every step 0..63 to its page", () => {
    for (let step = 0; step < 64; step++) {
      expect(pageOf(step, 64)).toBe(Math.floor(step / 16));
      expect(columnOf(step)).toBe(step % 16);
    }
    expect(pageOf(-1, 64)).toBe(0);
  });
});

describe("pageOf with a partial last page", () => {
  it("keeps the partial page index and clamps out-of-range steps", () => {
    const totalSteps = 20;
    expect(pageCount(totalSteps)).toBe(2);
    expect(pageOf(0, totalSteps)).toBe(0);
    expect(pageOf(15, totalSteps)).toBe(0);
    expect(pageOf(16, totalSteps)).toBe(1);
    expect(pageOf(19, totalSteps)).toBe(1);
    expect(pageOf(99, totalSteps)).toBe(1);
  });
});

describe("pageOf below 16 steps", () => {
  it("stays on a single page", () => {
    const totalSteps = 5;
    expect(pageCount(totalSteps)).toBe(1);
    for (let step = 0; step < totalSteps; step++) {
      expect(pageOf(step, totalSteps)).toBe(0);
      expect(columnOf(step)).toBe(step);
    }
    expect(pageOf(10, totalSteps)).toBe(0);
  });
});
