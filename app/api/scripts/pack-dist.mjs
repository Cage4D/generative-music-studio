import { spawnSync } from "node:child_process";
import { cp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = dirname(apiRoot);
const deployDir = join(workspaceRoot, ".api-deploy");
const distNodeModules = join(apiRoot, "dist", "node_modules");

await rm(deployDir, { force: true, recursive: true });

try {
  const result = spawnSync(
    "pnpm",
    [
      "--filter",
      "api",
      "deploy",
      "--prod",
      "--config.node-linker=hoisted",
      deployDir,
    ],
    { cwd: workspaceRoot, env: process.env, stdio: "inherit" },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `pnpm deploy failed with exit code ${result.status ?? "unknown"}`,
    );
  }

  await rm(distNodeModules, { force: true, recursive: true });
  await cp(join(deployDir, "node_modules"), distNodeModules, {
    recursive: true,
  });
} finally {
  await rm(deployDir, { force: true, recursive: true });
}
