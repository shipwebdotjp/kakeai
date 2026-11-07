import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  liveRuntimeConfigSchema,
  liveServerMessageSchema,
  type ConsoleSnapshot,
  type LiveServerHelloMessage,
  type LiveServerMessage,
  type LiveServerSnapshotMessage,
  type LiveServerStateMessage,
  type StageState,
} from "@kakeai/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { loadLivePackage } from "../package/loader.ts";
import { createTestPackage } from "../testing/package-fixture.ts";
import { createLiveServer, type LiveServer } from "./server.ts";

interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

function request(
  url: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): Promise<HttpResponse> {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = httpRequest(
      url,
      { method: options.method ?? "GET", headers: options.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolvePromise({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) });
        });
      },
    );
    req.on("error", rejectPromise);
    req.end();
  });
}

interface PendingWaiter {
  type: LiveServerMessage["type"];
  predicate: (message: LiveServerMessage) => boolean;
  resolve: (message: LiveServerMessage) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

class TestWsClient {
  private readonly messages: LiveServerMessage[] = [];
  private readonly pending: PendingWaiter[] = [];

  constructor(readonly socket: WebSocket) {
    socket.on("message", (data) => {
      const parsed = liveServerMessageSchema.safeParse(JSON.parse(String(data)) as unknown);
      if (!parsed.success) {
        return;
      }
      const index = this.pending.findIndex(
        (waiter) => waiter.type === parsed.data.type && waiter.predicate(parsed.data),
      );
      if (index >= 0) {
        const [waiter] = this.pending.splice(index, 1);
        if (waiter !== undefined) {
          clearTimeout(waiter.timer);
          waiter.resolve(parsed.data);
        }
        return;
      }
      this.messages.push(parsed.data);
    });
  }

  private waitForMessage<M extends LiveServerMessage>(
    type: M["type"],
    predicate: (message: M) => boolean,
    timeoutMs = 3000,
  ): Promise<M> {
    const existingIndex = this.messages.findIndex(
      (message) => message.type === type && predicate(message as M),
    );
    if (existingIndex >= 0) {
      const [message] = this.messages.splice(existingIndex, 1);
      return Promise.resolve(message as M);
    }
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        const index = this.pending.findIndex((waiter) => waiter.timer === timer);
        if (index >= 0) {
          this.pending.splice(index, 1);
        }
        rejectPromise(new Error(`WebSocket message timeout: ${type}`));
      }, timeoutMs);
      this.pending.push({
        type,
        predicate: predicate as (message: LiveServerMessage) => boolean,
        resolve: (message) => resolvePromise(message as M),
        reject: rejectPromise,
        timer,
      });
    });
  }

  waitForHello(): Promise<LiveServerHelloMessage> {
    return this.waitForMessage<LiveServerHelloMessage>("hello", () => true);
  }

  waitForSnapshot(predicate: (snapshot: ConsoleSnapshot) => boolean = () => true) {
    return this.waitForMessage<LiveServerSnapshotMessage>(
      "snapshot",
      (message) => predicate(message.snapshot),
    );
  }

  waitForState(predicate: (state: StageState) => boolean = () => true) {
    return this.waitForMessage<LiveServerStateMessage>(
      "state",
      (message) => predicate(message.state),
    );
  }

  send(value: unknown): void {
    this.socket.send(JSON.stringify(value));
  }

  close(): void {
    this.socket.terminate();
  }
}

async function connect(
  port: number,
  role: "stage" | "console",
  headers: Record<string, string> = {},
): Promise<TestWsClient> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?role=${role}`, {
    headers: { Origin: `http://127.0.0.1:${port}`, ...headers },
  });
  const client = new TestWsClient(socket);
  await new Promise<void>((resolvePromise, rejectPromise) => {
    socket.once("open", () => resolvePromise());
    socket.once("error", rejectPromise);
  });
  return client;
}

function config(dataDir: string) {
  return liveRuntimeConfigSchema.parse({
    llm: { mode: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "test-model" },
    tts: { adapters: {} },
    port: 3010,
    dataDir,
  });
}

const tempRoots: string[] = [];
let server: LiveServer;
let packageRoot: string;
let distDir: string;

async function makeTemp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

