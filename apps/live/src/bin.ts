import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { LiveRunConfig, LiveRuntimeConfig } from "@kakeai/contracts";
import { runLoopbackOAuthFlow } from "./auth/oauth.ts";
import {
  saveTokenStore,
  tokenStoreFromResponse,
  youtubeTokenStorePath,
} from "./auth/youtube-token.ts";
import {
  defaultLiveRuntimeConfig,
  loadLiveRunConfigFile,
  loadLiveRuntimeConfigFile,
  readControlTokenFile,
  resolveLiveRuntimeConfig,
  type LiveRuntimeConfigOverrides,
} from "./config.ts";
import { resolveCommentSourceKind } from "./comments/factory.ts";
import { isPackageError, loadLivePackage } from "./package/loader.ts";
import { isLocalLlmEndpoint } from "./llm/local-endpoint.ts";
import { RunStore } from "./runs/run-store.ts";
import { createLiveServer } from "./server/server.ts";

const USAGE = `使い方:
  npm run live -- --package <dir> --run-config <file> [--port <port>] [--config <file>]
  npm run live -- --package <dir> --run-id <id> --run-dir <dir> \\
    --control-token-file <file> --run-config <file> [--port <port>] [--config <file>]
  npm run live -- auth --config <file>

  --package <dir>           ライブパッケージのディレクトリ（起動時に必須）
  --port <port>             待受ポート（既定は Run 設定、なければ 3010）
  --config <file>           ライブ設定 JSON（LLM/TTS/YouTube認証情報）
  --run-id <id>             Kakeai が発行した Run ID（Run 設定と照合）
  --run-dir <dir>           Run のログ・run-config・fixture を置くディレクトリ
  --control-token-file <file>  loopback control 用の一回限りのトークン（0600）
  --run-config <file>       Kakeai が書いた Run 設定 JSON（必須）

  auth                      YouTube の読み取り専用 OAuth をやり直し、フォールバック用トークンを保存する（APIキーのみなら不要）`;

