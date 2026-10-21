import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, type Socket } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_ERROR_CODES,
  AGENT_PROTOCOL_MIN_VERSION,
  AGENT_PROTOCOL_VERSION,
  agentErrorResponseSchema,
  agentSuccessResponseSchema,
  type AgentErrorResponse,
  type AgentSuccessResponse,
} from "@kakeai/contracts";
import { AgentOperationError, agentIssue } from "./errors.ts";
import { listenAgentProtocol, type AgentSocketServer } from "./socket-server.ts";
import type { AgentDispatch } from "./protocol.ts";

class TestConnection {
  private buffer = "";
  private lines: string[] = [];
  private waiters: Array<(line: string) => void> = [];
  private ended = false;
  readonly closed: Promise<void>;

  private constructor(private readonly socket: Socket) {
    this.closed = new Promise<void>((resolve) => {
      socket.once("close", () => {
        this.ended = true;
        resolve();
      });
    });
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      for (;;) {
        const newline = this.buffer.indexOf("\n");
        if (newline < 0) {
          return;
        }
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        const waiter = this.waiters.shift();
        if (waiter === undefined) {
          this.lines.push(line);
        } else {
          waiter(line);
        }
      }
    });
  }

  static async open(socketPath: string): Promise<TestConnection> {
    const socket = connect(socketPath);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("error", reject);
    });
    return new TestConnection(socket);
  }

  send(frame: unknown): void {
    this.socket.write(`${JSON.stringify(frame)}\n`);
  }

  sendRaw(text: string): void {
    this.socket.write(text);
  }

  nextLine(timeoutMs = 2000): Promise<string> {
    const queued = this.lines.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    if (this.ended) {
      return Promise.reject(new Error("connection closed"));
    }
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("timed out waiting for a response line"));
      }, timeoutMs);
      this.waiters.push((line) => {
        clearTimeout(timer);
        resolve(line);
      });
    });
  }

  async nextResponse(): Promise<AgentSuccessResponse | AgentErrorResponse> {
    const line = await this.nextLine();
    const response = agentSuccessResponseSchema.safeParse(JSON.parse(line));
    if (response.success) {
      return response.data;
    }
    return agentErrorResponseSchema.parse(JSON.parse(line));
  }

  async nextError(): Promise<AgentErrorResponse> {
    const response = await this.nextResponse();
    if (response.ok) {
      throw new Error("expected an error response");
    }
    return response;
  }

  close(): void {
    this.socket.destroy();
  }
}

let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "kakeai-agent-protocol-"));
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function withServer(
  dispatch: AgentDispatch,
  run: (socketPath: string, server: AgentSocketServer) => Promise<void>,
  protocol: {
    maxRequestBytes?: number;
    readTimeoutMs?: number;
    idleTimeoutMs?: number;
    maxPendingFramesPerConnection?: number;
    maxPendingBytesPerConnection?: number;
  } = {},
): Promise<void> {
  const socketPath = join(tempDir, `agent-${Math.random().toString(16).slice(2)}.sock`);
  const server = await listenAgentProtocol({
    socketPath,
    dispatch,
    operationKind: () => "read",
    protocol,
  });
  try {
    await run(socketPath, server);
  } finally {
    await server.close();
  }
}

async function echoDispatch(operation: string, input: unknown): Promise<unknown> {
  return { operation, input };
}

