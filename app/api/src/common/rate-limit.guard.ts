import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import type { Request, Response } from "express";
import {
  parseRateLimitMax,
  parseRateLimitWindowMs,
} from "../config.js";

type Bucket = {
  count: number;
  resetAt: number;
};

/**
 * Small fixed-window limiter. It is intentionally dependency free: the service
 * runs as a single instance, and the only thing that matters is that the
 * limiter keys on the real client IP (see the `trust proxy` setting in
 * `main.ts`) so one noisy client cannot exhaust the shared limit for everyone
 * else behind the same proxy.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor() {
    this.max = parseRateLimitMax(process.env.RATE_LIMIT_MAX);
    this.windowMs = parseRateLimitWindowMs(process.env.RATE_LIMIT_WINDOW_MS);
  }

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    if (request.path === "/health") return true;
    if (this.max <= 0) return true;

    const now = Date.now();
    this.prune(now);

    const key = request.ip ?? request.socket.remoteAddress ?? "unknown";
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      this.setHeaders(response, this.max - 1, now + this.windowMs);
      return true;
    }

    bucket.count += 1;
    if (bucket.count > this.max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      response.setHeader("Retry-After", String(retryAfter));
      this.setHeaders(response, 0, bucket.resetAt);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: "Too Many Requests",
          message: "Too many requests. Please try again shortly.",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.setHeaders(response, this.max - bucket.count, bucket.resetAt);
    return true;
  }

  private setHeaders(response: Response, remaining: number, resetAt: number) {
    response.setHeader("X-RateLimit-Limit", String(this.max));
    response.setHeader("X-RateLimit-Remaining", String(Math.max(0, remaining)));
    response.setHeader("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));
  }

  private prune(now: number) {
    if (this.buckets.size < 1000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
