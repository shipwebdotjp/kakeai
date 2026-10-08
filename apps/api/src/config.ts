import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type DataDirectories,
  dataDirectories,
  databaseFilePath,
  resolveDataRoot,
  toSqliteUrl,
} from "./storage/paths.ts";

export interface LimitsConfig {
  maxUploadBytes: number;
  maxMediaDurationMs: number;
  maxWidthPx: number;
  maxHeightPx: number;
  storageWarningBytes: number;
}

export interface AppConfig {
  host: string;
  port: number;
  dataRoot: string;
  directories: DataDirectories;
  databaseUrl: string;
  webDistDir: string;
  allowedOrigins: ReadonlySet<string>;
  limits: LimitsConfig;
}

const GIB = 1024 ** 3;

export const LOOPBACK_HOST = "127.0.0.1";
export const DEFAULT_PORT = 4317;

const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_WEB_DIST_DIR = resolve(API_ROOT, "..", "web", "dist");

export const DEFAULT_LIMITS: LimitsConfig = {
  maxUploadBytes: 4 * GIB,
  maxMediaDurationMs: 30 * 60 * 1000,
  maxWidthPx: 3840,
  maxHeightPx: 2160,
  storageWarningBytes: 80 * GIB,
};

export function allowedOriginsForPort(port: number): ReadonlySet<string> {
  return new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
  ]);
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) {
    return DEFAULT_PORT;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`KAKEAI_PORT が不正です: ${value}`);
  }
  return port;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): AppConfig {
  const port = parsePort(env.KAKEAI_PORT);
  const dataRoot = resolveDataRoot(env, platform, home);
  const directories = dataDirectories(dataRoot);
  const webDistOverride = env.KAKEAI_WEB_DIST;
  return {
    host: LOOPBACK_HOST,
    port,
    dataRoot,
    directories,
    databaseUrl: toSqliteUrl(databaseFilePath(directories)),
    webDistDir:
      webDistOverride !== undefined && webDistOverride.trim().length > 0
        ? resolve(webDistOverride.trim())
        : DEFAULT_WEB_DIST_DIR,
    allowedOrigins: allowedOriginsForPort(port),
    limits: { ...DEFAULT_LIMITS },
  };
}
