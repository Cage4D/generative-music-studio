import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreatePatternSchema, type PatternResponse } from "@gms/shared";
import { generateDrums, drumEvents } from "../audio/generators/drums";
import { hashDrumEvents } from "../audio/hash";
import { createPattern, getPattern } from "./api";
import { hydrateState } from "./pattern-io";
import { drumParams } from "./preview";
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

function drumState(seed = 4242) {
  let state = createDefaultState();
  state = studioReducer(state, {
    type: "selectGenerator",
    generatorId: "drum-pattern",
  });
  state = studioReducer(state, { type: "setSeed", value: seed });
  state = studioReducer(state, {
    type: "setBlockField",
    key: "style",
    value: "breakbeat",
  });
  state = studioReducer(state, {
    type: "setBlockField",
    key: "kit",
    value: "lofi",
  });
  state = studioReducer(state, {
    type: "setBlockField",
    key: "steps",
    value: 16,
  });
  return state;
}

describe("drums save then load", () => {
  it("keeps the drum event hash across a save and a load", async () => {
    const state = drumState();
    const request = buildRequest(state);
    const parsed = CreatePatternSchema.parse(request);
    const response: PatternResponse = {
      slug: "drums123456",
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
    expect(created.slug).toBe("drums123456");
    const loaded = await getPattern(created.slug);
    expect(loaded.pattern).toEqual(parsed.pattern);

    const reloaded = hydrateState(
      createDefaultState(),
      loaded.pattern,
      loaded.parentSlug,
      "",
    );

    expect(reloaded.generatorId).toBe("drum-pattern");
    expect(reloaded.seed).toBe(state.seed);
    expect(reloaded.blocks["drum-pattern"].kit).toBe("lofi");
    expect(hashDrumEvents(drumEvents(generateDrums(drumParams(reloaded))))).toBe(
      hashDrumEvents(drumEvents(generateDrums(drumParams(state))))
    );
  });

  it("sends the drums block to the api", async () => {
    const state = drumState();
    const parsed = CreatePatternSchema.parse(buildRequest(state));
    fetchMock.mockResolvedValueOnce(
      json({
        slug: "drums123456",
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
    expect(body.pattern.generatorId).toBe("drum-pattern");
    expect(body.pattern.params.drums).toEqual(state.blocks["drum-pattern"]);
  });
});
