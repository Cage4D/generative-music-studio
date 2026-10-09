// Re-exports so server-side code imports auth from a single stable path ("@/auth")
// and the client from "@/lib/auth/client".
export { getAuth } from "@/lib/auth";
export type { Auth, Session, User } from "@/lib/auth";