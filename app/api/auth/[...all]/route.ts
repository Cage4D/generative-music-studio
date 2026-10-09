import { getAuth } from "@/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(async (request) => {
  const auth = await getAuth();
  return auth.handler(request);
});