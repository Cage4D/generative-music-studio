/**
 * Environment parsing for the API. Everything the service needs to run in
 * production is read from the environment here so the rules stay testable and
 * in one place.
 */

export const DEFAULT_PORT = 3000;
export const DEFAULT_CORS_ORIGINS = "http://localhost:3000";
export const DEFAULT_TRUST_PROXY = 1;
export const DEFAULT_RATE_LIMIT_MAX = 120;
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

export function parsePort(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    return DEFAULT_PORT;
  }
  return parsed;
}

/**
 * Comma separated list of allowed browser origins. There is deliberately no
 * wildcard: a wildcard in production would allow any site to call the API.
 */
export function parseCorsOrigins(
  raw: string | undefined,
  isProduction = process.env.NODE_ENV === "production",
): string[] {
  const value = raw?.trim() ? raw : DEFAULT_CORS_ORIGINS;
  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) return [DEFAULT_CORS_ORIGINS];
  if (isProduction && origins.includes("*")) {
    throw new Error(
      'CORS_ORIGINS must not contain "*" in production. List explicit origins, e.g. "https://studio.example.com".',
    );
  }
  return origins;
}

/**
 * Number of proxy hops to trust for the client IP. Render/Vercel sit in front
 * of the service, so the limiter needs the forwarded client IP rather than the
 * proxy's own address.
 */
export function parseTrustProxy(raw: string | undefined): boolean | number {
  const value = raw?.trim();
  if (!value) return DEFAULT_TRUST_PROXY;
  if (value === "true") return true;
  if (value === "false") return false;
  const hops = Number.parseInt(value, 10);
  if (!Number.isFinite(hops) || hops < 0) return DEFAULT_TRUST_PROXY;
  return hops;
}

export function parseRateLimitMax(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_RATE_LIMIT_MAX;
  return parsed;
}

export function parseRateLimitWindowMs(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RATE_LIMIT_WINDOW_MS;
  return parsed;
}
