import { lstat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_LIVE_COMMENTS_CONFIG,
  liveRunConfigSchema,
  liveRuntimeConfigSchema,
  type LiveRunConfig,
  type LiveRuntimeConfig,
} from "@kakeai/contracts";

export const DEFAULT_LIVE_PORT = 3010;
export const DEFAULT_LLM_BASE_URL = "http://127.0.0.1:11434/v1";
export const DEFAULT_LLM_MODEL = "qwen2.5:7b-instruct";

function envDataDir(): string | undefined {
  const value = process.env.KAKEAI_LIVE_DATA_DIR?.trim();
  return value !== undefined && value.length > 0 ? value : undefined;
}

export function defaultLiveDataDir(): string {
  const fromEnv = envDataDir();
  if (fromEnv !== undefined) {
    return fromEnv;
  }
  return join(homedir(), "Library", "Application Support", "kakeai", "live");
}

function formatIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join(" / ");
}

export function defaultLiveRuntimeConfig(): LiveRuntimeConfig {
  return {
    llm: {
      mode: "local",
      baseUrl: DEFAULT_LLM_BASE_URL,
      model: DEFAULT_LLM_MODEL,
      timeoutMs: 15_000,
    },
    tts: { adapters: {}, timeoutMs: 20_000, maxConcurrentTts: 2 },
    comments: {
      ...DEFAULT_LIVE_COMMENTS_CONFIG,
      ngWords: [],
    },
    port: DEFAULT_LIVE_PORT,
    dataDir: defaultLiveDataDir(),
  };
}

export async function loadLiveRuntimeConfigFile(path: string): Promise<LiveRuntimeConfig> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`ライブ設定ファイルを読めません: ${path}`, { cause: error });
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `ライブ設定ファイルが JSON ではありません: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const parsed = liveRuntimeConfigSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`ライブ設定ファイルが不正です: ${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

function parseJsonFile(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(
      `${label} が JSON ではありません: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readTextFile(path: string, label: string): Promise<string> {
  return readFile(path, "utf8").catch((error: unknown) => {
    throw new Error(`${label} を読めません: ${path}`, { cause: error });
  });
}

/** Validates the Kakeai-provided `run-config.json`; it contains no secrets. */
export async function loadLiveRunConfigFile(path: string): Promise<LiveRunConfig> {
  const text = await readTextFile(path, "Run 設定ファイル");
  const parsed = liveRunConfigSchema.safeParse(parseJsonFile(text, "Run 設定ファイル"));
  if (!parsed.success) {
    throw new Error(`Run 設定ファイルが不正です: ${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

/** Reads the one-time control token written by Kakeai with 0600 permissions. */
export async function readControlTokenFile(path: string): Promise<string> {
  const info = await lstat(path).catch((error: unknown) => {
    throw new Error(`control token ファイルを読めません: ${path}`, { cause: error });
  });
  if (!info.isFile()) {
    throw new Error(`control token ファイルは通常ファイルにしてください: ${path}`);
  }
  const mode = info.mode & 0o777;
  if (mode !== 0o600 && mode !== 0o400) {
    throw new Error(
      `control token ファイルの権限は 0600 または 0400 にしてください: ${path}`,
    );
  }
  const token = (await readTextFile(path, "control token ファイル")).trim();
  if (token.length === 0) {
    throw new Error(`control token ファイルが空です: ${path}`);
  }
  return token;
}

export interface LiveRuntimeConfigOverrides {
  port?: number;
  dataDir?: string;
}

/**
 * Applies CLI/environment overrides after the config file. `KAKEAI_LIVE_DATA_DIR`
 * always wins so test runs can redirect all runtime output to a temporary dir.
 */
export function resolveLiveRuntimeConfig(
  base: LiveRuntimeConfig,
  overrides: LiveRuntimeConfigOverrides = {},
): LiveRuntimeConfig {
  const dataDir = envDataDir() ?? overrides.dataDir ?? base.dataDir;
  const port = overrides.port ?? base.port;
  const parsed = liveRuntimeConfigSchema.safeParse({ ...base, port, dataDir });
  if (!parsed.success) {
    throw new Error(`ライブ設定が不正です: ${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}
