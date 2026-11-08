import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { LiveRuntimeConfig } from "@kakeai/contracts";
import { runLoopbackOAuthFlow } from "./auth/oauth.ts";
import {
  saveTokenStore,
  tokenStoreFromResponse,
  youtubeTokenStorePath,
} from "./auth/youtube-token.ts";
import {
  defaultLiveRuntimeConfig,
  loadLiveRuntimeConfigFile,
  resolveLiveRuntimeConfig,
  type LiveRuntimeConfigOverrides,
} from "./config.ts";
import { isPackageError, loadLivePackage } from "./package/loader.ts";
import { isLocalLlmEndpoint } from "./llm/local-endpoint.ts";
import { createLiveServer } from "./server/server.ts";

const USAGE = `使い方:
  npm run live -- --package <dir> [--test] [--port <port>] [--config <file>]
  npm run live -- auth --config <file>

  --package <dir>   ライブパッケージのディレクトリ（起動時に必須）
  --test            コメントソースを fixture に上書きする
  --port <port>     待受ポート（既定 3010）
  --config <file>   ライブ設定 JSON

  auth              YouTube の読み取り専用 OAuth をやり直し、フォールバック用トークンを保存する（APIキーのみなら不要）`;

export type LiveCliOptions =
  | { kind: "help" }
  | { kind: "auth"; configPath: string | undefined }
  | {
      kind: "run";
      packageDir: string;
      testMode: boolean;
      port: number | undefined;
      configPath: string | undefined;
    };

function usageError(message: string): never {
  throw new Error(`${message}\n\n${USAGE}`);
}

function readOptionValue(argv: readonly string[], index: number, name: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.trim().length === 0 || value.startsWith("-")) {
    usageError(`${name} に値がありません。`);
  }
  return value;
}

function parseAuthArgs(argv: readonly string[]): LiveCliOptions {
  let configPath: string | undefined;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--config") {
      configPath = readOptionValue(argv, index, "--config");
      index += 1;
      continue;
    }
    usageError(`不明な引数です: ${arg}`);
  }
  return { kind: "auth", configPath };
}

export function parseLiveArgs(argv: readonly string[]): LiveCliOptions {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { kind: "help" };
  }
  if (argv[0] === "auth") {
    return parseAuthArgs(argv);
  }
  let packageDir: string | undefined;
  let configPath: string | undefined;
  let port: number | undefined;
  let testMode = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    switch (arg) {
      case "--test":
        testMode = true;
        break;
      case "--package":
        packageDir = readOptionValue(argv, index, "--package");
        index += 1;
        break;
      case "--port": {
        const value = readOptionValue(argv, index, "--port");
        if (!/^\d+$/.test(value)) {
          usageError("--port には整数を指定してください。");
        }
        port = Number(value);
        if (port < 1 || port > 65535) {
          usageError("--port は 1〜65535 の範囲で指定してください。");
        }
        index += 1;
        break;
      }
      case "--config":
        configPath = readOptionValue(argv, index, "--config");
        index += 1;
        break;
      default:
        usageError(`不明な引数です: ${arg}`);
    }
  }

  if (packageDir === undefined) {
    usageError("--package は必須です。");
  }
  return { kind: "run", packageDir, testMode, port, configPath };
}

function invocationCwd(): string {
  // npm workspace scripts run in apps/live; resolve user paths against the
  // directory the command was invoked from.
  return process.env.INIT_CWD ?? process.cwd();
}

async function loadConfig(
  configPath: string | undefined,
  overrides: LiveRuntimeConfigOverrides = {},
): Promise<LiveRuntimeConfig> {
  let config = defaultLiveRuntimeConfig();
  if (configPath !== undefined) {
    config = await loadLiveRuntimeConfigFile(resolve(invocationCwd(), configPath));
  }
  return resolveLiveRuntimeConfig(config, overrides);
}

