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

export type CreatePatternInput = z.infer<typeof CreatePatternSchema>;
export type GalleryQuery = z.infer<typeof GalleryQuerySchema>;