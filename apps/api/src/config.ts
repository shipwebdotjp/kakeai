import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { VoiceAdapterId } from "@kakeai/contracts";
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
  voiceBaseUrls: Record<VoiceAdapterId, string>;
  limits: LimitsConfig;
}

const GIB = 1024 ** 3;

export const LOOPBACK_HOST = "127.0.0.1";
export const DEFAULT_PORT = 4317;
export const DEFAULT_VOICEVOX_BASE_URL = "http://127.0.0.1:50021";
export const DEFAULT_AIVISSPEECH_BASE_URL = "http://127.0.0.1:10101";

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

function isLoopbackHostname(hostname: string): boolean {
  if (LOOPBACK_HOSTNAMES.has(hostname)) {
    return true;
  }
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts[0] !== "127") {
    return false;
  }
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

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

function normalizeHostname(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

export function parseVoiceBaseUrl(
  envName: string,
  value: string | undefined,
  defaultUrl: string,
): string {
  const raw = value === undefined || value.trim().length === 0 ? defaultUrl : value.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${envName} が不正です: ${raw}`);
  }
  if (url.protocol !== "http:") {
    throw new Error(`${envName} は http のみ許可されます: ${raw}`);
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error(`${envName} に認証情報は指定できません: ${raw}`);
  }
  if (!isLoopbackHostname(normalizeHostname(url.hostname))) {
    throw new Error(`${envName} はループバックのみ許可されます: ${raw}`);
  }
  if ((url.pathname !== "/" && url.pathname !== "") || url.search.length > 0 || url.hash.length > 0) {
    throw new Error(`${envName} にパス・クエリ・フラグメントは指定できません: ${raw}`);
  }
  return url.origin;
}

export function parseVoicevoxBaseUrl(value: string | undefined): string {
  return parseVoiceBaseUrl("KAKEAI_VOICEVOX_BASE_URL", value, DEFAULT_VOICEVOX_BASE_URL);
}

export function parseAivisspeechBaseUrl(value: string | undefined): string {
  return parseVoiceBaseUrl("KAKEAI_AIVISSPEECH_BASE_URL", value, DEFAULT_AIVISSPEECH_BASE_URL);
}

export function resolveVoiceBaseUrl(config: AppConfig, adapterId: VoiceAdapterId): string {
  return config.voiceBaseUrls[adapterId];
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
    voiceBaseUrls: {
      voicevox: parseVoicevoxBaseUrl(env.KAKEAI_VOICEVOX_BASE_URL),
      aivisspeech: parseAivisspeechBaseUrl(env.KAKEAI_AIVISSPEECH_BASE_URL),
    },
    limits: { ...DEFAULT_LIMITS },
  };
}
