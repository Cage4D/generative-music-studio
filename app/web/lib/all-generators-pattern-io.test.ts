import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CreatePatternSchema,
  type GeneratorId,
  type PatternResponse,
} from "@gms/shared";
import { generateArpeggio } from "../audio/generators/arpeggio";
import { generateBassline } from "../audio/generators/bassline";
import { drumEvents, generateDrums } from "../audio/generators/drums";
import { generateMelody } from "../audio/generators/melody";
import { generatePads } from "../audio/generators/pads";
import { generateTexture } from "../audio/generators/texture";
import {
  hashDrumEvents,
  hashEvents,
  hashPadEvents,
  hashTextureEvents,
} from "../audio/hash";
import type {
  ArpeggioParams,
  BasslineParams,
  DrumParams,
  MelodyParams,
  PadParams,
  TextureParams,
} from "../audio/types";
import { createPattern, getPattern } from "./api";
import { GENERATORS } from "./generators";
import { hydrateState } from "./pattern-io";
import { engineParamsFor } from "./preview";
import { buildRequest } from "./request";
import {
  createDefaultState,
  studioReducer,
  type StudioState,
} from "./studio-state";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function stateFor(generatorId: GeneratorId): StudioState {
  let state = createDefaultState();
  state = studioReducer(state, { type: "selectGenerator", generatorId });
  state = studioReducer(state, { type: "setSeed", value: 4242 });
  return state;
}

function eventHash(state: StudioState): string {
  const params = engineParamsFor(state);
  if (!params) throw new Error(`no engine params for ${state.generatorId}`);
  switch (state.generatorId) {
    case "arpeggio":
      return hashEvents(generateArpeggio(params as ArpeggioParams).events);
    case "melody":
      return hashEvents(generateMelody(params as MelodyParams).events);
    case "bassline":
      return hashEvents(generateBassline(params as BasslineParams).events);
    case "drum-pattern":
      return hashDrumEvents(drumEvents(generateDrums(params as DrumParams)));
    case "ambient-pad":
      return hashPadEvents(generatePads(params as PadParams).events);
    case "texture":
      return hashTextureEvents(generateTexture(params as TextureParams).events);
  }
}

describe("all six generators save then load", () => {
  it.each(GENERATORS.map((generator) => generator.id))(
    "keeps the %s event hash across a save and a load",
    async (generatorId) => {
      const state = stateFor(generatorId);
      const parsed = CreatePatternSchema.parse(buildRequest(state));
      const response: PatternResponse = {
        slug: `${generatorId}-slug`,
        title: null,
        pattern: parsed.pattern,
        playCount: 0,
        remixCount: 0,
        parentSlug: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      };

      fetchMock
        .mockResolvedValueOnce(json(response))
        .mockResolvedValueOnce(json(response));

      const created = await createPattern(parsed);
      expect(created.slug).toBe(`${generatorId}-slug`);
      const loaded = await getPattern(created.slug);
      expect(loaded.pattern).toEqual(parsed.pattern);

      const reloaded = hydrateState(
        createDefaultState(),
        loaded.pattern,
        loaded.parentSlug,
        "",
      );

      expect(reloaded.generatorId).toBe(generatorId);
      expect(reloaded.seed).toBe(state.seed);
      expect(eventHash(reloaded)).toBe(eventHash(state));
    },
  );
});
