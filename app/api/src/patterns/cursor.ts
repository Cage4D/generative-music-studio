import { z } from "zod";

const CursorSchema = z.discriminatedUnion("sort", [
  z.strictObject({
    sort: z.literal("recent"),
    createdAt: z.string().refine((s) => !Number.isNaN(Date.parse(s))),
    id: z.string().uuid(),
  }),
  z.strictObject({
    sort: z.literal("popular"),
    playCount: z.number().int().min(0),
    id: z.string().uuid(),
  }),
]);

export type Cursor = z.infer<typeof CursorSchema>;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeCursor(raw: string): Cursor | null {
  try {
    const json = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    const result = CursorSchema.safeParse(json);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}