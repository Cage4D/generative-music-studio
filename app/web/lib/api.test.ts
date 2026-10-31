import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreatePatternInput, PatternResponse } from "@gms/shared";
import {
  ApiError,
  apiBaseUrl,
  createPattern,
  describeApiError,
  getPattern,
  isRetryable,
  shareUrl,
} from "./api";

const input: CreatePatternInput = {
  pattern: {
    generatorId: "arpeggio",
    params: {
      seed: 1839204412,
      tempo: 96,
      root: "D",
      scale: "dorian",
      density: 0.6,
      swing: 0.1,
      effects: { reverb: 0.35, delay: 0.2 },
      arpeggio: { pattern: "up-down", octaves: 2, stepLength: "16n" },
    },
  },
};

const response: PatternResponse = {
  slug: "abc1234567",
  title: null,
  pattern: input.pattern,
  playCount: 0,
  remixCount: 0,
  parentSlug: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function capture(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected the request to fail");
}

describe("apiBaseUrl", () => {
  it("falls back to the local default", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    expect(apiBaseUrl()).toBe("http://localhost:4000");
  });

  it("trims trailing slashes", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.test/");
    expect(apiBaseUrl()).toBe("https://api.example.test");
  });

  it("prefers the internal API service binding on the server", () => {
    vi.stubEnv("API_URL", "http://api.internal:3000/");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "/api");
    expect(apiBaseUrl()).toBe("http://api.internal:3000");
  });

  it("uses the relative public API path in the browser", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "/api/");
    expect(apiBaseUrl()).toBe("/api");
  });

  it("defaults deployed browsers to the same-origin API path", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    vi.stubGlobal("window", { location: { hostname: "app.example.test" } });
    expect(apiBaseUrl()).toBe("/api");
  });

  it("ignores a localhost public API URL when deployed", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4000");
    vi.stubGlobal("window", { location: { hostname: "app.example.test" } });
    expect(apiBaseUrl()).toBe("/api");
  });
});

describe("shareUrl", () => {
  it("builds a track link", () => {
    expect(shareUrl("abc", "http://localhost:3000")).toBe(
      "http://localhost:3000/track/abc",
    );
  });
});

describe("createPattern", () => {
  it("posts the input and returns a validated response", async () => {
    fetchMock.mockResolvedValue(json(response));

    const result = await createPattern(input);

    expect(result).toEqual(response);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:4000/patterns");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(input);
  });

  it("rejects a malformed success body", async () => {
    fetchMock.mockResolvedValue(json({ slug: "abc" }));

    const error = await capture(createPattern(input));

    expect(error.kind).toBe("invalid");
  });
});

describe("getPattern", () => {
  it("encodes the slug", async () => {
    fetchMock.mockResolvedValue(json(response));

    await getPattern("a/b");

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:4000/patterns/a%2Fb");
  });
});

describe("error mapping", () => {
  it("maps 400 to validation with issues", async () => {
    fetchMock.mockResolvedValue(
      json(
        {
          statusCode: 400,
          error: "ValidationError",
          message: "Request validation failed",
          issues: [
            {
              path: "pattern.params.arpeggio.octaves",
              message: "Number must be less than or equal to 4",
            },
          ],
        },
        400,
      ),
    );

    const error = await capture(createPattern(input));

    expect(error.kind).toBe("validation");
    expect(error.issues).toEqual([
      {
        path: "pattern.params.arpeggio.octaves",
        message: "Number must be less than or equal to 4",
      },
    ]);
  });

  it("maps 404 to notFound", async () => {
    fetchMock.mockResolvedValue(
      json({ statusCode: 404, message: 'Pattern "x" not found' }, 404),
    );

    const error = await capture(getPattern("x"));

    expect(error.kind).toBe("notFound");
  });

  it("maps 429 to rateLimited and reads Retry-After", async () => {
    fetchMock.mockResolvedValue(
      json({ statusCode: 429, message: "Too many requests" }, 429, {
        "Retry-After": "7",
      }),
    );

    const error = await capture(createPattern(input));

    expect(error.kind).toBe("rateLimited");
    expect(error.retryAfter).toBe(7);
  });

  it("maps 5xx to server", async () => {
    fetchMock.mockResolvedValue(
      json({ statusCode: 503, message: "Unavailable" }, 503),
    );

    const error = await capture(getPattern("x"));

    expect(error.kind).toBe("server");
    expect(error.status).toBe(503);
  });

  it("maps a rejected fetch to network", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const error = await capture(
      getPattern("x", { retries: 0, retryBaseMs: 0 }),
    );

    expect(error.kind).toBe("network");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a network failure with backoff and can recover", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(json(response));

    const result = await getPattern("x", { retries: 2, retryBaseMs: 0 });

    expect(result).toEqual(response);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after the retry budget", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const error = await capture(
      getPattern("x", { retries: 2, retryBaseMs: 0 }),
    );

    expect(error.kind).toBe("network");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-network failures", async () => {
    fetchMock.mockResolvedValue(
      json({ statusCode: 500, message: "Boom" }, 500),
    );

    const error = await capture(
      createPattern(input, { retries: 2, retryBaseMs: 0 }),
    );

    expect(error.kind).toBe("server");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps an aborted request to timeout", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        }),
    );

    const error = await capture(getPattern("x", { timeoutMs: 5 }));

    expect(error.kind).toBe("timeout");
  });
});

describe("helpers", () => {
  it("describes validation and rate-limit errors", () => {
    expect(
      describeApiError(
        new ApiError("validation", "Request validation failed", {
          issues: [{ path: "title", message: "Too long" }],
        }),
      ),
    ).toBe("title: Too long");

    expect(
      describeApiError(
        new ApiError("rateLimited", "Too many requests.", { retryAfter: 3 }),
      ),
    ).toBe("Too many requests. Try again in 3 seconds.");
  });

  it("flags network, timeout and server errors as retryable", () => {
    expect(isRetryable(new ApiError("network", ""))).toBe(true);
    expect(isRetryable(new ApiError("timeout", ""))).toBe(true);
    expect(isRetryable(new ApiError("server", ""))).toBe(true);
    expect(isRetryable(new ApiError("validation", ""))).toBe(false);
    expect(isRetryable(new ApiError("notFound", ""))).toBe(false);
  });
});
