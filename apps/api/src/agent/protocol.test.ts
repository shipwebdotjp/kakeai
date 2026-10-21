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
  protocol: { maxRequestBytes?: number; readTimeoutMs?: number; idleTimeoutMs?: number } = {},
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
});
