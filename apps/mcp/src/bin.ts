import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAgentClient } from "@kakeai/agent-client";
import {
  McpConfigError,
  helpText,
  parseMcpArgs,
  readPackageVersion,
} from "./config.ts";
import { createKakeaiMcpServer } from "./server.ts";

function logStderr(message: string): void {
  process.stderr.write(`kakeai-mcp: ${message}\n`);
}

async function main(): Promise<void> {
  const parsed = parseMcpArgs(process.argv.slice(2));

  if (parsed.kind === "help") {
    process.stdout.write(`${helpText()}\n`);
    return;
  }
  if (parsed.kind === "version") {
    process.stdout.write(`${readPackageVersion()}\n`);
    return;
  }

  const version = readPackageVersion();
  const client = createAgentClient({
    agentId: parsed.config.agentId,
    ...(parsed.config.dataRoot === undefined ? {} : { dataRoot: parsed.config.dataRoot }),
    ...(parsed.config.socketPath === undefined ? {} : { socketPath: parsed.config.socketPath }),
  });
  const server = createKakeaiMcpServer({
    request: client,
    version,
    onInternalError: (error) => {
      logStderr(
        `内部エラー (${error instanceof Error ? error.name : typeof error})。詳細は出力しない。`,
      );
    },
  });

  const shutdown = (): void => {
    server.close().then(
      () => {
        process.exit(0);
      },
      (error: unknown) => {
        logStderr(
          `終了に失敗しました (${error instanceof Error ? error.name : typeof error})。`,
        );
        process.exit(1);
      },
    );
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  // stdout belongs to the MCP transport from here on.
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  if (error instanceof McpConfigError) {
    logStderr(error.message);
    process.exitCode = error.exitCode;
    return;
  }
  logStderr(`起動に失敗しました (${error instanceof Error ? error.name : typeof error})。`);
  process.exitCode = 1;
});
