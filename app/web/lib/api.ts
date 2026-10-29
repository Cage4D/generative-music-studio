import {
  ApiErrorResponseSchema,
  PatternResponseSchema,
  type CreatePatternInput,
  type PatternResponse,
} from "@gms/shared";

export type ApiErrorKind =
  | "validation"
  | "notFound"
  | "rateLimited"
  | "network"
  | "server"
  | "timeout"
  | "invalid";

export type ValidationIssue = { path: string; message: string };

type ApiErrorOptions = {
  status?: number;
  issues?: ValidationIssue[];
  retryAfter?: number;
  cause?: unknown;
};

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly issues?: ValidationIssue[];
  readonly retryAfter?: number;

  constructor(kind: ApiErrorKind, message: string, options: ApiErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "ApiError";
    this.kind = kind;
    this.status = options.status;
    this.issues = options.issues;
    this.retryAfter = options.retryAfter;
  }
}

export const DEFAULT_API_URL = "http://localhost:4000";
export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_RETRIES = 2;
export const RETRY_BASE_MS = 500;

function trimBase(value: string): string {
  return value.replace(/\/+$/, "");
}

export function apiBaseUrl(): string {
  const internal = process.env.API_URL;
  if (typeof window === "undefined" && internal && internal.trim()) {
    return trimBase(internal.trim());
  }

  const publicUrl = process.env.NEXT_PUBLIC_API_URL;
  const base = publicUrl && publicUrl.trim() ? publicUrl.trim() : DEFAULT_API_URL;
  return trimBase(base);
}

export function shareUrl(slug: string, origin: string): string {
  return `${origin.replace(/\/+$/, "")}/track/${slug}`;
}

type RequestOptions = {
  timeoutMs?: number;
  retries?: number;
  retryBaseMs?: number;
};

function sleep(ms: number): Promise<void> {
  return ms > 0
    ? new Promise((resolve) => setTimeout(resolve, ms))
    : Promise.resolve();
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function parseRetryAfter(response: Response): number | undefined {
  const header = response.headers.get("Retry-After");
  if (!header) return undefined;
  const seconds = Number.parseInt(header, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function messageFrom(error: unknown, fallback: string): string {
  const parsed = ApiErrorResponseSchema.safeParse(error);
  if (!parsed.success) return fallback;
  const { message } = parsed.data;
  if (typeof message === "string" && message.trim()) return message;
  if (Array.isArray(message) && message.length) return message.join(", ");
  return fallback;
}

function errorFromResponse(response: Response, body: unknown): ApiError {
  const status = response.status;
  const parsed = ApiErrorResponseSchema.safeParse(body);
  const issues = parsed.success ? parsed.data.issues : undefined;

  if (status === 400) {
    return new ApiError("validation", messageFrom(body, "That request was rejected."), {
      status,
      issues,
    });
  }
  if (status === 404) {
    return new ApiError("notFound", messageFrom(body, "Not found."), { status });
  }
  if (status === 429) {
    return new ApiError("rateLimited", messageFrom(body, "Too many requests."), {
      status,
      retryAfter: parseRetryAfter(response),
    });
  }
  return new ApiError("server", messageFrom(body, "The server had a problem."), {
    status,
  });
}

function invalidResponse(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  return new ApiError("invalid", "The server sent an unexpected response.", {
    issues: error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  });
}

async function attempt(
  path: string,
  init: RequestInit,
  timeoutMs: number | undefined,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      cache: "no-store",
      headers: { Accept: "application/json", ...init.headers },
      signal: controller.signal,
    });
  } catch (cause) {
    if ((cause as { name?: string } | null)?.name === "AbortError") {
      throw new ApiError("timeout", "The request took too long.", { cause });
    }
    throw new ApiError("network", "Couldn't reach the server.", { cause });
  } finally {
    clearTimeout(timer);
  }

  const body = await readJson(response);
  if (!response.ok) throw errorFromResponse(response, body);
  return body;
}

async function request(
  path: string,
  init: RequestInit,
  options: RequestOptions,
): Promise<unknown> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const retryBaseMs = options.retryBaseMs ?? RETRY_BASE_MS;

  for (let count = 0; ; count += 1) {
    try {
      return await attempt(path, init, options.timeoutMs);
    } catch (error) {
      const transient = error instanceof ApiError && error.kind === "network";
      if (!transient || count >= retries) throw error;
      await sleep(retryBaseMs * 2 ** count);
    }
  }
}

export async function createPattern(
  input: CreatePatternInput,
  options: RequestOptions = {},
): Promise<PatternResponse> {
  const body = await request(
    "/patterns",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    options,
  );
  const result = PatternResponseSchema.safeParse(body);
  if (!result.success) throw invalidResponse(result.error);
  return result.data;
}

export async function getPattern(
  slug: string,
  options: RequestOptions = {},
): Promise<PatternResponse> {
  const body = await request(
    `/patterns/${encodeURIComponent(slug)}`,
    { method: "GET" },
    options,
  );
  const result = PatternResponseSchema.safeParse(body);
  if (!result.success) throw invalidResponse(result.error);
  return result.data;
}

export function describeApiError(error: ApiError): string {
  if (error.kind === "validation" && error.issues?.length) {
    return error.issues
      .slice(0, 3)
      .map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message))
      .join("; ");
  }
  if (error.kind === "rateLimited" && error.retryAfter !== undefined) {
    const wait = error.retryAfter === 1 ? "1 second" : `${error.retryAfter} seconds`;
    return `${error.message} Try again in ${wait}.`;
  }
  return error.message;
}

export function isRetryable(error: ApiError): boolean {
  return (
    error.kind === "network" ||
    error.kind === "timeout" ||
    error.kind === "server"
  );
}
