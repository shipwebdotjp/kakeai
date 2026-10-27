import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createKakeaiMcpServer } from "@kakeai/mcp";
import { createAgentClient } from "@kakeai/agent-client";
import { agentOperationNames } from "@kakeai/contracts";
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

let dataDir: string;
let fixtureDir: string;
let fixturePath: string;
let config: AppConfig;
let prisma: ReturnType<typeof createPrismaClient>;
let worker: ReturnType<typeof createWorker>;
let agentServer: AgentSocketServer;
let mcpClient: Client;
let mcpServer: ReturnType<typeof createKakeaiMcpServer>;

function textPayload(result: unknown): unknown {
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
  const first = content?.[0];
  if (first === undefined || first.type !== "text" || first.text === undefined) {
    throw new Error("expected a text content block");
  }
  return JSON.parse(first.text);
}

function structured<T>(result: unknown): T {
  return (result as { structuredContent?: unknown }).structuredContent as T;
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-mcp-real-"));
  fixtureDir = await mkdtemp(join(tmpdir(), "kakeai-mcp-fixture-"));
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

  const agentClient = createAgentClient({ dataRoot: config.dataRoot, agentId: "mcp-real-agent" });
  mcpServer = createKakeaiMcpServer({ request: agentClient });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  mcpClient = new Client({ name: "mcp-real-client", version: "0.0.0" }, { capabilities: {} });
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

describe("MCP against the real agent dispatcher", () => {
  it("runs the full agent-accessible flow and returns stable errors", async () => {
    const schema = await mcpClient.callTool({ name: "kakeai_schema_get", arguments: {} });
    expect(schema.isError).toBeUndefined();
    const schemaData = structured<{
      contentSchemaVersion: number;
      agentOperations: Array<{ name: string }>;
      schemaDigest: string;
    }>(schema);
    expect(schemaData.contentSchemaVersion).toBe(1);
    expect(schemaData.agentOperations).toHaveLength(agentOperationNames.length);
    expect(schemaData.schemaDigest).toMatch(/^fnv1a64:/u);

    const created = await mcpClient.callTool({
      name: "kakeai_work_create",
      arguments: { title: "MCP 実連携作品" },
    });
    expect(created.isError).toBeUndefined();
    const work = structured<{
      work: {
        id: string;
        languageEditions: Array<{ id: string; currentScriptVersion: { id: string } }>;
      };
    }>(created).work;
    const edition = work.languageEditions[0]!;

    const edited = await mcpClient.callTool({
      name: "kakeai_script_edit",
      arguments: {
        baseScriptVersionId: edition.currentScriptVersion.id,
        requestId: "mcp-real-edit-1",
        operations: [
          { op: "scene.add", kind: "point", key: "scene-mcp" },
          {
            op: "line.add",
            sceneId: { key: "scene-mcp" },
            captionText: "MCP から追加した要点です。",
          },
        ],
      },
    });
    expect(edited.isError).toBeUndefined();
    const editedVersion = structured<{
      scriptVersion: { id: string; author: string; authorAgentId: string | null };
    }>(edited).scriptVersion;
    expect(editedVersion.author).toBe("agent");
    expect(editedVersion.authorAgentId).toBe("mcp-real-agent");

    const stale = await mcpClient.callTool({
      name: "kakeai_script_edit",
      arguments: {
        baseScriptVersionId: edition.currentScriptVersion.id,
        requestId: "mcp-real-stale",
        operations: [{ op: "scene.add", kind: "point" }],
      },
    });
    expect(stale.isError).toBe(true);
    expect((textPayload(stale) as { code: string }).code).toBe("SCRIPT_BASE_STALE");

    const unknown = await mcpClient.callTool({
      name: "kakeai_work_delete",
      arguments: { workId: work.id },
    });
    expect(unknown.isError).toBe(true);
    expect((textPayload(unknown) as { code: string }).code).toBe("MCP_TOOL_UNKNOWN");

    let assetAvailable = true;
    try {
      await import("node:child_process").then(
        ({ execFile }) =>
          new Promise<void>((resolve, reject) => {
            execFile("ffprobe", ["-version"], (error) => {
              if (error) {
                reject(error);
              } else {
                resolve();
              }
            });
          }),
      );
    } catch {
      assetAvailable = false;
    }
    if (assetAvailable) {
      const imported = await mcpClient.callTool({
        name: "kakeai_asset_import",
        arguments: { path: fixturePath, originalFilename: "fixture.png" },
      });
      expect(imported.isError).toBeUndefined();
      const jobId = structured<{ jobId: string | null }>(imported).jobId;
      expect(jobId).not.toBeNull();
      while (await worker.runOnce()) {
        continue;
      }
      const waited = await mcpClient.callTool({
        name: "kakeai_job_wait",
        arguments: { jobId, timeoutMs: 5000, intervalMs: 50 },
      });
      expect(waited.isError).toBeUndefined();
      expect(structured<{ job: { status: string } }>(waited).job.status).toBe("succeeded");
    }

    const composition = await mcpClient.callTool({
      name: "kakeai_composition_create",
      arguments: { name: "MCP Real", runtimeCompositionId: "cmp.mcp.real" },
    });
    expect(composition.isError).toBeUndefined();
    const compositionId = structured<{ composition: { id: string } }>(composition).composition.id;

    const saved = await mcpClient.callTool({
      name: "kakeai_composition_draft_update",
      arguments: {
        compositionId,
        files: {
          "index.html": [
            '<!doctype html><html><head><meta charset="utf-8"></head><body>',
            '<div id="app" data-composition-id="cmp.mcp.real" data-width="1920" data-height="1080" data-duration="4" data-fps="30"></div>',
            '<script>window.__timelines = window.__timelines || {};window.__timelines["cmp.mcp.real"] = { duration: 4 };</script>',
            "</body></html>",
          ].join(""),
        },
        manifest: { durationMs: 4000, dependencies: [] },
      },
    });
    expect(saved.isError).toBeUndefined();

    const dryRun = await mcpClient.callTool({
      name: "kakeai_composition_publish",
      arguments: { compositionId, dryRun: true },
    });
    expect(dryRun.isError).toBeUndefined();
    expect(structured<{ dryRun: boolean }>(dryRun).dryRun).toBe(true);

    const published = await mcpClient.callTool({
      name: "kakeai_composition_publish",
      arguments: { compositionId },
    });
    expect(published.isError).toBeUndefined();
    const version = structured<{ dryRun: boolean; version: { id: string } }>(published);
    expect(version.dryRun).toBe(false);
    expect(version.version.id).toBeTruthy();

    const started = await mcpClient.callTool({
      name: "kakeai_render_start",
      arguments: { scriptVersionId: editedVersion.id },
    });
    expect(started.isError).toBeUndefined();
    const renderJobId = structured<{ job: { id: string; status: string } }>(started).job.id;

    const waitedBriefly = await mcpClient.callTool({
      name: "kakeai_job_wait",
      arguments: { jobId: renderJobId, timeoutMs: 50, intervalMs: 10 },
    });
    expect(waitedBriefly.isError).toBeUndefined();
    const waitResult = structured<{ job: { status: string }; timedOut: boolean }>(waitedBriefly);
    expect(waitResult.job.status).toBe("queued");
    expect(waitResult.timedOut).toBe(true);

    const cancelled = await mcpClient.callTool({
      name: "kakeai_job_cancel",
      arguments: { jobId: renderJobId },
    });
    expect(cancelled.isError).toBeUndefined();
    expect(structured<{ job: { status: string } }>(cancelled).job.status).toBe("cancelled");
  }, 120000);
});
