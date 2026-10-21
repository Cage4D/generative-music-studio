import { HttpException, type ExecutionContext } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RateLimitGuard } from "./rate-limit.guard.js";

type FakeContext = {
  context: ExecutionContext;
  headers: Record<string, string>;
};

function contextFor(ip: string, path = "/patterns"): FakeContext {
  const headers: Record<string, string> = {};
  const request = { ip, path, socket: { remoteAddress: ip } };
  const response = {
    setHeader(key: string, value: string) {
      headers[key] = value;
    },
  };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  };
  return { context: context as unknown as ExecutionContext, headers };
}

describe("RateLimitGuard", () => {
  const originalMax = process.env.RATE_LIMIT_MAX;
  const originalWindow = process.env.RATE_LIMIT_WINDOW_MS;

  beforeEach(() => {
    process.env.RATE_LIMIT_MAX = "2";
    process.env.RATE_LIMIT_WINDOW_MS = "60000";
  });

  afterEach(() => {
    if (originalMax === undefined) delete process.env.RATE_LIMIT_MAX;
    else process.env.RATE_LIMIT_MAX = originalMax;
    if (originalWindow === undefined) delete process.env.RATE_LIMIT_WINDOW_MS;
    else process.env.RATE_LIMIT_WINDOW_MS = originalWindow;
  });

  it("allows requests up to the limit and then returns 429", () => {
    const guard = new RateLimitGuard();
    const { context, headers } = contextFor("203.0.113.10");

    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow(HttpException);
    expect(headers["Retry-After"]).toBeDefined();
    expect(headers["X-RateLimit-Limit"]).toBe("2");
  });

  it("keeps separate buckets per client IP", () => {
    const guard = new RateLimitGuard();
    const first = contextFor("203.0.113.11");
    const second = contextFor("203.0.113.12");

    expect(guard.canActivate(first.context)).toBe(true);
    expect(guard.canActivate(first.context)).toBe(true);
    expect(guard.canActivate(second.context)).toBe(true);
  });

  it("never limits the health endpoint", () => {
    process.env.RATE_LIMIT_MAX = "1";
    const guard = new RateLimitGuard();
    const { context } = contextFor("203.0.113.13", "/health");

    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);
  });

  it("can be disabled with a limit of 0", () => {
    process.env.RATE_LIMIT_MAX = "0";
    const guard = new RateLimitGuard();
    const { context } = contextFor("203.0.113.14");

    for (let i = 0; i < 5; i += 1) {
      expect(guard.canActivate(context)).toBe(true);
    }
  });
});
