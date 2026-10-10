import "dotenv/config";
import { execSync } from "node:child_process";
import { Client } from "pg";

const mainUrl = process.env.DATABASE_URL;
if (!mainUrl) {
  throw new Error("DATABASE_URL is not set. Copy api/.env.example to api/.env first.");
}

const adminUrl = new URL(mainUrl);
adminUrl.pathname = "/postgres";

const testUrl = new URL(mainUrl);
testUrl.pathname = "/generative_music_studio_test";
const testDb = testUrl.pathname.slice(1);

const client = new Client({ connectionString: adminUrl.toString() });
await client.connect();
const { rows } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [testDb]);
if (rows.length === 0) {
  await client.query(`CREATE DATABASE "${testDb}"`);
  console.log(`Created test database "${testDb}"`);
}
await client.end();

execSync("prisma migrate deploy", {
  env: { ...process.env, DATABASE_URL: testUrl.toString() },
  stdio: "inherit",
});
console.log(`Test database "${testDb}" is up to date.`);