function validateYouTubeRun(
  config: LiveRuntimeConfig,
  showKind: "youtube" | "fixture",
  testMode: boolean,
): void {
  if (testMode || showKind === "fixture") {
    return;
  }
  if (!isLocalLlmEndpoint(config.llm)) {
    throw new Error(
      "実 YouTube の実行ではローカル LLM（mode: local かつループバック URL）を使ってください。外部 LLM は --test の fixture だけで使えます。",
    );
  }
  const youtube = config.youtube;
  if (youtube === undefined) {
    throw new Error(
      "実 YouTube の実行には --config の youtube（apiKey、または OAuth の clientId と clientSecret、および videoUrl または liveChatId）が必要です。",
    );
  }
  if (youtube.videoUrl === undefined && youtube.liveChatId === undefined) {
    throw new Error("youtube 設定に videoUrl または liveChatId を指定してください。");
  }
}

async function runAuth(configPath: string | undefined): Promise<void> {
  const config = await loadConfig(configPath);
  const youtube = config.youtube;
  if (youtube === undefined) {
    throw new Error(
      "YouTube の設定がありません。--config の youtube に apiKey、または clientId と clientSecret を指定してください。",
    );
  }
  const hasOAuth = youtube.clientId !== undefined && youtube.clientSecret !== undefined;
  if (youtube.apiKey !== undefined && !hasOAuth) {
    console.log(
      "APIキー方式では認証不要です。OAuth フォールバックを使う場合は clientId と clientSecret も設定してください。",
    );
    return;
  }
  if (youtube.clientId === undefined || youtube.clientSecret === undefined) {
    throw new Error(
      "OAuth の設定がありません。--config の youtube に clientId と clientSecret を指定してください。",
    );
  }
  const token = await runLoopbackOAuthFlow({
    clientId: youtube.clientId,
    clientSecret: youtube.clientSecret,
    onAuthorizationUrl: (url) => {
      console.log("次の URL をブラウザで開いて、YouTube の読み取りを許可してください:");
      console.log(url);
    },
  });
  const store = tokenStoreFromResponse(token);
  await saveTokenStore(config.dataDir, store);
  const purpose = youtube.apiKey === undefined ? "" : "OAuth フォールバック用の";
  console.log(`${purpose}認証情報を保存しました: ${youtubeTokenStorePath(config.dataDir)}`);
  console.log(`OAuth アプリが Testing の場合の認証有効期限: ${store.authExpiresAt}`);
}

async function main(): Promise<void> {
  const options = parseLiveArgs(process.argv.slice(2));
  if (options.kind === "help") {
    console.log(USAGE);
    return;
  }
  if (options.kind === "auth") {
    await runAuth(options.configPath);
    return;
  }

  const loaded = await loadLivePackage(resolve(invocationCwd(), options.packageDir));
  const overrides: LiveRuntimeConfigOverrides = {};
  if (options.port !== undefined) {
    overrides.port = options.port;
  }
  const config = await loadConfig(options.configPath, overrides);
  validateYouTubeRun(config, loaded.show.commentSource.kind, options.testMode);

  const server = await createLiveServer({
    package: loaded,
    config,
    testMode: options.testMode,
  });

  for (const warning of loaded.warnings) {
    console.warn(`警告: ${warning}`);
  }
  console.log("Kakeai Live");
  console.log(`  パッケージ: ${loaded.rootDir}`);
  console.log(`  実行ディレクトリ: ${server.runStore.dir}`);
  console.log(`  ステージ:   ${server.url}/stage`);
  console.log(`  コンソール: ${server.url}/console`);
  console.log(`  テストモード: ${options.testMode ? "on" : "off"}`);

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) {
      return;
    }
    closing = true;
    console.log(`\n${signal} を受信しました。終了します。`);
    void server.close().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error(error);
        process.exit(1);
      },
    );
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main().catch((error: unknown) => {
    if (isPackageError(error)) {
      console.error(`パッケージ検証エラー [${error.code}]: ${error.message}`);
    } else {
      console.error(error instanceof Error ? error.message : error);
    }
    process.exitCode = 1;
  });
}
