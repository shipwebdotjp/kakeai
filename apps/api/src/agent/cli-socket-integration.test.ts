import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createKakeaiMcpServer, mcpToolName } from "@kakeai/mcp";
import { createAgentClient, type AgentClient } from "@kakeai/agent-client";
import { agentOperationNames } from "@kakeai/contracts";
import { runCli, type CliIo } from "@kakeai/cli";
import type { AppConfig } from "../config.ts";
import { loadConfig } from "../config.ts";
import { createPrismaClient } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { applySqlitePragmas } from "../db/pragmas.ts";
import { FakeFontCatalogAdapter, FontCatalogService } from "../services/font-catalog.ts";
import { ensureDataDirectories } from "../storage/paths.ts";
import { createWorker } from "../worker/index.ts";
import { startAgentSocketServer, type AgentSocketServer } from "./socket-server.ts";

// A 1x1 PNG. It is only used to exercise content detection and probing.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
  "base64",
);

const BIN_PATH = fileURLToPath(new URL("../../../cli/bin/kakeai-agent.js", import.meta.url));

let dataDir: string;
let fixtureDir: string;
let fixturePath: string;
let config: AppConfig;
let prisma: ReturnType<typeof createPrismaClient>;
let worker: ReturnType<typeof createWorker>;
let agentServer: AgentSocketServer;
let mcpClient: Client;
let mcpServer: ReturnType<typeof createKakeaiMcpServer>;
let agentClient: AgentClient;

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function json(text: string): unknown {
  expect(text.trim().split("\n")).toHaveLength(1);
  return JSON.parse(text) as unknown;
}

function structured<T>(result: unknown): T {
  return (result as { structuredContent?: unknown }).structuredContent as T;
}

function mcpText(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
  const first = content?.[0];
  if (first === undefined || first.type !== "text" || first.text === undefined) {
    throw new Error("expected a text content block");
  }
  return first.text;
}

/** Runs the CLI in-process against the real local socket. */
async function cli(
  argv: string[],
  extra: Pick<CliIo, "readStdin" | "now" | "sleep"> = {},
): Promise<CliResult> {
  const out: string[] = [];
  const err: string[] = [];
  const exitCode = await runCli(["--data-dir", dataDir, ...argv], {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    // Explicitly empty so a developer's KAKEAI_* environment cannot leak in.
    env: {},
    ...extra,
  });
  return { exitCode, stdout: out.join(""), stderr: err.join("") };
}

function runBin(argv: string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN_PATH, ...argv],
      { timeout: 30_000 },
      (error, stdout, stderr) => {
        const code = (error as { code?: unknown } | null)?.code;
        resolve({
          exitCode: typeof code === "number" ? code : error === null ? 0 : 1,
          stdout,
          stderr,
        });
      },
    );
  });
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-cli-real-"));
  fixtureDir = await mkdtemp(join(tmpdir(), "kakeai-cli-fixture-"));
  fixturePath = join(fixtureDir, "fixture.png");
  await writeFile(fixturePath, PNG_1X1);

  process.env.KAKEAI_DATA_DIR = dataDir;
  config = loadConfig();
  await ensureDataDirectories(config.directories);
  await runMigrations();
  prisma = createPrismaClient(config.databaseUrl);
  await applySqlitePragmas(prisma);
  worker = createWorker({ prisma, config });
  agentServer = await startAgentSocketServer({
    config,
    prisma,
    // The real font profiler is slow and must never run in tests.
    fontCatalogService: new FontCatalogService(new FakeFontCatalogAdapter()),
  });

  agentClient = createAgentClient({ dataRoot: config.dataRoot, agentId: "mcp-parity" });
  mcpServer = createKakeaiMcpServer({ request: agentClient });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  mcpClient = new Client({ name: "cli-parity-client", version: "0.0.0" }, { capabilities: {} });
  await Promise.all([
    mcpServer.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
}, 60000);

afterAll(async () => {
  await mcpClient.close();
  await mcpServer.close();
  await agentServer.close();
  await prisma.$disconnect();
  delete process.env.KAKEAI_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
  await rm(fixtureDir, { recursive: true, force: true });
});

