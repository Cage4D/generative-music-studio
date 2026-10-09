import { getDb } from "@/db";

import { createAuth } from "./config";

let _auth: ReturnType<typeof createAuth> | null = null;

/**
 * Singleton accessor for the better-auth instance.
 *
 * `createAuth` is synchronous (it only wires options together), so unlike the
 * database client nothing is created until this is first called — pages render
 * fine before any auth / DB config exists.
 */
export function getAuth() {
  if (!_auth) {
    _auth = createAuth(getDb());
  }
  return _auth;
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
export type User = Session["user"];