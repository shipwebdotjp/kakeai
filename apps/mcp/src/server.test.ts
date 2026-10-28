import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AgentClientError } from "@kakeai/agent-client";
import {
  AGENT_ERROR_CODES,
  agentOperationNames,
  buildAgentSchemaGetResult,
  type AgentOperationName,
} from "@kakeai/contracts";
import type { AgentRequester, McpServerOptions } from "./server.ts";
import { createKakeaiMcpServer } from "./server.ts";
import { mcpToolEntries } from "./tools.ts";
import { createFakeRequester, type FakeHandler } from "./testing/fake-requester.ts";
import {
  fixtureRenderJob,
  fixtureScriptVersion,
  fixtureTtsJob,
  fixtureWork,
} from "@kakeai/contracts/testing/agent-fixtures";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";

interface Harness {
  client: Client;
  operations: AgentOperationName[];
  close: () => Promise<void>;
}

async function connectHarness(
  handle: FakeHandler,
  options: Pick<McpServerOptions, "now" | "sleep"> = {},
): Promise<Harness> {
  const operations: AgentOperationName[] = [];
  const requester: AgentRequester = createFakeRequester((operation, input) => {
    operations.push(operation);
    return handle(operation, input);
  });
  const server = createKakeaiMcpServer({ request: requester, ...options });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "mcp-test-client", version: "0.0.0" }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    operations,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function textPayload(result: unknown): unknown {
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
  const first = content?.[0];
  if (first === undefined || first.type !== "text" || first.text === undefined) {
    throw new Error("expected a text content block");
  }
  return JSON.parse(first.text);
}

function expectToolError(result: unknown, code: string): { code: string; issues?: unknown[] } {
  expect((result as { isError?: boolean }).isError).toBe(true);
  const payload = textPayload(result) as { code: string; issues?: unknown[] };
  expect(payload.code).toBe(code);
  return payload;
}