describe("CLI against the real agent dispatcher", () => {
  it("runs create, edit, import, composition, publish, render and job waits", async () => {
    const schema = await cli(["schema.get"]);
    expect(schema.exitCode).toBe(0);
    expect(schema.stderr).toBe("");
    const schemaData = json(schema.stdout) as {
      contentSchemaVersion: number;
      agentOperations: Array<{ name: string }>;
      schemaDigest: string;
      operationDigest: string;
      minProtocolVersion: number;
    };
    expect(schemaData.contentSchemaVersion).toBe(1);
    expect(schemaData.agentOperations).toHaveLength(agentOperationNames.length);
    expect(schemaData.schemaDigest).toMatch(/^fnv1a64:/u);
    expect(schemaData.operationDigest).toMatch(/^fnv1a64:/u);
    expect(schemaData.minProtocolVersion).toBe(1);

    const created = await cli(["work.create", "--input", '{"title":"CLI 実連携作品"}']);
    expect(created.exitCode).toBe(0);
    const work = (json(created.stdout) as {
      work: {
        id: string;
        languageEditions: Array<{ currentScriptVersion: { id: string } }>;
      };
    }).work;
    const baseScriptVersionId = work.languageEditions[0]!.currentScriptVersion.id;

    // stdin input and attribution through the configured agent id.
    const edited = await cli(
      [
        "--agent-id",
        "cli-real-agent",
        "script.edit",
        "--input",
        "-",
      ],
      {
        readStdin: async () =>
          JSON.stringify({
            baseScriptVersionId,
            requestId: "cli-real-edit-1",
            operations: [
              { op: "scene.add", kind: "point", key: "scene-cli" },
              {
                op: "line.add",
                sceneId: { key: "scene-cli" },
                captionText: "CLI から追加した要点です。",
              },
            ],
          }),
      },
    );
    expect(edited.exitCode).toBe(0);
    const editedVersion = (json(edited.stdout) as {
      scriptVersion: { id: string; author: string; authorAgentId: string | null };
    }).scriptVersion;
    expect(editedVersion.author).toBe("agent");
    expect(editedVersion.authorAgentId).toBe("cli-real-agent");

    const stale = await cli([
      "script.edit",
      "--input",
      JSON.stringify({
        baseScriptVersionId,
        requestId: "cli-real-stale",
        operations: [{ op: "scene.add", kind: "point" }],
      }),
    ]);
    expect(stale.exitCode).toBe(1);
    expect(stale.stdout).toBe("");
    expect((json(stale.stderr) as { code: string }).code).toBe("SCRIPT_BASE_STALE");

    let assetAvailable = true;
    try {
      await new Promise<void>((resolve, reject) => {
        execFile("ffprobe", ["-version"], (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    } catch {
      assetAvailable = false;
    }
    if (assetAvailable) {
      const imported = await cli([
        "asset.import",
        "--input",
        JSON.stringify({ path: fixturePath, originalFilename: "fixture.png" }),
      ]);
      expect(imported.exitCode).toBe(0);
      const jobId = (json(imported.stdout) as { jobId: string | null }).jobId;
      expect(jobId).not.toBeNull();
      while (await worker.runOnce()) {
        continue;
      }
      const waited = await cli([
        "job.wait",
        jobId!,
        "--timeout-ms",
        "5000",
        "--interval-ms",
        "50",
      ]);
      expect(waited.exitCode).toBe(0);
      expect((json(waited.stdout) as { job: { status: string } }).job.status).toBe("succeeded");
    }

    const composition = await cli([
      "composition.create",
      "--input",
      '{"name":"CLI Real","runtimeCompositionId":"cmp.cli.real"}',
    ]);
    expect(composition.exitCode).toBe(0);
    const compositionId = (json(composition.stdout) as { composition: { id: string } })
      .composition.id;

    const saved = await cli([
      "composition.draft.save",
      "--input",
      JSON.stringify({
        compositionId,
        files: {
          "index.html": [
            '<!doctype html><html><head><meta charset="utf-8"></head><body>',
            '<div id="app" data-composition-id="cmp.cli.real" data-width="1920" data-height="1080" data-duration="4" data-fps="30"></div>',
            '<script>window.__timelines = window.__timelines || {};window.__timelines["cmp.cli.real"] = { duration: 4 };</script>',
            "</body></html>",
          ].join(""),
        },
        manifest: { durationMs: 4000, dependencies: [] },
      }),
    ]);
    expect(saved.exitCode).toBe(0);

    const dryRun = await cli([
      "composition.publish",
      "--input",
      JSON.stringify({ compositionId, dryRun: true }),
    ]);
    expect(dryRun.exitCode).toBe(0);
    expect((json(dryRun.stdout) as { dryRun: boolean }).dryRun).toBe(true);

    const published = await cli([
      "composition.publish",
      "--input",
      JSON.stringify({ compositionId }),
    ]);
    expect(published.exitCode).toBe(0);
    const version = json(published.stdout) as { dryRun: boolean; version: { id: string } };
    expect(version.dryRun).toBe(false);
    expect(version.version.id).toBeTruthy();

    const started = await cli([
      "render.start",
      "--input",
      JSON.stringify({ scriptVersionId: editedVersion.id }),
    ]);
    expect(started.exitCode).toBe(0);
    const renderJobId = (json(started.stdout) as { job: { id: string; status: string } }).job.id;

    const queued = await cli(["job.get", "--input", JSON.stringify({ jobId: renderJobId })]);
    expect(queued.exitCode).toBe(0);
    expect((json(queued.stdout) as { job: { status: string } }).job.status).toBe("queued");

    // Budget expiry is a successful wait result, not a failure.
    const waitedBriefly = await cli([
      "job.wait",
      renderJobId,
      "--timeout-ms",
      "50",
      "--interval-ms",
      "10",
    ]);
    expect(waitedBriefly.exitCode).toBe(0);
    const waitResult = json(waitedBriefly.stdout) as {
      job: { status: string };
      timedOut: boolean;
    };
    expect(waitResult.job.status).toBe("queued");
    expect(waitResult.timedOut).toBe(true);

    // `--wait` uses the same polling and wraps the operation output.
    const waitedOnStart = await cli(
      [
        "render.start",
        "--input",
        JSON.stringify({ scriptVersionId: editedVersion.id }),
        "--wait",
        "--timeout-ms",
        "0",
      ],
    );
    expect(waitedOnStart.exitCode).toBe(0);
    const wrapped = json(waitedOnStart.stdout) as {
      result: { job: { id: string } };
      wait: { job: { status: string }; timedOut: boolean };
    };
    expect(wrapped.result.job.id).toBeTruthy();
    expect(wrapped.wait.timedOut).toBe(true);

    const cancelled = await cli([
      "job.cancel",
      "--input",
      JSON.stringify({ jobId: renderJobId }),
    ]);
    expect(cancelled.exitCode).toBe(0);
    expect((json(cancelled.stdout) as { job: { status: string } }).job.status).toBe("cancelled");
  }, 120000);

  it("returns the same JSON as the MCP binding for the same operation", async () => {
    const schemaViaCli = await cli(["schema.get"]);
    const schemaViaMcp = await mcpClient.callTool({
      name: mcpToolName("schema.get"),
      arguments: {},
    });
    expect(schemaViaCli.exitCode).toBe(0);
    expect(schemaViaCli.stdout.trim()).toBe(mcpText(schemaViaMcp));

    const listed = await agentClient.request("work.list", {});
    const workId = listed.works[0]?.id;
    if (workId === undefined) {
      throw new Error("expected at least one work from the round trip");
    }

    const workViaCli = await cli(["work.get", "--input", JSON.stringify({ workId })]);
    const workViaMcp = await mcpClient.callTool({
      name: mcpToolName("work.get"),
      arguments: { workId },
    });
    expect(workViaCli.exitCode).toBe(0);
    expect(workViaCli.stdout.trim()).toBe(mcpText(workViaMcp));
    expect(json(workViaCli.stdout)).toEqual(structured<unknown>(workViaMcp));

    const readListViaCli = await cli(["work.list"]);
    const readListViaMcp = await mcpClient.callTool({
      name: mcpToolName("work.list"),
      arguments: {},
    });
    expect(readListViaCli.stdout.trim()).toBe(mcpText(readListViaMcp));
  });

  it("keeps stdout pure and stderr stable when spawned as the bin", async () => {
    const socketPath = join(dataDir, "agent", "agent.sock");

    const help = await runBin(["--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stderr).toBe("");
    expect(help.stdout).toContain("work.create");
    expect(help.stdout).toContain("job.wait");

    const version = await runBin(["--version"]);
    expect(version.exitCode).toBe(0);
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/u);

    const operations = await runBin(["operations", "--socket", socketPath]);
    expect(operations.exitCode).toBe(0);
    expect(operations.stderr).toBe("");
    expect(json(operations.stdout)).toMatchObject({
      operations: expect.arrayContaining([
        expect.objectContaining({ name: "schema.get", kind: "read" }),
      ]),
    });

    const schema = await runBin(["schema.get", "--socket", socketPath, "--pretty"]);
    expect(schema.exitCode).toBe(0);
    expect(schema.stderr).toBe("");
    expect(JSON.parse(schema.stdout)).toMatchObject({ protocolVersion: 1 });

    const unknown = await runBin(["work.delete", "--socket", socketPath]);
    expect(unknown.exitCode).toBe(2);
    expect(unknown.stdout).toBe("");
    expect((json(unknown.stderr) as { code: string }).code).toBe("CLI_USAGE_ERROR");

    const offline = await runBin([
      "work.list",
      "--socket",
      join(dataDir, "missing", "agent.sock"),
    ]);
    expect(offline.exitCode).toBe(1);
    expect(offline.stdout).toBe("");
    expect((json(offline.stderr) as { code: string }).code).toBe("AGENT_APP_UNAVAILABLE");
  }, 60000);
});