beforeEach(async () => {
  const pkg = await createTestPackage();
  packageRoot = pkg.rootDir;
  tempRoots.push(pkg.rootDir);
  distDir = await makeTemp("kakeai-live-dist-");
  await writeFile(join(distDir, "stage.html"), '<div id="stage-canvas"></div>', "utf8");
  await writeFile(join(distDir, "console.html"), '<div id="root"></div>', "utf8");
  await mkdir(join(distDir, "assets"), { recursive: true });
  await writeFile(join(distDir, "assets", "app.js"), "console.log('live');", "utf8");
  const loaded = await loadLivePackage(packageRoot);
  const dataDir = await makeTemp("kakeai-live-data-");
  server = await createLiveServer({ package: loaded, config: config(dataDir), port: 0, distDir });
});

afterEach(async () => {
  await server?.close();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("live HTTP server", () => {
  it("serves health, pages and manifest-listed package files", async () => {
    const health = await request(`${server.url}/healthz`);
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body.toString("utf8"))).toEqual({ ok: true });

    const stage = await request(`${server.url}/stage`);
    expect(stage.status).toBe(200);
    expect(stage.body.toString("utf8")).toContain("stage-canvas");

    const consolePage = await request(`${server.url}/console`);
    expect(consolePage.status).toBe(200);
    expect(consolePage.body.toString("utf8")).toContain('id="root"');

    const theme = await request(`${server.url}/package/theme.css`);
    expect(theme.status).toBe(200);
    expect(String(theme.headers["content-type"])).toContain("text/css");
    expect(String(theme.headers["cache-control"])).toContain("immutable");
    expect(theme.body.toString("utf8")).toContain("--kakeai-canvas");

    const show = await request(`${server.url}/package/show.json`);
    expect(show.status).toBe(200);
    expect(String(show.headers["content-type"])).toContain("application/json");

    expect((await request(`${server.url}/package/manifest.json`)).status).toBe(404);
  });

  it("rejects bad Host and Origin and requires Origin for POST", async () => {
    const badHost = await request(`${server.url}/healthz`, {
      headers: { Host: "evil.example:3010" },
    });
    expect(badHost.status).toBe(403);

    const badOrigin = await request(`${server.url}/healthz`, {
      headers: { Origin: "http://evil.example" },
    });
    expect(badOrigin.status).toBe(403);

    const noOrigin = await request(`${server.url}/healthz`, { method: "POST" });
    expect(noOrigin.status).toBe(403);

    const withOrigin = await request(`${server.url}/healthz`, {
      method: "POST",
      headers: { Origin: `http://127.0.0.1:${server.port}` },
    });
    expect(withOrigin.status).toBe(404);
  });

  it("refuses package path traversal", async () => {
    expect((await request(`${server.url}/package/%2e%2e%2fmanifest.json`)).status).toBe(404);
    expect((await request(`${server.url}/package/..%2fmanifest.json`)).status).toBe(404);
  });

  it("returns 503 until the UI is built", async () => {
    const emptyDist = await makeTemp("kakeai-live-empty-dist-");
    const loaded = await loadLivePackage(packageRoot);
    const dataDir = await makeTemp("kakeai-live-data-empty-");
    const extra = await createLiveServer({
      package: loaded,
      config: config(dataDir),
      port: 0,
      distDir: emptyDist,
    });
    try {
      const stage = await request(`${extra.url}/stage`);
      expect(stage.status).toBe(503);
      expect(stage.body.toString("utf8")).toContain("ビルド");
      expect((await request(`${extra.url}/assets/app.js`)).status).toBe(503);
    } finally {
      await extra.close();
    }
  });

  it("writes run metadata and append-only logs", async () => {
    server.controller.handleCommand({ kind: "start" });
    const runDir = server.runStore.dir;
    await server.close();
    const metadata = JSON.parse(await readFile(join(runDir, "run.json"), "utf8")) as {
      status: string;
      result: { status: string };
    };
    expect(metadata.status).toBe("finished");
    expect(metadata.result.status).toBe("stopped");
    const events = await readFile(join(runDir, "events.jsonl"), "utf8");
    expect(events).toContain("phase_changed");
    expect(events).toContain("pre_show");
  });
});

