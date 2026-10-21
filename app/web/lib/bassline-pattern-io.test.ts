import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreatePatternSchema, type PatternResponse } from "@gms/shared";
import { generateBassline } from "../audio/generators/bassline";
import { hashEvents } from "../audio/hash";
import { createPattern, getPattern } from "./api";
import { hydrateState } from "./pattern-io";
import { basslineParams } from "./preview";
import { buildRequest } from "./request";
import { createDefaultState, studioReducer } from "./studio-state";

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

function bassState(seed = 4242) {
  let state = createDefaultState();
  state = studioReducer(state, {
    type: "selectGenerator",
    generatorId: "bassline",
  });
  state = studioReducer(state, { type: "setSeed", value: seed });
  state = studioReducer(state, {
    type: "setBlockField",
    key: "style",
    value: "syncopated",
  });
  state = studioReducer(state, {
    type: "setBlockField",
    key: "octave",
    value: 1,
  });
  return state;
}

describe("bassline save then load", () => {
  it("keeps the bassline event hash across a save and a load", async () => {
    const state = bassState();
    const request = buildRequest(state);
    const parsed = CreatePatternSchema.parse(request);
    const response: PatternResponse = {
      slug: "bass123456",
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
    expect(created.slug).toBe("bass123456");
    const loaded = await getPattern(created.slug);
    expect(loaded.pattern).toEqual(parsed.pattern);

    const reloaded = hydrateState(
      createDefaultState(),
      loaded.pattern,
      loaded.parentSlug,
      "",
    );

    expect(reloaded.generatorId).toBe("bassline");
    expect(reloaded.seed).toBe(state.seed);
    expect(reloaded.blocks.bassline.style).toBe("syncopated");
    expect(reloaded.blocks.bassline.octave).toBe(1);
    expect(hashEvents(generateBassline(basslineParams(reloaded)).events)).toBe(
      hashEvents(generateBassline(basslineParams(state)).events),
    );
  });

  it("sends the bassline block to the api", async () => {
    const state = bassState();
    const parsed = CreatePatternSchema.parse(buildRequest(state));
    fetchMock.mockResolvedValueOnce(
      json({
        slug: "bass123456",
        title: null,
        pattern: parsed.pattern,
        playCount: 0,
        remixCount: 0,
        parentSlug: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      } satisfies PatternResponse),
    );

    await createPattern(parsed);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/patterns");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as {
      pattern: { generatorId: string; params: Record<string, unknown> };
    };
    expect(body.pattern.generatorId).toBe("bassline");
    expect(body.pattern.params.bass).toEqual(state.blocks.bassline);
  });
});