describe("MCP server over an in-memory transport", () => {
  it("lists exactly the generated tool catalog", async () => {
    const harness = await connectHarness((operation) => {
      if (operation === "schema.get") {
        return buildAgentSchemaGetResult();
      }
      throw new Error("unexpected operation");
    });
    try {
      const listed = await harness.client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual(
        mcpToolEntries.map((entry) => entry.toolName).sort(),
      );
      for (const tool of listed.tools) {
        expect(tool.inputSchema.type).toBe("object");
        expect(tool.outputSchema?.type).toBe("object");
        expect(tool.annotations?.destructiveHint).toBe(false);
      }
    } finally {
      await harness.close();
    }
  });

  it("returns preview.scriptFrame bytes for an unsaved content document draft", async () => {
    const frame = {
      scriptVersionId: null,
      requestedTimeMs: 500,
      durationMs: 9000,
      width: 320,
      height: 240,
      mimeType: "image/png",
      imageBase64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
    };
    const harness = await connectHarness((operation) => {
      if (operation === "preview.scriptFrame") {
        return frame;
      }
      throw new Error(`unexpected operation: ${operation}`);
    });
    try {
      const result = await harness.client.callTool({
        name: "kakeai_preview_script_frame",
        arguments: { content: validContentDocument(), timeMs: 500 },
      });
      expect(result.isError).toBeUndefined();
      const { imageBase64: _omitted, ...metadata } = frame;
      expect(textPayload(result)).toEqual(metadata);
      expect(result.structuredContent).toEqual(frame);
    } finally {
      await harness.close();
    }
  });

  it("forwards reads and mutations with JSON content and structured content", async () => {
    const harness = await connectHarness((operation) => {
      switch (operation) {
        case "schema.get":
          return buildAgentSchemaGetResult();
        case "work.create":
          return { work: fixtureWork() };
        case "script.edit":
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
        default:
          throw new Error(`unexpected operation: ${operation}`);
      }
    });
    try {
      const schema = await harness.client.callTool({
        name: "kakeai_schema_get",
        arguments: {},
      });
      expect(schema.isError).toBeUndefined();
      const schemaPayload = schema.structuredContent as {
        schemaDigest: string;
        operationDigest: string;
        minProtocolVersion: number;
        agentOperations: Array<{ name: string; kind: string; longRunning: boolean }>;
      };
      expect(schemaPayload.schemaDigest).toMatch(/^fnv1a64:/u);
      expect(schemaPayload.operationDigest).toMatch(/^fnv1a64:/u);
      expect(schemaPayload.minProtocolVersion).toBe(1);
      expect(schemaPayload.agentOperations).toHaveLength(agentOperationNames.length);

      const created = await harness.client.callTool({
        name: "kakeai_work_create",
        arguments: { title: "MCP 作品" },
      });
      expect(created.isError).toBeUndefined();
      const createdPayload = created.structuredContent as { work: { id: string } };
      expect(createdPayload.work.id).toBe("work-1");
      expect(textPayload(created)).toEqual(createdPayload);
      const edited = await harness.client.callTool({
        name: "kakeai_script_edit",
        arguments: {
          baseScriptVersionId: "scr-1",
          requestId: "edit-1",
          operations: [{ op: "scene.add", kind: "point", key: "scene-1" }],
        },
      });
      expect(edited.isError).toBeUndefined();
      const editedPayload = edited.structuredContent as {
        scriptVersion: { id: string; author: string };
      };
      expect(editedPayload.scriptVersion.id).toBe("scr-2");
      expect(editedPayload.scriptVersion.author).toBe("agent");
      expect(harness.operations).toEqual(["schema.get", "work.create", "script.edit"]);
    } finally {
      await harness.close();
    }
  });

  it("returns preview.scriptFrame bytes as an image block", async () => {
    const frame = {
      scriptVersionId: "scr-1",
      requestedTimeMs: 1500,
      durationMs: 9000,
      width: 320,
      height: 240,
      mimeType: "image/png",
      imageBase64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
    };
    const harness = await connectHarness((operation) => {
      if (operation === "preview.scriptFrame") {
        return frame;
      }
      throw new Error(`unexpected operation: ${operation}`);
    });
    try {
      const result = await harness.client.callTool({
        name: "kakeai_preview_script_frame",
        arguments: { scriptVersionId: "scr-1", timeMs: 1500 },
      });
      expect(result.isError).toBeUndefined();
      const { imageBase64: _omitted, ...metadata } = frame;
      expect(textPayload(result)).toEqual(metadata);
      expect(result.structuredContent).toEqual(frame);
      const content = result.content as Array<{
        type?: string;
        data?: string;
        mimeType?: string;
      }>;
      expect(content).toHaveLength(2);
      expect(content[1]).toEqual({
        type: "image",
        data: frame.imageBase64,
        mimeType: "image/png",
      });
    } finally {
      await harness.close();
    }
  });

  it("returns preview.assetFrame bytes with the source MIME type", async () => {
    const frame = {
      assetId: "ast-1",
      kind: "image",
      requestedTimeMs: null,
      resolvedTimeMs: null,
      width: 100,
      height: 80,
      mimeType: "image/jpeg",
      imageBase64: "/9j/4AAQSkZJRg==",
    };
    const harness = await connectHarness((operation) => {
      if (operation === "preview.assetFrame") {
        return frame;
      }
      throw new Error(`unexpected operation: ${operation}`);
    });
    try {
      const result = await harness.client.callTool({
        name: "kakeai_preview_asset_frame",
        arguments: { assetId: "ast-1" },
      });
      expect(result.isError).toBeUndefined();
      const { imageBase64: _omitted, ...metadata } = frame;
      expect(textPayload(result)).toEqual(metadata);
      expect(result.structuredContent).toEqual(frame);
      const content = result.content as Array<{
        type?: string;
        data?: string;
        mimeType?: string;
      }>;
      expect(content).toHaveLength(2);
      expect(content[1]).toEqual({
        type: "image",
        data: frame.imageBase64,
        mimeType: "image/jpeg",
      });
    } finally {
      await harness.close();
    }
  });

  it("strips image bytes from text even when the image block cannot be built", async () => {
    const malformed = {
      assetId: "ast-1",
      kind: "image",
      requestedTimeMs: null,
      resolvedTimeMs: null,
      width: 100,
      height: 80,
      imageBase64: "aGVsbG8=",
    };
    const harness = await connectHarness((operation) => {
      if (operation === "preview.assetFrame") {
        return malformed;
      }
      throw new Error(`unexpected operation: ${operation}`);
    });
    try {
      const result = await harness.client.callTool({
        name: "kakeai_preview_asset_frame",
        arguments: { assetId: "ast-1" },
      });
      expect(result.isError).toBeUndefined();
      expect(textPayload(result)).not.toHaveProperty("imageBase64");
      expect(result.structuredContent).toEqual(malformed);
      const content = result.content as Array<{ type?: string }>;
      expect(content).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it("does not add an image block for a non-PNG/JPEG asset MIME", async () => {
    const webp = {
      assetId: "ast-1",
      kind: "image",
      requestedTimeMs: null,
      resolvedTimeMs: null,
      width: 100,
      height: 80,
      mimeType: "image/webp",
      imageBase64: "UklGRg==",
    };
    const harness = await connectHarness((operation) => {
      if (operation === "preview.assetFrame") {
        return webp;
      }
      throw new Error(`unexpected operation: ${operation}`);
    });
    try {
      const result = await harness.client.callTool({
        name: "kakeai_preview_asset_frame",
        arguments: { assetId: "ast-1" },
      });
      expect(result.isError).toBeUndefined();
      expect(textPayload(result)).not.toHaveProperty("imageBase64");
      expect(result.structuredContent).toEqual(webp);
      const content = result.content as Array<{ type?: string }>;
      expect(content).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it("returns preview.frame bytes as an image block", async () => {
    const frame = {
      artifactId: "art-1",
      requestedTimeMs: 1500,
      resolvedTimeMs: 1500,
      width: 320,
      height: 240,
      mimeType: "image/png",
      pngBase64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
    };
    const harness = await connectHarness((operation) => {
      if (operation === "preview.frame") {
        return frame;
      }
      throw new Error(`unexpected operation: ${operation}`);
    });
    try {
      const result = await harness.client.callTool({
        name: "kakeai_preview_frame",
        arguments: { artifactId: "art-1", timeMs: 1500 },
      });
      expect(result.isError).toBeUndefined();
      const { pngBase64: _omitted, ...metadata } = frame;
      expect(textPayload(result)).toEqual(metadata);
      expect(result.structuredContent).toEqual(frame);
      const content = result.content as Array<{
        type?: string;
        data?: string;
        mimeType?: string;
      }>;
      expect(content).toHaveLength(2);
      expect(content[1]).toEqual({
        type: "image",
        data: frame.pngBase64,
        mimeType: "image/png",
      });
    } finally {
      await harness.close();
    }
  });

  it("forwards tts.create and keeps ttsResult through job_wait", async () => {
    const forwarded: unknown[] = [];
    let polls = 0;
    const harness = await connectHarness(
      (operation, input) => {
        if (operation === "tts.create") {
          forwarded.push(input);
          return { job: fixtureTtsJob("queued") };
        }
        if (operation === "job.get") {
          polls += 1;
          return { job: fixtureTtsJob(polls >= 2 ? "succeeded" : "running") };
        }
        throw new Error(`unexpected operation: ${operation}`);
      },
      { now: () => 0, sleep: async () => undefined },
    );
    try {
      const created = await harness.client.callTool({
        name: "kakeai_tts_create",
        arguments: { scriptVersionId: "scr-1", narrationSegmentId: "line-p1-1" },
      });
      expect(created.isError).toBeUndefined();
      // The binding applies the contract default before forwarding.
      expect(forwarded).toEqual([
        { scriptVersionId: "scr-1", narrationSegmentId: "line-p1-1", speedScale: 1 },
      ]);

      const waited = await harness.client.callTool({
        name: "kakeai_job_wait",
        arguments: { jobId: "job-tts-1", timeoutMs: 1000, intervalMs: 10 },
      });
      expect(waited.isError).toBeUndefined();
      const payload = waited.structuredContent as {
        job: { status: string; ttsResult: unknown };
      };
      expect(payload.job.status).toBe("succeeded");
      expect(payload.job.ttsResult).toEqual({
        narrationSegmentId: "line-p1-1",
        assetId: "asset-tts-1",
        durationMs: 1200,
        source: "tts",
      });
      expect(harness.operations).toEqual(["tts.create", "job.get", "job.get"]);
    } finally {
      await harness.close();
    }
  });

  it("maps every failure to a stable tool error without crashing", async () => {
    const harness = await connectHarness((operation) => {
      switch (operation) {
        case "work.list":
          throw new AgentClientError(AGENT_ERROR_CODES.APP_UNAVAILABLE);
        case "script.edit":
          throw new AgentClientError(AGENT_ERROR_CODES.SCRIPT_BASE_STALE, [
            {
              path: ["baseScriptVersionId"],
              code: "custom",
              message: "current と一致しません",
            },
          ]);
        case "job.get":
          throw new Error("boom: internal detail that must not leak");
        default:
          throw new Error(`unexpected operation: ${operation}`);
      }
    });
    try {
      const unknown = await harness.client.callTool({
        name: "kakeai_work_delete",
        arguments: { workId: "work-1" },
      });
      expectToolError(unknown, "MCP_TOOL_UNKNOWN");

      const unavailable = await harness.client.callTool({
        name: "kakeai_work_list",
        arguments: {},
      });
      expectToolError(unavailable, "AGENT_APP_UNAVAILABLE");

      const stale = await harness.client.callTool({
        name: "kakeai_script_edit",
        arguments: {
          baseScriptVersionId: "scr-old",
          requestId: "edit-stale",
          operations: [{ op: "scene.add", kind: "point" }],
        },
      });
      const stalePayload = expectToolError(stale, "SCRIPT_BASE_STALE");
      expect(stalePayload.issues).toHaveLength(1);

      const invalid = await harness.client.callTool({
        name: "kakeai_work_get",
        arguments: {},
      });
      const invalidPayload = expectToolError(invalid, "VALIDATION_ERROR");
      expect(invalidPayload.issues?.length).toBeGreaterThan(0);

      const internal = await harness.client.callTool({
        name: "kakeai_job_get",
        arguments: { jobId: "job-1" },
      });
      expectToolError(internal, "MCP_INTERNAL_ERROR");
      expect(JSON.stringify(textPayload(internal))).not.toContain("boom");
    } finally {
      await harness.close();
    }
  });

  it("polls job.get to completion and stops at the bounded budget", async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const statuses = ["queued", "running", "succeeded"] as const;
    let polls = 0;
    const harness = await connectHarness(
      (operation) => {
        if (operation !== "job.get") {
          throw new Error(`unexpected operation: ${operation}`);
        }
        const status = statuses[Math.min(polls, statuses.length - 1)];
        polls += 1;
        return { job: fixtureRenderJob(status) };
      },
      {
        now: () => clock,
        sleep: async (ms) => {
          sleeps.push(ms);
          clock += ms;
        },
      },
    );
    try {
      const waited = await harness.client.callTool({
        name: "kakeai_job_wait",
        arguments: { jobId: "job-1", timeoutMs: 1000, intervalMs: 10 },
      });
      expect(waited.isError).toBeUndefined();
      const payload = waited.structuredContent as {
        job: { status: string };
        timedOut: boolean;
        polls: number;
      };
      expect(payload.job.status).toBe("succeeded");
      expect(payload.timedOut).toBe(false);
      expect(payload.polls).toBe(3);
      expect(harness.operations).toEqual(["job.get", "job.get", "job.get"]);
      expect(sleeps).toEqual([10, 10]);
    } finally {
      await harness.close();
    }
  });

  it("returns the last job with timedOut when the budget expires", async () => {
    let clock = 0;
    const harness = await connectHarness(
      (operation) => {
        if (operation !== "job.get") {
          throw new Error(`unexpected operation: ${operation}`);
        }
        return { job: fixtureRenderJob("queued") };
      },
      {
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
      },
    );
    try {
      const waited = await harness.client.callTool({
        name: "kakeai_job_wait",
        arguments: { jobId: "job-1", timeoutMs: 20, intervalMs: 10 },
      });
      expect(waited.isError).toBeUndefined();
      const payload = waited.structuredContent as {
        job: { status: string };
        timedOut: boolean;
        polls: number;
      };
      expect(payload.job.status).toBe("queued");
      expect(payload.timedOut).toBe(true);
      expect(payload.polls).toBe(3);
    } finally {
      await harness.close();
    }
  });
});
