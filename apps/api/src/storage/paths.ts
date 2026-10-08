import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface DataDirectories {
  root: string;
  db: string;
  assets: string;
  artifacts: string;
  tmp: string;
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
    tmp: join(root, "tmp"),
  };
}

export async function ensureDataDirectories(directories: DataDirectories): Promise<void> {
  await Promise.all(
    [directories.root, directories.db, directories.assets, directories.artifacts, directories.tmp].map(
      (directory) => mkdir(directory, { recursive: true }),
    ),
  );
}

export function databaseFilePath(directories: DataDirectories): string {
  return join(directories.db, "kakeai.db");
}

export function toSqliteUrl(filePath: string): string {
  return `file:${filePath}`;
}
