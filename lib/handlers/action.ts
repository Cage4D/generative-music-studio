"use server";

import { headers } from "next/headers";
import { ZodError, type ZodType } from "zod";

import { getAuth, type Session } from "@/auth";
import { UnauthorizedError, ValidationError } from "@/lib/http-errors";

type ActionOptions<T> = {
  params?: T;
  schema?: ZodType<T>;
  authorize?: boolean;
};

/**
 * Shared scaffolding for every server action:
 *  1. validate params against a zod schema,
 *  2. if `authorize` is true, resolve the current session,
 *  3. return `{ params, session }` for the caller to build on.
 *
 * Validation/authorization failures are returned as `RequestError` instances
 * (callers `instanceof Error` check them), matching the app's error contract.
 */
export default async function action<T>({
  params,
  schema,
  authorize = false,
}: ActionOptions<T>): Promise<{
  params: T;
  session: Session | null;
}> {
  if (schema && params) {
    try {
      schema.parse(params);
    } catch (err) {
      if (err instanceof ZodError) {
        return new ValidationError(
          err.flatten().fieldErrors as Record<string, string[]>,
        ) as never;
      }
      return new Error("Schema validation failed") as never;
    }
  }

  let session: Session | null = null;
  if (authorize) {
    const auth = await getAuth();
    session = await auth.api.getSession({ headers: await headers() });

    if (!session) {
      return new UnauthorizedError() as never;
    }
  }

  return { params, session } as never;
}