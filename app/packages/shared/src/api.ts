import { z } from "zod";
import { PatternSchema } from "./pattern.js";

export const CreatePatternSchema = z.strictObject({
  title: z.string().trim().min(1).max(60).optional(),
  parentSlug: z.string().min(1).max(32).optional(),
  pattern: PatternSchema,
});

export const GalleryQuerySchema = z.strictObject({
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  sort: z.enum(["recent", "popular"]).default("recent"),
});

// Shape returned by `POST /patterns` and `GET /patterns/:slug`. Kept here so
// the web client can validate responses with the same Zod source of truth.
export const PatternResponseSchema = z.strictObject({
  slug: z.string().min(1),
  title: z.string().nullable(),
  pattern: PatternSchema,
  playCount: z.number().int().nonnegative(),
  remixCount: z.number().int().nonnegative(),
  parentSlug: z.string().nullable(),
  createdAt: z.string(),
});

// Nest error envelope: `{ statusCode, error, message, issues? }`.
export const ApiErrorResponseSchema = z.object({
  statusCode: z.number().optional(),
  error: z.string().optional(),
  message: z.union([z.string(), z.array(z.string())]).optional(),
  issues: z
    .array(z.object({ path: z.string(), message: z.string() }))
    .optional(),
});

export type CreatePatternInput = z.infer<typeof CreatePatternSchema>;
export type GalleryQuery = z.infer<typeof GalleryQuerySchema>;
export type PatternResponse = z.infer<typeof PatternResponseSchema>;
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;