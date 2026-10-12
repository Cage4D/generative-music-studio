import { describe, expect, it } from "vitest";
import { CreatePatternSchema, GENERATOR_IDS, PatternSchema } from "@gms/shared";
import { buildRequest } from "./request";
import { createDefaultState, studioReducer } from "./studio-state";

describe("default state", () => {
  it.each(GENERATOR_IDS)(
    "parses with PatternSchema for %s",
    (generatorId) => {
      const request = buildRequest({ ...createDefaultState(), generatorId });
      expect(PatternSchema.safeParse(request.pattern).success).toBe(true);
      expect(CreatePatternSchema.safeParse(request).success).toBe(true);
    },
  );
});

describe("effects", () => {
  it("removes a key when its level is 0", () => {
    let state = createDefaultState();
    state = studioReducer(state, {
      type: "setEffect",
      key: "reverb",
      value: 0,
    });
    expect(state.effects).toEqual({ delay: 0.2 });

    state = studioReducer(state, {
      type: "setEffect",
      key: "delay",
      value: 0,
    });
    expect(state.effects).toEqual({});

    expect(PatternSchema.safeParse(buildRequest(state).pattern).success).toBe(
      true,
    );
  });
});

describe("drum steps", () => {
  it("is stored and sent as a number", () => {
    const state = { ...createDefaultState(), generatorId: "drum-pattern" as const };
    expect(typeof state.blocks["drum-pattern"].steps).toBe("number");

    const result = PatternSchema.safeParse(buildRequest(state).pattern);
    expect(result.success).toBe(true);
    if (result.success && result.data.generatorId === "drum-pattern") {
      expect(typeof result.data.params.drums.steps).toBe("number");
    }
  });
});

describe("generator blocks and shared params", () => {
  it("keeps each block across switches and carries shared params", () => {
    let state = createDefaultState();
    state = studioReducer(state, {
      type: "setBlockField",
      key: "octaves",
      value: 4,
    });
    state = studioReducer(state, {
      type: "selectGenerator",
      generatorId: "melody",
    });
    state = studioReducer(state, {
      type: "setShared",
      patch: { tempo: 140 },
    });
    state = studioReducer(state, {
      type: "selectGenerator",
      generatorId: "arpeggio",
    });

    expect(state.blocks.arpeggio.octaves).toBe(4);
    expect(state.tempo).toBe(140);
    expect(state.blocks.melody).toBeDefined();
  });
});

describe("seed", () => {
  it("clamps to a uint32", () => {
    const base = createDefaultState();
    expect(studioReducer(base, { type: "setSeed", value: -1 }).seed).toBe(0);
    expect(studioReducer(base, { type: "setSeed", value: 1e12 }).seed).toBe(
      4294967295,
    );
    expect(studioReducer(base, { type: "setSeed", value: 12.9 }).seed).toBe(12);
  });
});
