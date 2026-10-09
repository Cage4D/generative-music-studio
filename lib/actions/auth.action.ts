"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { getAuth, type Session } from "@/auth";
import handleError from "@/lib/handlers/error";
import action from "@/lib/handlers/action";
import { SignInSchema, SignUpSchema } from "@/lib/validations";

type AuthCredentials = z.infer<typeof SignUpSchema>;

const h = () => headers();

export async function signUpWithCredentials(
  params: AuthCredentials,
): Promise<SuccessResponse | ErrorResponse> {
  const validationResult = await action({ params, schema: SignUpSchema });

  if (validationResult instanceof Error) {
    return handleError(validationResult) as ErrorResponse;
  }

  const { name, username, email, password } = validationResult.params!;

  try {
    const auth = await getAuth();
    await auth.api.signUpEmail({
      headers: await h(),
      body: { name, email, password, username },
    });

    return { success: true };
  } catch (err) {
    return handleError(err) as ErrorResponse;
  }
}

export async function signInWithCredentials(
  params: Pick<AuthCredentials, "email" | "password">,
): Promise<SuccessResponse | ErrorResponse> {
  const validationResult = await action({ params, schema: SignInSchema });

  if (validationResult instanceof Error) {
    return handleError(validationResult) as ErrorResponse;
  }

  const { email, password } = validationResult.params!;

  try {
    const auth = await getAuth();
    await auth.api.signInEmail({
      headers: await h(),
      body: { email, password },
    });

    return { success: true };
  } catch (err) {
    return handleError(err) as ErrorResponse;
  }
}

export async function signOut(): Promise<SuccessResponse | ErrorResponse> {
  try {
    const auth = await getAuth();
    await auth.api.signOut({ headers: await h() });
    return { success: true };
  } catch (err) {
    return handleError(err) as ErrorResponse;
  }
}

export async function getCurrentUser(): Promise<
  SuccessResponse<Session["user"]> | ErrorResponse
> {
  try {
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: await h() });

    if (!session) {
      return {
        success: false,
        status: 401,
        error: { message: "Unauthorized" },
      };
    }

    return { success: true, data: session.user };
  } catch (err) {
    return handleError(err) as ErrorResponse;
  }
}