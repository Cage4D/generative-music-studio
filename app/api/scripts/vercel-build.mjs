import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function run(args, env = process.env) {
  const result = spawnSync("pnpm", args, {
    cwd: apiRoot,
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed: pnpm ${args.join(" ")}`);
  }
}

if (process.env.VERCEL_ENV === "production") {
  const directUrl = process.env.DATABASE_URL_UNPOOLED;
  if (!directUrl) {
    throw new Error(
      "DATABASE_URL_UNPOOLED is required to apply production Prisma migrations.",
    );
  }

  run(
    [
      "exec",
      "prisma",
      "migrate",
      "deploy",
      "--config",
      resolve(apiRoot, "prisma7.config.ts"),
    ],
    { ...process.env, DATABASE_URL: directUrl },
  );
}

run(["run", "build"]);
