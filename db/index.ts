import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

declare global {
  var postgresClient: postgres.Sql | undefined;
}

/**
 * Lazily-created Postgres client + Drizzle instance.
 *
 * `postgres.js` doesn't connect until the first query runs, so importing this
 * module is free. `getDb()` throws only if it's actually used without
 * `DATABASE_URL` being set - which keeps auth-free pages renderable even before
 * you configure a database.
 */
let dbInstance: ReturnType<typeof setupDb> | undefined;

function getClient(): postgres.Sql {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not defined. Add it to your .env (see .env.example).",
    );
  }
  if (!global.postgresClient) {
    global.postgresClient = postgres(process.env.DATABASE_URL, {
      max: 10,
      // Transactions + edge runtimes need statement caching off.
      prepare: false,
    });
  }
  return global.postgresClient;
}

function setupDb() {
  return drizzle(getClient(), { schema });
}

export function getDb() {
  if (!dbInstance) {
    dbInstance = setupDb();
  }
  return dbInstance;
}

export type Database = ReturnType<typeof getDb>;
export { schema };