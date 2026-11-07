import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  defaultLiveRuntimeConfig,
  loadLiveRuntimeConfigFile,
  resolveLiveRuntimeConfig,
  type LiveRuntimeConfigOverrides,
} from "./config.ts";
import { isPackageError, loadLivePackage } from "./package/loader.ts";
import { createLiveServer } from "./server/server.ts";

const USAGE = `使い方:
  npm run live -- --package <dir> [--test] [--port <port>] [--config <file>]

  --package <dir>   ライブパッケージのディレクトリ（必須）
  --test            コメントソースを fixture に上書きする（P4 で使用）
  --port <port>     待受ポート（既定 3010）
  --config <file>   ライブ設定 JSON`;

interface CliOptions {
  help: boolean;
  packageDir: string | undefined;
  testMode: boolean;
  port: number | undefined;
  configPath: string | undefined;
}

function usageError(message: string): never {
  throw new Error(`${message}\n\n${USAGE}`);
}

export function parseLiveArgs(argv: readonly string[]): CliOptions {
  if (argv.includes("--help") || argv.includes("-h")) {
    return {
      help: true,
      packageDir: undefined,
      testMode: false,
      port: undefined,
      configPath: undefined,
    };
  }
  if (argv[0] === "auth") {
    throw new Error("`live auth` は P4（YouTube 連携）で実装します。");
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
      case "--package": {
        const value = argv[index + 1];
        if (value === undefined || value.trim().length === 0 || value.startsWith("-")) {
          usageError("--package に値がありません。");
        }
        packageDir = value;
        index += 1;
        break;
      }
      case "--port": {
        const value = argv[index + 1];
        if (value === undefined || !/^\d+$/.test(value)) {
          usageError("--port には整数を指定してください。");
        }
        port = Number(value);
        if (port < 1 || port > 65535) {
          usageError("--port は 1〜65535 の範囲で指定してください。");
        }
        index += 1;
        break;
      }
      case "--config": {
        const value = argv[index + 1];
        if (value === undefined || value.trim().length === 0 || value.startsWith("-")) {
          usageError("--config に値がありません。");
        }
        configPath = value;
        index += 1;
        break;
      }
      default:
        usageError(`不明な引数です: ${arg}`);
    }
  }

  if (packageDir === undefined) {
    usageError("--package は必須です。");
  }
  return { help: false, packageDir, testMode, port, configPath };
}

async function main(): Promise<void> {
  const options = parseLiveArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  const packageDir = options.packageDir;
  if (packageDir === undefined) {
    usageError("--package は必須です。");
  }
  // npm workspace scripts run in apps/live; resolve user paths against the
  // directory the command was invoked from.
  const invocationCwd = process.env.INIT_CWD ?? process.cwd();
  const loaded = await loadLivePackage(resolve(invocationCwd, packageDir));

  let config = defaultLiveRuntimeConfig();
  if (options.configPath !== undefined) {
    config = await loadLiveRuntimeConfigFile(resolve(invocationCwd, options.configPath));
  }
  const overrides: LiveRuntimeConfigOverrides = {};
  if (options.port !== undefined) {
    overrides.port = options.port;
  }
  config = resolveLiveRuntimeConfig(config, overrides);

  if (
    !options.testMode &&
    loaded.show.commentSource.kind === "youtube" &&
    config.llm.mode !== "local"
  ) {
    throw new Error(
      "実 YouTube の実行では llm.mode を local にしてください。外部 LLM は --test の fixture だけで使えます。",
    );
  }

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
