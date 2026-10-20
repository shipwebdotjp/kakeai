import { readFileSync } from "node:fs";

export const DEFAULT_AGENT_ID = "mcp";

export interface McpRunConfig {
  /** Explicit socket path (`--socket` / `KAKEAI_SOCKET`). Wins over dataRoot. */
  socketPath?: string;
  /** Data root override (`--data-dir`). Env and platform defaults are handled by the client. */
  dataRoot?: string;
  /** Handshake agent id (`--agent-id` / `KAKEAI_AGENT_ID`). */
  agentId: string;
}

export type ParsedMcpArgs =
  | { kind: "run"; config: McpRunConfig }
  | { kind: "help" }
  | { kind: "version" };

export class McpConfigError extends Error {
  readonly exitCode = 2;

  constructor(message: string) {
    super(message);
    this.name = "McpConfigError";
  }
}

export function helpText(): string {
  return [
    "kakeai-mcp — Kakeai Agent Access の MCP stdio サーバー",
    "",
    "使い方: kakeai-mcp [options]",
    "",
    "options:",
    "  --agent-id <id>    ハンドシェイクで送るエージェント識別子（既定: mcp）",
    "  --data-dir <path>  Kakeai のデータディレクトリ（KAKEAI_DATA_DIR 相当）",
    "  --socket <path>    エージェントソケットの明示パス（KAKEAI_SOCKET 相当）",
    "  -h, --help         このヘルプを表示する",
    "  -V, --version      バージョンを表示する",
    "",
    "環境変数: KAKEAI_DATA_DIR / KAKEAI_SOCKET / KAKEAI_AGENT_ID",
    "stdout は MCP の JSON-RPC 専用で、ログは stderr に出力する。",
  ].join("\n");
}

export function readPackageVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      typeof parsed.version === "string" &&
      parsed.version.length > 0
    ) {
      return parsed.version;
    }
  } catch {
    // A missing package metadata file must not break stdio startup.
  }
  return "0.0.0";
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function readOptionValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new McpConfigError(`${flag} には値が必要です。`);
  }
  if (value.trim().length === 0) {
    throw new McpConfigError(`${flag} には空でない値が必要です。`);
  }
  return value;
}

/**
 * `--flag value` and `--flag=value` are both accepted. Explicit arguments win
 * over environment variables, and `--socket` wins over `--data-dir`.
 */
export function parseMcpArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): ParsedMcpArgs {
  let agentId: string | undefined;
  let dataRoot: string | undefined;
  let socketPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const equals = arg.indexOf("=");
    const flag = arg.startsWith("--") && equals > 0 ? arg.slice(0, equals) : arg;
    const inlineValue = arg.startsWith("--") && equals > 0 ? arg.slice(equals + 1) : undefined;

    const value = (): string => {
      if (inlineValue !== undefined) {
        if (inlineValue.trim().length === 0) {
          throw new McpConfigError(`${flag} には空でない値が必要です。`);
        }
        return inlineValue;
      }
      const read = readOptionValue(argv, index, flag);
      index += 1;
      return read;
    };

    switch (flag) {
      case "--help":
      case "-h":
        return { kind: "help" };
      case "--version":
      case "-V":
        return { kind: "version" };
      case "--agent-id":
        agentId = value();
        break;
      case "--data-dir":
        dataRoot = value();
        break;
      case "--socket":
        socketPath = value();
        break;
      default:
        throw new McpConfigError(`未知の引数です: ${arg}`);
    }
  }

  const resolvedDataRoot = nonEmpty(dataRoot);
  const resolvedSocketPath = nonEmpty(socketPath) ?? nonEmpty(env.KAKEAI_SOCKET);
  return {
    kind: "run",
    config: {
      agentId: nonEmpty(agentId) ?? nonEmpty(env.KAKEAI_AGENT_ID) ?? DEFAULT_AGENT_ID,
      ...(resolvedDataRoot === undefined ? {} : { dataRoot: resolvedDataRoot }),
      ...(resolvedSocketPath === undefined ? {} : { socketPath: resolvedSocketPath }),
    },
  };
}
