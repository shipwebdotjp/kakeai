import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server, type Socket } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_PROTOCOL_VERSION } from "@kakeai/contracts";
import { AgentClientError, createAgentClient } from "./client.ts";

let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "kakeai-agent-client-"));
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

interface FrameReader {
  next: () => Promise<string>;
}

function reader(socket: Socket): FrameReader {
  let buffer = "";
  const lines: string[] = [];
  const waiters: Array<(line: string) => void> = [];
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) {
        return;
      }
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const waiter = waiters.shift();
      if (waiter === undefined) {
        lines.push(line);
      } else {
        waiter(line);
      }
    }
  });
  return {
    next: () => {
      const line = lines.shift();
      if (line !== undefined) {
        return Promise.resolve(line);
      }
      return new Promise<string>((resolve) => {
        waiters.push(resolve);
      });
    },
  };
}

async function startServer(
  socketPath: string,
  handler: (socket: Socket, frames: FrameReader) => void,
): Promise<Server> {
  const server = createServer((socket) => {
    handler(socket, reader(socket));
  });
  await new Promise<void>((resolve) => {
    server.listen(socketPath, () => resolve());
  });
  return server;
}

function stopServer(server: Server): Promise<void> {
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

describe("agent client", () => {
  it("handshakes, sends a typed request and validates the response", async () => {
    const socketPath = join(tempDir, "success.sock");
    const server = await startServer(socketPath, async (socket, frames) => {
      const handshake = JSON.parse(await frames.next()) as {
        protocolVersion: number;
        agentId?: string;
      };
      const request = JSON.parse(await frames.next()) as {
        requestId: string;
        operation: string;
        input: unknown;
      };
      expect(handshake.protocolVersion).toBe(AGENT_PROTOCOL_VERSION);
      expect(handshake.agentId).toBe("client-test");
      expect(request.operation).toBe("work.list");
      expect(request.input).toEqual({});
      socket.write(
        `${JSON.stringify({
          requestId: request.requestId,
          ok: true,
          data: { works: [] },
        })}\n`,
      );
    });
    try {
      const client = createAgentClient({ socketPath, agentId: "client-test" });
      const result = await client.request("work.list", {});
      expect(result.works).toEqual([]);
    } finally {
      await stopServer(server);
    }
  });

  it("maps a stable server error", async () => {
    const socketPath = join(tempDir, "error.sock");
    const server = await startServer(socketPath, async (socket, frames) => {
      await frames.next();
      const request = JSON.parse(await frames.next()) as { requestId: string };
      socket.write(
        `${JSON.stringify({
          requestId: request.requestId,
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            issues: [{ path: ["title"], code: "too_small", message: "title" }],
          },
        })}\n`,
      );
    });
    try {
      const client = createAgentClient({ socketPath });
      await expect(client.request("work.list", {})).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        issues: [{ path: ["title"], code: "too_small", message: "title" }],
      });
    } finally {
      await stopServer(server);
    }
  });

  it("returns AGENT_APP_UNAVAILABLE when the app is not running", async () => {
    const client = createAgentClient({
      socketPath: join(tempDir, "missing", "agent.sock"),
    });
    await expect(client.request("work.list", {})).rejects.toMatchObject({
      code: "AGENT_APP_UNAVAILABLE",
    });
  });

  it("never unlinks a stale socket file", async () => {
    const socketPath = join(tempDir, "stale.sock");
    await writeFile(socketPath, "stale", "utf8");
    const client = createAgentClient({ socketPath });
    await expect(client.request("work.list", {})).rejects.toBeInstanceOf(AgentClientError);
    expect(await readFile(socketPath, "utf8")).toBe("stale");
  });

  it("times out a read operation", async () => {
    const socketPath = join(tempDir, "timeout.sock");
    const server = await startServer(socketPath, () => {
      // Accept and never answer.
    });
    try {
      const client = createAgentClient({ socketPath, readTimeoutMs: 40 });
      await expect(client.request("schema.get", {})).rejects.toMatchObject({
        code: "AGENT_REQUEST_TIMEOUT",
      });
    } finally {
      await stopServer(server);
    }
  });
});