export type LiveCliOptions =
  | { kind: "help" }
  | { kind: "auth"; configPath: string | undefined }
  | {
      kind: "run";
      packageDir: string;
      port: number | undefined;
      configPath: string | undefined;
      runId: string | undefined;
      runDir: string | undefined;
      controlTokenFile: string | undefined;
      runConfigPath: string;
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
  let runId: string | undefined;
  let runDir: string | undefined;
  let controlTokenFile: string | undefined;
  let runConfigPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    switch (arg) {
      case "--package":
        packageDir = readOptionValue(argv, index, "--package");
        index += 1;
        break;
      case "--run-id":
        runId = readOptionValue(argv, index, "--run-id");
        index += 1;
        break;
      case "--run-dir":
        runDir = readOptionValue(argv, index, "--run-dir");
        index += 1;
        break;
      case "--control-token-file":
        controlTokenFile = readOptionValue(argv, index, "--control-token-file");
        index += 1;
        break;
      case "--run-config":
        runConfigPath = readOptionValue(argv, index, "--run-config");
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
  if (runDir !== undefined && runId === undefined) {
    usageError("--run-dir には --run-id も必要です。");
  }
  if (runConfigPath === undefined) {
    usageError("--run-config は必須です。");
  }
  return {
    kind: "run",
    packageDir,
    port,
    configPath,
    runId,
    runDir,
    controlTokenFile,
    runConfigPath,
  };
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

export function validateYouTubeRun(
  config: LiveRuntimeConfig,
  runConfig: LiveRunConfig,
): void {
  if (resolveCommentSourceKind(runConfig) === "fixture") {
    return;
  }
  if (!isLocalLlmEndpoint(config.llm)) {
    throw new Error(
      "実 YouTube の実行ではローカル LLM（mode: local かつループバック URL）を使ってください。外部 LLM は fixture の Run 設定だけで使えます。",
    );
  }
  if (config.youtube === undefined) {
    throw new Error(
      "実 YouTube の実行には --config の youtube（apiKey、または OAuth の clientId と clientSecret）が必要です。",
    );
  }
  // The Run is authoritative for the target. Local config supplies auth only;
  // an explicit null in the Run must not be filled from it.
  const source = runConfig.source;
  if (source.kind !== "youtube") {
    return;
  }
  if (source.videoUrl === null && source.liveChatId === null) {
    throw new Error(
      "Run 設定に videoUrl または liveChatId を指定してください（ローカル設定の youtube からは補いません）。",
    );
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

/**
 * Resolves the loopback control token. An explicitly empty environment value
 * must fail instead of silently running without control, because Kakeai would
 * otherwise launch a Run it can never stop through the control endpoint.
 */
export async function resolveControlToken(
  controlTokenFile: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  if (controlTokenFile !== undefined) {
    return readControlTokenFile(resolve(invocationCwd(), controlTokenFile));
  }
  const envToken = env.KAKEAI_LIVE_CONTROL_TOKEN;
  if (envToken === undefined) {
    return undefined;
  }
  const token = envToken.trim();
  if (token.length === 0) {
    throw new Error(
      "KAKEAI_LIVE_CONTROL_TOKEN が空です。control を無効にする場合は環境変数自体を設定しないでください。",
    );
  }
  return token;
}

/**
 * Re-checks the Run config against the loaded package. Kakeai already verified
 * this at creation; doing it again catches a package or fixture changed while
 * the operator was preparing the show.
 */
async function validateRunConfig(
  runConfig: LiveRunConfig,
  loaded: Awaited<ReturnType<typeof loadLivePackage>>,
): Promise<void> {
  if (runConfig.runId.length === 0) {
    throw new Error("Run ID がありません。");
  }
  if (loaded.manifest.packageSchemaVersion !== 2) {
    throw new Error("Run で使えるのは packageSchemaVersion: 2 のパッケージだけです。");
  }
  if (runConfig.package.packageId !== loaded.manifest.packageId) {
    throw new Error("Run 設定の packageId がパッケージと一致しません。");
  }
  let configuredPackagePath: string;
  let loadedPackagePath: string;
  try {
    [configuredPackagePath, loadedPackagePath] = await Promise.all([
      realpath(runConfig.package.packagePath),
      realpath(loaded.rootDir),
    ]);
  } catch (error) {
    throw new Error(
      `Run 設定とパッケージの実パスを解決できません: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (configuredPackagePath !== loadedPackagePath) {
    throw new Error("Run 設定の packagePath が読み込んだパッケージと一致しません。");
  }
  const manifestSha256 = await sha256File(join(loaded.rootDir, "manifest.json"));
  if (manifestSha256 !== runConfig.package.manifestSha256) {
    throw new Error("Run 設定の manifestSha256 がパッケージと一致しません。");
  }
  const source = loaded.manifest.source;
  if (!("programVersionId" in source)) {
    throw new Error("Run 用パッケージの manifest source が Live Program ではありません。");
  }
  if (source.programVersionId !== runConfig.programVersionId) {
    throw new Error("Run 設定の programVersionId がパッケージと一致しません。");
  }
  if (runConfig.source.kind === "fixture") {
    const digest = await sha256File(runConfig.source.fixturePath);
    if (digest !== runConfig.source.fixtureSha256) {
      throw new Error("fixture の SHA-256 が Run 設定と一致しません。");
    }
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
  const runConfig = await loadLiveRunConfigFile(
    resolve(invocationCwd(), options.runConfigPath),
  );
  const runId = options.runId ?? runConfig.runId;
  if (runId !== runConfig.runId) {
    throw new Error("--run-id と Run 設定の runId が一致しません。");
  }
  await validateRunConfig(runConfig, loaded);

  const overrides: LiveRuntimeConfigOverrides = {};
  if (options.port !== undefined) {
    overrides.port = options.port;
  } else {
    overrides.port = runConfig.requestedPort;
  }
  const config = await loadConfig(options.configPath, overrides);
  validateYouTubeRun(config, runConfig);

  const controlToken = await resolveControlToken(options.controlTokenFile);

  const runStore = await RunStore.create({
    dataDir: config.dataDir,
    showTitle: loaded.show.show.title,
    packageId: loaded.manifest.packageId,
    packagePath: loaded.rootDir,
    ...(runId === undefined ? {} : { runId }),
    ...(options.runDir === undefined
      ? {}
      : { dir: resolve(invocationCwd(), options.runDir) }),
  });

  let server: Awaited<ReturnType<typeof createLiveServer>> | null = null;
  let closing = false;
  const shutdown = (signal: string) => {
    if (closing || server === null) {
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

  server = await createLiveServer({
    package: loaded,
    config,
    runStore,
    runConfig,
    ...(controlToken === undefined ? {} : { controlToken }),
    onStopRequested: () => shutdown("control"),
  });

  for (const warning of loaded.warnings) {
    console.warn(`警告: ${warning}`);
  }
  console.log("Kakeai Live");
  console.log(`  Run: ${server.runStore.runId}`);
  console.log(`  パッケージ: ${loaded.rootDir}`);
  console.log(`  実行ディレクトリ: ${server.runStore.dir}`);
  console.log(`  ステージ:   ${server.url}/stage`);
  console.log(`  コンソール: ${server.url}/console`);
  console.log(`  control: ${controlToken === undefined ? "disabled" : "enabled"}`);

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
