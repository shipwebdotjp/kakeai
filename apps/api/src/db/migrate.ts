import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { logger } from "../logger.ts";

const execFileAsync = promisify(execFile);

export function apiRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..");
}

export async function runMigrations(): Promise<void> {
  const require = createRequire(import.meta.url);
  const prismaCli = require.resolve("prisma/build/index.js");
  try {
    await execFileAsync(process.execPath, [prismaCli, "migrate", "deploy"], {
      cwd: apiRoot(),
      env: process.env,
    });
  } catch (error) {
    const failure = error as { stdout?: unknown; stderr?: unknown };
    logger.error("migration_failed", {
      error: error instanceof Error ? error.message : String(error),
      stderr: typeof failure.stderr === "string" ? failure.stderr.slice(-2000) : undefined,
      stdout: typeof failure.stdout === "string" ? failure.stdout.slice(-2000) : undefined,
    });
    throw error;
  }
}
