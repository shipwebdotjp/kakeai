import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type { z } from "zod";
import {
  AGENT_PROTOCOL_VERSION,
  agentOperationOutputSchemas,
  buildAgentSchemaGetResult,
  type AgentErrorIssue,
} from "@kakeai/contracts";
import { mcpToolName } from "./tools.ts";
import {
  fixtureAsset,
  fixtureAssetJob,
  fixtureComposition,
  fixtureCompositionVersion,
  fixtureRenderJob,
  fixtureScriptVersion,
  fixtureWork,
} from "@kakeai/contracts/testing/agent-fixtures";

const STALE_ISSUE: AgentErrorIssue = {
  path: ["baseScriptVersionId"],
  code: "custom",
  message: "current と一致しません",
};

class MiniAgentError extends Error {
  readonly issues: AgentErrorIssue[];

  constructor(
    readonly code: string,
    issues: AgentErrorIssue[] = [],
  ) {
    super(code);
    this.name = "MiniAgentError";
    this.issues = issues;
  }
}

type MiniHandler = (input: unknown) => unknown;

interface FakeAgentServer {
  dataRoot: string;
  socketPath: string;
  handshakes: Array<{ protocolVersion: number; agentId?: string }>;
  close: () => Promise<void>;
}

/**
 * Minimal NDJSON server that speaks the documented Agent Access protocol. It
 * validates every response against the contract output schemas so the fixtures
 * cannot drift from the wire contract.
 */
async function startFakeAgentServer(
  handlers: Record<string, MiniHandler>,
): Promise<FakeAgentServer> {
  const directory = await mkdtemp(join(tmpdir(), "kakeai-mcp-stdio-"));
  const socketPath = join(directory, "agent", "agent.sock");
  await mkdir(dirname(socketPath), { recursive: true });
  const handshakes: FakeAgentServer["handshakes"] = [];
  const sockets = new Set<Socket>();

  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.setEncoding("utf8");
    let buffer = "";
    let handshakeDone = false;

    const fail = (requestId: string, code: string): void => {
      socket.write(`${JSON.stringify({ requestId, ok: false, error: { code } })}\n`);
    };

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) {
          break;
        }
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.trim().length === 0) {
          continue;
        }
        let frame: unknown;
        try {
          frame = JSON.parse(line);
        } catch {
          fail("", "AGENT_PROTOCOL_MISMATCH");
          socket.destroy();
          return;
        }
        if (!handshakeDone) {
          const handshake = frame as { protocolVersion?: number; agentId?: string };
          handshakes.push({
            protocolVersion: handshake.protocolVersion ?? -1,
            ...(handshake.agentId === undefined ? {} : { agentId: handshake.agentId }),
          });
          if (handshake.protocolVersion !== AGENT_PROTOCOL_VERSION) {
            fail("", "AGENT_PROTOCOL_MISMATCH");
            socket.destroy();
            return;
          }
          handshakeDone = true;
          continue;
        }

        const request = frame as {
          requestId?: string;
          operation?: string;
          input?: unknown;
        };
        const requestId = request.requestId ?? "";
        const operation = request.operation ?? "";
        const handler = handlers[operation];
        const outputSchema = (
          agentOperationOutputSchemas as Record<string, z.ZodType | undefined>
        )[operation];
        if (handler === undefined || outputSchema === undefined) {
          fail(requestId, "AGENT_OPERATION_UNKNOWN");
          continue;
        }
        try {
          const data = outputSchema.parse(handler(request.input));
          socket.write(`${JSON.stringify({ requestId, ok: true, data })}\n`);
        } catch (error) {
          if (error instanceof MiniAgentError) {
            socket.write(
              `${JSON.stringify({
                requestId,
                ok: false,
                error: {
                  code: error.code,
                  ...(error.issues.length === 0 ? {} : { issues: error.issues }),
                },
              })}\n`,
            );
          } else {
            fail(requestId, "INTERNAL_ERROR");
          }
        }
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    dataRoot: directory,
    socketPath,
    handshakes,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      for (const socket of sockets) {
        socket.destroy();
      }
      await rm(directory, { recursive: true, force: true });
    },
  };
}

const binPath = fileURLToPath(new URL("../bin/kakeai-mcp.js", import.meta.url));

function textPayload(result: unknown): unknown {
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
  const first = content?.[0];
  if (first === undefined || first.type !== "text" || first.text === undefined) {
    throw new Error("expected a text content block");
  }
  return JSON.parse(first.text);
}

let fakeServer: FakeAgentServer;
let client: Client;
let transport: StdioClientTransport;
let stderr = "";
let assetPolls = 0;
let renderPolls = 0;
let assetListInput: unknown;

