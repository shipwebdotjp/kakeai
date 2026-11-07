import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { liveRuntimeConfigSchema, type LiveRuntimeConfig } from "@kakeai/contracts";

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
    },
    tts: { adapters: {} },
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
