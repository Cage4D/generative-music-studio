import {
  DEFAULT_CORS_ORIGINS,
  DEFAULT_PORT,
  DEFAULT_RATE_LIMIT_MAX,
  DEFAULT_TRUST_PROXY,
  parseCorsOrigins,
  parsePort,
  parseRateLimitMax,
  parseRateLimitWindowMs,
  parseTrustProxy,
} from "./config.js";

describe("config", () => {
  describe("parsePort", () => {
    it("uses the default when unset or invalid", () => {
      expect(parsePort(undefined)).toBe(DEFAULT_PORT);
      expect(parsePort("")).toBe(DEFAULT_PORT);
      expect(parsePort("not-a-port")).toBe(DEFAULT_PORT);
      expect(parsePort("0")).toBe(DEFAULT_PORT);
      expect(parsePort("70000")).toBe(DEFAULT_PORT);
    });

    it("reads the port from the environment", () => {
      expect(parsePort("4000")).toBe(4000);
      expect(parsePort("8080")).toBe(8080);
    });
  });

  describe("parseCorsOrigins", () => {
    it("defaults to the local dev origin", () => {
      expect(parseCorsOrigins(undefined, false)).toEqual([
        DEFAULT_CORS_ORIGINS,
      ]);
    });

    it("splits a comma separated list", () => {
      expect(
        parseCorsOrigins("https://a.example.com, https://b.example.com", false),
      ).toEqual(["https://a.example.com", "https://b.example.com"]);
    });

    it("allows a wildcard outside production", () => {
      expect(parseCorsOrigins("*", false)).toEqual(["*"]);
    });

    it("rejects a wildcard in production", () => {
      expect(() => parseCorsOrigins("*", true)).toThrow(/production/);
    });
  });

  describe("parseTrustProxy", () => {
    it("trusts a single proxy hop by default", () => {
      expect(parseTrustProxy(undefined)).toBe(DEFAULT_TRUST_PROXY);
      expect(parseTrustProxy("")).toBe(DEFAULT_TRUST_PROXY);
      expect(parseTrustProxy("nonsense")).toBe(DEFAULT_TRUST_PROXY);
    });

    it("accepts hop counts and booleans", () => {
      expect(parseTrustProxy("2")).toBe(2);
      expect(parseTrustProxy("true")).toBe(true);
      expect(parseTrustProxy("false")).toBe(false);
    });
  });

  describe("rate limit settings", () => {
    it("falls back to the defaults", () => {
      expect(parseRateLimitMax(undefined)).toBe(DEFAULT_RATE_LIMIT_MAX);
      expect(parseRateLimitWindowMs(undefined)).toBe(60_000);
    });

    it("reads explicit values, including 0 to disable", () => {
      expect(parseRateLimitMax("0")).toBe(0);
      expect(parseRateLimitMax("10")).toBe(10);
      expect(parseRateLimitWindowMs("1000")).toBe(1000);
    });
  });
});