beforeAll(async () => {
  const version = fixtureCompositionVersion();
  fakeServer = await startFakeAgentServer({
    "schema.get": () => buildAgentSchemaGetResult(),
    "work.create": () => ({ work: fixtureWork() }),
    "script.edit": (input) => {
      const request = input as { baseScriptVersionId: string };
      if (request.baseScriptVersionId === "scr-stale") {
        throw new MiniAgentError("SCRIPT_BASE_STALE", [STALE_ISSUE]);
      }
      return {
        scriptVersion: fixtureScriptVersion("scr-2", 2),
        created: {
          sceneIds: ["scene-1"],
          lineIds: [],
          cueIds: [],
          audioCueIds: [],
          audioTakeIds: [],
          characterIds: [],
          appearanceIds: [],
          speakerIds: [],
        },
        warnings: [],
        timeline: { totalDurationMs: 4000, fps: 30, scenes: [] },
        replay: false,
      };
    },
    "asset.import": () => ({
      asset: fixtureAsset(),
      jobId: "job-asset-1",
      deduplicated: false,
    }),
    "asset.list": (input) => {
      assetListInput = input;
      return { assets: [fixtureAsset()], nextCursor: "cursor-2", total: 1 };
    },
    "composition.create": () => ({ composition: fixtureComposition() }),
    "composition.publish": (input) => {
      const dryRun = (input as { dryRun?: boolean }).dryRun === true;
      return dryRun
        ? { dryRun: true, manifest: version.manifest, fontDiagnostics: [] }
        : { dryRun: false, version, fontDiagnostics: [] };
    },
    "render.start": () => ({ job: fixtureRenderJob("queued", "job-render-1") }),
    "job.get": (input) => {
      const { jobId } = input as { jobId: string };
      if (jobId === "job-asset-1") {
        assetPolls += 1;
        return { job: fixtureAssetJob(assetPolls >= 2 ? "succeeded" : "queued", jobId) };
      }
      if (jobId === "job-render-1") {
        renderPolls += 1;
        const status =
          renderPolls >= 3 ? "succeeded" : renderPolls === 2 ? "running" : "queued";
        return { job: fixtureRenderJob(status, jobId) };
      }
      throw new MiniAgentError("RESOURCE_NOT_FOUND");
    },
    "job.list": () => ({
      jobs: [fixtureAssetJob("succeeded", "job-asset-1")],
    }),
  });

  transport = new StdioClientTransport({
    command: process.execPath,
    args: [binPath],
    env: {
      ...getDefaultEnvironment(),
      // Resolving `<dataRoot>/agent/agent.sock` is the app's normal layout.
      KAKEAI_DATA_DIR: fakeServer.dataRoot,
      KAKEAI_AGENT_ID: "mcp-stdio-test",
    },
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  client = new Client({ name: "mcp-stdio-client", version: "0.0.0" }, { capabilities: {} });
  await client.connect(transport);
}, 30000);

afterAll(async () => {
  await client.close();
  await fakeServer.close();
});

describe("MCP stdio server against a real local socket", () => {
  it("completes create, edit, import, composition, publish and render through MCP", async () => {
    const schema = await client.callTool({
      name: mcpToolName("schema.get"),
      arguments: {},
    });
    expect(schema.isError).toBeUndefined();
    const schemaPayload = schema.structuredContent as {
      agentOperations: Array<{ name: string }>;
    };
    expect(schemaPayload.agentOperations.map((entry) => entry.name)).toContain("render.start");

    const created = await client.callTool({
      name: mcpToolName("work.create"),
      arguments: { title: "MCP 完走テスト" },
    });
    expect(created.isError).toBeUndefined();
    const work = (created.structuredContent as { work: { id: string; languageEditions: Array<{ currentScriptVersion: { id: string } }> } }).work;
    expect(work.id).toBe("work-1");
    const baseScriptVersionId = work.languageEditions[0]!.currentScriptVersion.id;

    const edited = await client.callTool({
      name: mcpToolName("script.edit"),
      arguments: {
        baseScriptVersionId,
        requestId: "mcp-e2e-1",
        operations: [{ op: "scene.add", kind: "point", key: "scene-1" }],
      },
    });
    expect(edited.isError).toBeUndefined();
    const scriptVersionId = (edited.structuredContent as { scriptVersion: { id: string } })
      .scriptVersion.id;
    expect(scriptVersionId).toBe("scr-2");

    const imported = await client.callTool({
      name: mcpToolName("asset.import"),
      arguments: { path: "/tmp/fixture.png" },
    });
    expect(imported.isError).toBeUndefined();
    const importPayload = imported.structuredContent as { jobId: string | null };
    expect(importPayload.jobId).toBe("job-asset-1");
    const importedJob = await client.callTool({
      name: "kakeai_job_wait",
      arguments: { jobId: importPayload.jobId, timeoutMs: 2000, intervalMs: 10 },
    });
    expect(importedJob.isError).toBeUndefined();
    expect((importedJob.structuredContent as { job: { status: string } }).job.status).toBe(
      "succeeded",
    );

    const composition = await client.callTool({
      name: mcpToolName("composition.create"),
      arguments: { name: "MCP Composition", runtimeCompositionId: "cmp.mcp.test" },
    });
    expect(composition.isError).toBeUndefined();
    const compositionId = (composition.structuredContent as { composition: { id: string } })
      .composition.id;
    expect(compositionId).toBe("cmp-1");

    const published = await client.callTool({
      name: mcpToolName("composition.publish"),
      arguments: { compositionId },
    });
    expect(published.isError).toBeUndefined();
    expect((published.structuredContent as { dryRun: boolean }).dryRun).toBe(false);
    expect(
      (published.structuredContent as { version: { manifest: { contentHash: string } } }).version
        .manifest.contentHash,
    ).toBe("bundle-hash-1");

    const started = await client.callTool({
      name: mcpToolName("render.start"),
      arguments: { scriptVersionId },
    });
    expect(started.isError).toBeUndefined();
    const renderJobId = (started.structuredContent as { job: { id: string } }).job.id;
    const queued = await client.callTool({
      name: mcpToolName("job.get"),
      arguments: { jobId: renderJobId },
    });
    expect((queued.structuredContent as { job: { status: string } }).job.status).toBe("queued");

    const rendered = await client.callTool({
      name: "kakeai_job_wait",
      arguments: { jobId: renderJobId, timeoutMs: 2000, intervalMs: 10 },
    });
    expect(rendered.isError).toBeUndefined();
    const renderResult = rendered.structuredContent as {
      job: { status: string };
      timedOut: boolean;
    };
    expect(renderResult.job.status).toBe("succeeded");
    expect(renderResult.timedOut).toBe(false);

    const jobs = await client.callTool({
      name: mcpToolName("job.list"),
      arguments: { workId: work.id },
    });
    expect((jobs.structuredContent as { jobs: unknown[] }).jobs).toHaveLength(1);
  }, 30000);

  it("forwards asset.list filters and returns the page contract", async () => {
    const filters = {
      kind: "image",
      status: "ready",
      filename: "bgm",
      tags: ["intro", "bgm"],
      tagMode: "or",
      favorite: true,
      archived: "include",
      hasAudio: true,
      durationMinMs: 0,
      durationMaxMs: 60_000,
      sort: "duration_asc",
      limit: 1,
    } as const;
    const result = await client.callTool({
      name: mcpToolName("asset.list"),
      arguments: filters,
    });
    expect(result.isError).toBeUndefined();
    expect(assetListInput).toEqual(filters);
    const page = result.structuredContent as {
      assets: Array<{ id: string }>;
      nextCursor: string | null;
      total: number;
    };
    expect(page.assets.map((asset) => asset.id)).toEqual([fixtureAsset().id]);
    expect(page.nextCursor).toBe("cursor-2");
    expect(page.total).toBe(1);
  });

  it("returns stable operation codes through MCP", async () => {
    const stale = await client.callTool({
      name: mcpToolName("script.edit"),
      arguments: {
        baseScriptVersionId: "scr-stale",
        requestId: "mcp-e2e-stale",
        operations: [{ op: "scene.add", kind: "point" }],
      },
    });
    expect(stale.isError).toBe(true);
    const payload = textPayload(stale) as { code: string; issues?: unknown[] };
    expect(payload.code).toBe("SCRIPT_BASE_STALE");
    expect(payload.issues).toHaveLength(1);
  });

  it("reports AGENT_APP_UNAVAILABLE as a tool error when Kakeai is not running", async () => {
    const offlineTransport = new StdioClientTransport({
      command: process.execPath,
      args: [binPath],
      env: {
        ...getDefaultEnvironment(),
        KAKEAI_SOCKET: join(fakeServer.dataRoot, "missing", "agent.sock"),
      },
      stderr: "pipe",
    });
    const offline = new Client(
      { name: "mcp-offline-client", version: "0.0.0" },
      { capabilities: {} },
    );
    await offline.connect(offlineTransport);
    try {
      const result = await offline.callTool({
        name: mcpToolName("work.list"),
        arguments: {},
      });
      expect(result.isError).toBe(true);
      const payload = textPayload(result) as { code: string };
      expect(payload.code).toBe("AGENT_APP_UNAVAILABLE");
    } finally {
      await offline.close();
    }
  });

  it("handshakes with the protocol version and configured agent id", () => {
    expect(fakeServer.handshakes.length).toBeGreaterThan(0);
    for (const handshake of fakeServer.handshakes) {
      expect(handshake.protocolVersion).toBe(AGENT_PROTOCOL_VERSION);
      expect(handshake.agentId).toBe("mcp-stdio-test");
    }
    expect(stderr).not.toContain("Error");
  });
});
