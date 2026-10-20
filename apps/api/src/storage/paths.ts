import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_SOCKET_DIRECTORY, AGENT_SOCKET_FILENAME } from "@kakeai/contracts";

export interface DataDirectories {
  root: string;
  db: string;
  assets: string;
  artifacts: string;
  compositions: string;
  tmp: string;
  agent: string;
}

export function resolveDataRoot(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  const override = env.KAKEAI_DATA_DIR;
  if (override !== undefined && override.trim().length > 0) {
    return resolve(override.trim());
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "Kakeai");
  }
  if (platform === "win32") {
    const appData = env.APPDATA !== undefined && env.APPDATA.trim().length > 0
      ? env.APPDATA.trim()
      : join(home, "AppData", "Roaming");
    return join(appData, "Kakeai");
  }
  const xdg = env.XDG_DATA_HOME !== undefined && env.XDG_DATA_HOME.trim().length > 0
    ? env.XDG_DATA_HOME.trim()
    : join(home, ".local", "share");
  return join(xdg, "kakeai");
}

export function dataDirectories(root: string): DataDirectories {
  return {
    root,
    db: join(root, "db"),
    assets: join(root, "assets"),
    artifacts: join(root, "artifacts"),
    compositions: join(root, "compositions"),
    tmp: join(root, "tmp"),
    agent: join(root, AGENT_SOCKET_DIRECTORY),
  };
}

/**
 * The control socket directory is owner-only. `mkdir` alone is affected by the
 * process umask, so chmod explicitly after creation.
 */
export async function ensureAgentDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
}

export async function ensureDataDirectories(directories: DataDirectories): Promise<void> {
  await Promise.all(
    [
      directories.root,
      directories.db,
      directories.assets,
      directories.artifacts,
      directories.compositions,
      directories.tmp,
    ].map((directory) => mkdir(directory, { recursive: true })),
  );
  await ensureAgentDirectory(directories.agent);
}

export function agentSocketFilePath(directories: DataDirectories): string {
  return join(directories.agent, AGENT_SOCKET_FILENAME);
}

export function databaseFilePath(directories: DataDirectories): string {
  return join(directories.db, "kakeai.db");
}

export function toSqliteUrl(filePath: string): string {
  return `file:${filePath}`;
}