describe("agent NDJSON protocol", () => {
  it("handshakes, echoes requestId and returns data", async () => {
    await withServer(echoDispatch, async (socketPath) => {
      const connection = await TestConnection.open(socketPath);
      connection.send({ protocolVersion: AGENT_PROTOCOL_VERSION, agentId: "agent-1" });
      connection.send({ requestId: "req-1", operation: "work.list", input: { a: 1 } });
      const response = await connection.nextResponse();
      expect(response.ok).toBe(true);
      expect(response.requestId).toBe("req-1");
      if (response.ok) {
        expect(response.data).toEqual({
          operation: "work.list",
          input: { a: 1 },
        });
      }
      connection.close();
    });
  });

  it("rejects an unknown protocol version and closes", async () => {
    await withServer(echoDispatch, async (socketPath) => {
      const connection = await TestConnection.open(socketPath);
      connection.send({ protocolVersion: 99 });
      const response = await connection.nextError();
      expect(response.requestId).toBe("");
      expect(response.error.code).toBe(AGENT_ERROR_CODES.PROTOCOL_MISMATCH);
      await connection.closed;
      connection.close();
    });
  });

  it("accepts a protocol version inside the supported range", async () => {
    await withServer(echoDispatch, async (socketPath) => {
      const connection = await TestConnection.open(socketPath);
      connection.send({
        protocolVersion: AGENT_PROTOCOL_MIN_VERSION,
        agentId: "agent-min",
      });
      connection.send({ requestId: "req-min", operation: "work.list", input: {} });
      const response = await connection.nextResponse();
      expect(response.ok).toBe(true);
      connection.close();
    });
  });

  it("rejects a protocol version below the supported range", async () => {
    await withServer(echoDispatch, async (socketPath) => {
      const connection = await TestConnection.open(socketPath);
      connection.send({ protocolVersion: AGENT_PROTOCOL_MIN_VERSION - 1 });
      const response = await connection.nextError();
      expect(response.error.code).toBe(AGENT_ERROR_CODES.PROTOCOL_MISMATCH);
      await connection.closed;
      connection.close();
    });
  });

  it("rejects a protocol version above the supported range", async () => {
    await withServer(echoDispatch, async (socketPath) => {
      const connection = await TestConnection.open(socketPath);
      connection.send({ protocolVersion: AGENT_PROTOCOL_VERSION + 1 });
      const response = await connection.nextError();
      expect(response.error.code).toBe(AGENT_ERROR_CODES.PROTOCOL_MISMATCH);
      await connection.closed;
      connection.close();
    });
  });

  it("rejects a malformed frame and closes", async () => {
    await withServer(echoDispatch, async (socketPath) => {
      const connection = await TestConnection.open(socketPath);
      connection.sendRaw("{not json\n");
      const response = await connection.nextError();
      expect(response.error.code).toBe(AGENT_ERROR_CODES.PROTOCOL_MISMATCH);
      await connection.closed;
      connection.close();
    });
  });

  it("rejects a malformed request envelope", async () => {
    await withServer(echoDispatch, async (socketPath) => {
      const connection = await TestConnection.open(socketPath);
      connection.send({ protocolVersion: AGENT_PROTOCOL_VERSION });
      connection.send({ operation: "work.list", input: {} });
      const response = await connection.nextError();
      expect(response.error.code).toBe(AGENT_ERROR_CODES.PROTOCOL_MISMATCH);
      await connection.closed;
      connection.close();
    });
  });

  it("maps a stable operation error and keeps the requestId", async () => {
    await withServer(
      async () => {
        throw new AgentOperationError(AGENT_ERROR_CODES.VALIDATION_ERROR, [
          agentIssue(["title"], "too_small", "title is required"),
        ]);
      },
      async (socketPath) => {
        const connection = await TestConnection.open(socketPath);
        connection.send({ protocolVersion: AGENT_PROTOCOL_VERSION });
        connection.send({ requestId: "req-2", operation: "work.create", input: {} });
        const response = await connection.nextError();
        expect(response.requestId).toBe("req-2");
        expect(response.error.code).toBe("VALIDATION_ERROR");
        expect(response.error.issues).toEqual([
          { path: ["title"], code: "too_small", message: "title is required" },
        ]);
        connection.close();
      },
    );
  });

  it("returns AGENT_OPERATION_UNKNOWN and keeps the connection", async () => {
    await withServer(
      async () => {
        throw new AgentOperationError(AGENT_ERROR_CODES.OPERATION_UNKNOWN);
      },
      async (socketPath) => {
        const connection = await TestConnection.open(socketPath);
        connection.send({ protocolVersion: AGENT_PROTOCOL_VERSION });
        connection.send({ requestId: "req-4", operation: "unknown.op", input: {} });
        const response = await connection.nextError();
        expect(response.requestId).toBe("req-4");
        expect(response.error.code).toBe(AGENT_ERROR_CODES.OPERATION_UNKNOWN);
        connection.close();
      },
    );
  });

  it("rejects a frame over the payload limit", async () => {
    await withServer(
      echoDispatch,
      async (socketPath) => {
        const connection = await TestConnection.open(socketPath);
        connection.send({ protocolVersion: AGENT_PROTOCOL_VERSION });
        await new Promise((resolve) => setTimeout(resolve, 20));
        connection.sendRaw("x".repeat(300));
        const response = await connection.nextError();
        expect(response.error.code).toBe(AGENT_ERROR_CODES.PAYLOAD_TOO_LARGE);
        await connection.closed;
        connection.close();
      },
      { maxRequestBytes: 128 },
    );
  });

  it("returns a timeout error instead of hanging", async () => {
    await withServer(
      () => new Promise(() => undefined),
      async (socketPath) => {
        const connection = await TestConnection.open(socketPath);
        connection.send({ protocolVersion: AGENT_PROTOCOL_VERSION });
        connection.send({ requestId: "req-3", operation: "schema.get", input: {} });
        const response = await connection.nextError();
        expect(response.requestId).toBe("req-3");
        expect(response.error.code).toBe(AGENT_ERROR_CODES.REQUEST_TIMEOUT);
        await connection.closed;
        connection.close();
      },
      { readTimeoutMs: 40 },
    );
  });

  it("answers frames above the pending limit with AGENT_BACKPRESSURE and keeps the connection", async () => {
    await withServer(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return { ok: true };
      },
      async (socketPath) => {
        const connection = await TestConnection.open(socketPath);
        connection.sendRaw(
          [
            JSON.stringify({ protocolVersion: AGENT_PROTOCOL_VERSION }),
            JSON.stringify({ requestId: "req-1", operation: "work.list", input: {} }),
            JSON.stringify({ requestId: "req-2", operation: "work.list", input: {} }),
            JSON.stringify({ requestId: "req-3", operation: "work.list", input: {} }),
            "",
          ].join("\n"),
        );

        const responses: Array<AgentSuccessResponse | AgentErrorResponse> = [];
        for (let index = 0; index < 3; index += 1) {
          responses.push(await connection.nextResponse());
        }
        const byRequestId = new Map(
          responses.map((response) => [response.requestId, response]),
        );
        // The frames that were queued keep running.
        expect(byRequestId.get("req-1")?.ok).toBe(true);
        expect(byRequestId.get("req-2")?.ok).toBe(true);
        // The frame above the limit is skipped, not executed.
        const rejected = byRequestId.get("req-3");
        expect(rejected?.ok).toBe(false);
        if (rejected !== undefined && !rejected.ok) {
          expect(rejected.error.code).toBe(AGENT_ERROR_CODES.BACKPRESSURE);
        }

        // The connection stays open and later requests are served normally.
        connection.send({ requestId: "req-4", operation: "work.list", input: {} });
        const later = await connection.nextResponse();
        expect(later.ok).toBe(true);
        expect(later.requestId).toBe("req-4");
        connection.close();
      },
      { maxPendingFramesPerConnection: 2 },
    );
  });

  it("processes a normal burst at the default limits without backpressure", async () => {
    await withServer(echoDispatch, async (socketPath) => {
      const connection = await TestConnection.open(socketPath);
      const count = 10;
      connection.sendRaw(
        [
          JSON.stringify({ protocolVersion: AGENT_PROTOCOL_VERSION }),
          ...Array.from({ length: count }, (_unused, index) =>
            JSON.stringify({
              requestId: `req-${index}`,
              operation: "work.list",
              input: {},
            }),
          ),
          "",
        ].join("\n"),
      );
      for (let index = 0; index < count; index += 1) {
        const response = await connection.nextResponse();
        expect(response.ok).toBe(true);
        expect(response.requestId).toBe(`req-${index}`);
      }
      connection.close();
    });
  });

  it("keeps serving a connection whose frames arrive in several chunks", async () => {
    await withServer(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { ok: true };
      },
      async (socketPath) => {
        const connection = await TestConnection.open(socketPath);
        connection.send({ protocolVersion: AGENT_PROTOCOL_VERSION });
        const count = 6;
        for (let index = 0; index < count; index += 1) {
          connection.send({
            requestId: `req-${index}`,
            operation: "work.list",
            input: {},
          });
          await new Promise((resolve) => setTimeout(resolve, 5));
        }

        // Every frame is answered exactly once, either executed or skipped.
        const answered = new Set<string>();
        for (let index = 0; index < count; index += 1) {
          const response = await connection.nextResponse();
          expect(answered.has(response.requestId)).toBe(false);
          answered.add(response.requestId);
          if (!response.ok) {
            expect(response.error.code).toBe(AGENT_ERROR_CODES.BACKPRESSURE);
          }
        }
        expect(answered.size).toBe(count);

        // The connection is still usable after the burst.
        connection.send({ requestId: "req-last", operation: "work.list", input: {} });
        const last = await connection.nextResponse();
        expect(last.ok).toBe(true);
        expect(last.requestId).toBe("req-last");
        connection.close();
      },
      { maxPendingFramesPerConnection: 2 },
    );
  });

  it("skips a frame that would exceed the pending byte budget", async () => {
    await withServer(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return { ok: true };
      },
      async (socketPath) => {
        const connection = await TestConnection.open(socketPath);
        connection.send({ protocolVersion: AGENT_PROTOCOL_VERSION });
        // The frame is larger than the whole byte budget of the connection.
        connection.send({
          requestId: "req-big",
          operation: "work.list",
          input: { padding: "x".repeat(200) },
        });
        const rejected = await connection.nextError();
        expect(rejected.requestId).toBe("req-big");
        expect(rejected.error.code).toBe(AGENT_ERROR_CODES.BACKPRESSURE);

        // A frame that fits is served normally.
        connection.send({ requestId: "req-small", operation: "work.list", input: {} });
        const served = await connection.nextResponse();
        expect(served.ok).toBe(true);
        expect(served.requestId).toBe("req-small");
        connection.close();
      },
      { maxPendingBytesPerConnection: 128 },
    );
  });
});
