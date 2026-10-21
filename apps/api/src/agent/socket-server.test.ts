import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_PROTOCOL_VERSION } from "@kakeai/contracts";
import { listenAgentProtocol, type AgentSocketServer } from "./socket-server.ts";

const posix = process.platform !== "win32";
let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "kakeai-agent-socket-"));
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function start(socketPath: string): Promise<AgentSocketServer> {
  return listenAgentProtocol({
    socketPath,
    dispatch: async () => ({ ok: true }),
    operationKind: () => "read",
  });
}

async function openSocket(socketPath: string): Promise<Socket> {
  const socket = connect(socketPath);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("error", reject);
  });
  socket.setEncoding("utf8");
  return socket;
}

async function requestOverSocket(
  socket: Socket,
  frame: unknown,
): Promise<Record<string, unknown>> {
  socket.write(`${JSON.stringify(frame)}\n`);
  return new Promise((resolve, reject) => {
    socket.once("data", (chunk: string) => {
      try {
        resolve(JSON.parse(chunk) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
  });
}

describe("agent socket lifecycle", () => {
  it.skipIf(!posix)("creates the socket directory 0700 and the socket 0600", async () => {
    const socketPath = join(tempDir, "permissions", "agent.sock");
    const server = await start(socketPath);
    try {
      const directory = await lstat(join(tempDir, "permissions"));
      const socket = await lstat(socketPath);
      expect(directory.isDirectory()).toBe(true);
      expect(directory.mode & 0o777).toBe(0o700);
      expect(socket.isSocket()).toBe(true);
      expect(socket.mode & 0o777).toBe(0o600);
    } finally {
      await server.close();
    }
    await expect(lstat(socketPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses to unlink a live socket owned by another instance", async () => {
    const socketPath = join(tempDir, "live", "agent.sock");
    const first = await start(socketPath);
    try {
      await expect(start(socketPath)).rejects.toThrow(/使用中|in use/u);
    } finally {
      await first.close();
    }
  });

  it.skipIf(!posix)("removes a stale socket left by an exited process", async () => {
    const socketPath = join(tempDir, "stale", "agent.sock");
    await mkdir(join(tempDir, "stale"), { recursive: true });
    execFileSync(
      process.execPath,
      [
        "-e",
        'const net=require("node:net");const s=net.createServer();s.listen(process.argv[1],()=>process.exit(0));',
        socketPath,
      ],
      { stdio: "ignore" },
    );
    expect((await lstat(socketPath)).isSocket()).toBe(true);

    const server = await start(socketPath);
    try {
      expect((await lstat(socketPath)).isSocket()).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("does not delete a non-socket path", async () => {
    const socketPath = join(tempDir, "not-a-socket", "agent.sock");
    await mkdir(join(tempDir, "not-a-socket"), { recursive: true });
    await writeFile(socketPath, "keep me", "utf8");
    await expect(start(socketPath)).rejects.toThrow(/ソケットではありません/u);
    expect((await lstat(socketPath)).isFile()).toBe(true);
    await rm(join(tempDir, "not-a-socket"), { recursive: true, force: true });
  });

  it("keeps the configured protocol version", () => {
    expect(AGENT_PROTOCOL_VERSION).toBe(1);
  });

  it("closes connections above the cap and keeps the ones within it", async () => {
    const socketPath = join(tempDir, "cap", "agent.sock");
    const server = await listenAgentProtocol({
      socketPath,
      dispatch: async () => ({ ok: true }),
      operationKind: () => "read",
      maxConnections: 2,
    });
    try {
      const first = await openSocket(socketPath);
      const second = await openSocket(socketPath);

      // The connection above the cap is closed before the handshake, so it
      // never gets a protocol session.
      const third = connect(socketPath);
      const outcome = await new Promise<"closed" | "errored" | "answered">(
        (resolve) => {
          third.on("error", () => resolve("errored"));
          third.on("close", () => resolve("closed"));
          third.on("connect", () => {
            third.write(
              `${JSON.stringify({ protocolVersion: AGENT_PROTOCOL_VERSION })}\n`,
            );
            third.write(
              `${JSON.stringify({
                requestId: "req-1",
                operation: "work.list",
                input: {},
              })}\n`,
            );
            let received = "";
            third.on("data", (chunk: Buffer) => {
              received += chunk.toString("utf8");
              if (received.includes("\n")) {
                resolve("answered");
              }
            });
          });
        },
      );
      expect(["closed", "errored"]).toContain(outcome);

      // The connections within the cap are not affected.
      first.write(`${JSON.stringify({ protocolVersion: AGENT_PROTOCOL_VERSION })}\n`);
      const response = await requestOverSocket(first, {
        requestId: "req-2",
        operation: "work.list",
        input: {},
      });
      expect(response.ok).toBe(true);
      expect(response.requestId).toBe("req-2");

      second.write(`${JSON.stringify({ protocolVersion: AGENT_PROTOCOL_VERSION })}\n`);
      const other = await requestOverSocket(second, {
        requestId: "req-3",
        operation: "work.list",
        input: {},
      });
      expect(other.ok).toBe(true);
      expect(other.requestId).toBe("req-3");
    } finally {
      await server.close();
    }
  });
});
