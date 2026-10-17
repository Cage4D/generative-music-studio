import { describe, expect, it } from "vitest";
import { CreatePatternSchema, PatternResponseSchema } from "@gms/shared";
import { generateArpeggio } from "../audio/generators/arpeggio";
import { generateMelody } from "../audio/generators/melody";
import { hashEvents } from "../audio/hash";
import { hydrateState } from "./pattern-io";
import { arpeggioParams, melodyParams } from "./preview";
import { buildRequest } from "./request";
import { createDefaultState, studioReducer } from "./studio-state";

function roundTrip(
  state: ReturnType<typeof createDefaultState>,
  parentSlug: string | null = null,
) {
  const response = {
    slug: "abc1234567",
    title: null,
    pattern: CreatePatternSchema.parse(buildRequest(state)).pattern,
    playCount: 0,
    remixCount: 0,
    parentSlug,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const parsed = PatternResponseSchema.parse(response);
  return hydrateState(createDefaultState(), parsed.pattern, parsed.parentSlug, "");
}

describe("save then load", () => {
  it("preserves the default arpeggio event hash", () => {
    const state = createDefaultState();
    const reloaded = roundTrip(state);

    expect(hashEvents(generateArpeggio(arpeggioParams(state)).events)).toBe(
      "4745c8c9",
    );
    expect(hashEvents(generateArpeggio(arpeggioParams(reloaded)).events)).toBe(
      "4745c8c9",
    );
  });

  it("preserves a non-default melody across save and load", () => {
    let state = createDefaultState();
    state = studioReducer(state, {
      type: "selectGenerator",
      generatorId: "melody",
    });
    state = studioReducer(state, { type: "setSeed", value: 9001 });
    state = studioReducer(state, {
      type: "setBlockField",
      key: "contour",
      value: "wave",
    });

    const reloaded = roundTrip(state);

    expect(reloaded.generatorId).toBe("melody");
    expect(reloaded.seed).toBe(9001);
    expect(reloaded.blocks.melody.contour).toBe("wave");
    expect(hashEvents(generateMelody(melodyParams(reloaded)).events)).toBe(
      hashEvents(generateMelody(melodyParams(state)).events),
    );
  });

  it("carries the stored title", () => {
    const state = createDefaultState();
    const parsed = CreatePatternSchema.parse({
      ...buildRequest(state),
      title: "Night drive",
    });
    const reloaded = hydrateState(
      createDefaultState(),
      parsed.pattern,
      null,
      parsed.title ?? "",
    );
    expect(reloaded.title).toBe("Night drive");
  });
});

describe("remix", () => {
  it("sets parentSlug to the source and keeps its params", () => {
    const state = createDefaultState();
    const reloaded = roundTrip(state, "sourceslug");

    expect(reloaded.parentSlug).toBe("sourceslug");
    expect(buildRequest(reloaded).parentSlug).toBe("sourceslug");
    expect(reloaded.seed).toBe(state.seed);
    expect(reloaded.blocks.arpeggio).toEqual(state.blocks.arpeggio);
  });

  it("clears any title when remixing", () => {
    const state = createDefaultState();
    const response = CreatePatternSchema.parse(buildRequest(state));
    const reloaded = hydrateState(
      createDefaultState(),
      response.pattern,
      "sourceslug",
      "",
    );
    expect(reloaded.title).toBe("");
  });
});