describe("live WebSocket server", () => {
  it("sends hello/state/snapshot and applies console commands", async () => {
    const consoleClient = await connect(server.port, "console");
    const consoleHello = await consoleClient.waitForHello();
    expect(consoleHello.role).toBe("console");
    expect(consoleHello.lease).toBeNull();
    expect(consoleHello.state.phase).toBe("pre_show");
    await consoleClient.waitForSnapshot();

    const stage1 = await connect(server.port, "stage");
    const hello1 = await stage1.waitForHello();
    expect(hello1.role).toBe("stage");
    expect(hello1.lease?.role).toBe("program");

    const stage2 = await connect(server.port, "stage");
    const hello2 = await stage2.waitForHello();
    expect(hello2.lease?.role).toBe("preview");

    await consoleClient.waitForSnapshot((snapshot) => snapshot.stages.length === 2);
    consoleClient.send({ type: "command", command: { kind: "start" } });
    const opening = await stage1.waitForState((state) => state.phase === "opening");
    expect(opening.state.playback?.cueId).toBe("cue-opening");

    stage1.close();
    stage2.close();
    consoleClient.close();
  });

  it("sends the latest state to a reconnected stage", async () => {
    const consoleClient = await connect(server.port, "console");
    await consoleClient.waitForHello();
    await consoleClient.waitForSnapshot();

    const stage = await connect(server.port, "stage");
    const hello = await stage.waitForHello();
    expect(hello.lease?.role).toBe("program");

    consoleClient.send({ type: "command", command: { kind: "start" } });
    await stage.waitForState((state) => state.phase === "opening");

    stage.close();
    const paused = await consoleClient.waitForSnapshot(
      (snapshot) => snapshot.phase === "paused" && snapshot.stages.length === 0,
    );
    expect(paused.snapshot.currentCueId).toBe("cue-opening");

    const reconnected = await connect(server.port, "stage");
    const reconnectedHello = await reconnected.waitForHello();
    expect(reconnectedHello.lease?.role).toBe("program");
    expect(reconnectedHello.state.phase).toBe("paused");
    expect(reconnectedHello.state.playback?.cueId).toBe("cue-opening");

    reconnected.close();
    consoleClient.close();
  });

  it("takes over program explicitly and resumes on the new stage", async () => {
    const consoleClient = await connect(server.port, "console");
    await consoleClient.waitForHello();
    await consoleClient.waitForSnapshot();

    const first = await connect(server.port, "stage");
    await first.waitForHello();
    const second = await connect(server.port, "stage");
    const secondHello = await second.waitForHello();
    expect(secondHello.lease?.role).toBe("preview");

    consoleClient.send({ type: "command", command: { kind: "start" } });
    await second.waitForState((state) => state.phase === "opening");

    first.close();
    await consoleClient.waitForSnapshot(
      (snapshot) => snapshot.phase === "paused" && snapshot.stages.length === 1,
    );

    consoleClient.send({
      type: "command",
      command: { kind: "takeover_program", sessionId: secondHello.sessionId },
    });
    const takenOver = await consoleClient.waitForSnapshot(
      (snapshot) =>
        snapshot.stages[0]?.role === "program" &&
        snapshot.stages[0]?.sessionId === secondHello.sessionId,
    );
    expect(takenOver.snapshot.stages[0]?.sessionId).toBe(secondHello.sessionId);

    consoleClient.send({ type: "command", command: { kind: "resume" } });
    await second.waitForState((state) => state.phase === "opening");

    second.close();
    consoleClient.close();
  });

  it("rejects WebSocket upgrades with a bad Host or Origin", async () => {
    const badOriginStatus = await new Promise<number>((resolvePromise, rejectPromise) => {
      const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws?role=stage`, {
        headers: { Origin: "http://evil.example" },
      });
      socket.once("unexpected-response", (_req, res) => {
        resolvePromise(res.statusCode ?? 0);
        socket.terminate();
      });
      socket.once("open", () => {
        rejectPromise(new Error("invalid origin was accepted"));
        socket.terminate();
      });
      socket.once("error", rejectPromise);
    });
    expect(badOriginStatus).toBe(403);

    const badHostStatus = await new Promise<number>((resolvePromise, rejectPromise) => {
      const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws?role=stage`, {
        headers: { Host: "evil.example:3010" },
      });
      socket.once("unexpected-response", (_req, res) => {
        resolvePromise(res.statusCode ?? 0);
        socket.terminate();
      });
      socket.once("open", () => {
        rejectPromise(new Error("invalid host was accepted"));
        socket.terminate();
      });
      socket.once("error", rejectPromise);
    });
    expect(badHostStatus).toBe(403);
  });
});
