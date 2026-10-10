import "dotenv/config";
import { defineConfig } from "vitest/config";

function testDatabaseUrl(base = process.env.DATABASE_URL) {
  if (!base) {
    throw new Error(
      "DATABASE_URL is not set. Copy api/.env.example to api/.env first.",
    );
  }
  const url = new URL(base);
  url.pathname = "/generative_music_studio_test";
  return url.toString();
}

export default defineConfig({
  test: {
    globals: true,
    root: "./",
    include: ["**/*.e2e-spec.ts"],
    env: {
      DATABASE_URL: testDatabaseUrl(),
    },
  },
});