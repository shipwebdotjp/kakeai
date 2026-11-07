import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_LIVE_COMMENTS_CONFIG,
  liveRuntimeConfigSchema,
  liveServerMessageSchema,
  type CommentCandidate,
  type ConsoleSnapshot,
  type LivePreloadCue,
  type LiveServerHelloMessage,
  type LiveServerLeaseMessage,
  type LiveServerMessage,
  type LiveServerPreloadMessage,
  type LiveServerSnapshotMessage,
  type LiveServerStateMessage,
  type StageState,
} from "@kakeai/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { CommentFilter } from "../comments/filter.ts";
import type { CommentAnalyst } from "../llm/comment-analyst.ts";
import { loadLivePackage } from "../package/loader.ts";
import { CommentCorner } from "../runtime/comment-corner.ts";
import { ManualCommentSource } from "../testing/manual-comment-source.ts";
import { createTestPackage, testShow } from "../testing/package-fixture.ts";
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

  waitForPreload(predicate: (cues: LivePreloadCue[]) => boolean = () => true) {
    return this.waitForMessage<LiveServerPreloadMessage>(
      "preload",
      (message) => predicate(message.cues),
    );
  }

  waitForLease(role: "program" | "preview"): Promise<LiveServerLeaseMessage> {
    return this.waitForMessage<LiveServerLeaseMessage>(
      "lease",
      (message) => message.lease.role === role,
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
  preview = false,
): Promise<TestWsClient> {
  const socket = new WebSocket(
    `ws://127.0.0.1:${port}/ws?role=${role}${preview ? "&preview=1" : ""}`,
    {
      headers: { Origin: `http://127.0.0.1:${port}`, ...headers },
    },
  );
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

function fixtureCandidate(commentId: string): CommentCandidate {
  return {
    commentId,
    score: 0.7,
    safety: "ok",
    relevance: "high",
    isQuestion: false,
    reason: "理由",
    suggestedAngle: "補足する",
    safeSummary: `要約: ${commentId}`,
    safeQuestion: `質問: ${commentId}`,
    safeQuote: null,
    piiRedacted: true,
    urlsRemoved: true,
  };
}

function testCommentCorner(): { corner: CommentCorner; source: ManualCommentSource } {
  const source = new ManualCommentSource();
  const analyst: CommentAnalyst = {
    sourceKind: "fixture",
    async analyze(comments) {
      return { comments: comments.map((comment) => fixtureCandidate(comment.event.id)) };
    },
  };
  const corner = new CommentCorner({
    source,
    analyst,
    filter: new CommentFilter({
      ngWords: [],
      blockedTopics: [],
      maxLength: 300,
      maxPerAuthorPerMinute: 3,
    }),
    commentsConfig: { ...DEFAULT_LIVE_COMMENTS_CONFIG, ngWords: [], cornerHoldMs: 50 },
    policy: testShow().commentPolicy,
    safety: { blockedTopics: [] },
    log: () => undefined,
    appendComment: () => undefined,
  });
  return { corner, source };
}

const tempRoots: string[] = [];
let server: LiveServer;
let packageRoot: string;
let distDir: string;
let commentCorner: CommentCorner;
let commentSource: ManualCommentSource;

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
  const injected = testCommentCorner();
  commentCorner = injected.corner;
  commentSource = injected.source;
  server = await createLiveServer({
    package: loaded,
    config: config(dataDir),
    port: 0,
    distDir,
    commentCorner,
  });
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
      commentCorner: testCommentCorner().corner,
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

  it("serves /stage?preview=1 and connects it as preview before program exists", async () => {
    const page = await request(`${server.url}/stage?preview=1`);
    expect(page.status).toBe(200);
    expect(page.body.toString("utf8")).toContain("stage-canvas");

    const preview = await connect(server.port, "stage", {}, true);
    const previewHello = await preview.waitForHello();
    expect(previewHello.lease?.role).toBe("preview");
    expect(server.controller.getStageConnections().every((entry) => entry.role === "preview")).toBe(
      true,
    );
    expect(server.controller.getStageConnections()[0]?.explicitPreview).toBe(true);

    const program = await connect(server.port, "stage");
    const programHello = await program.waitForHello();
    expect(programHello.lease?.role).toBe("program");
    expect(programHello.sessionId).not.toBe(previewHello.sessionId);

    preview.close();
    program.close();
  });

  it("advances on program audio_ended and ignores preview and duplicate events", async () => {
    const consoleClient = await connect(server.port, "console");
    await consoleClient.waitForHello();
    await consoleClient.waitForSnapshot();

    const program = await connect(server.port, "stage");
    const programHello = await program.waitForHello();
    const preview = await connect(server.port, "stage");
    const previewHello = await preview.waitForHello();
    expect(programHello.lease?.role).toBe("program");
    expect(previewHello.lease?.role).toBe("preview");

    consoleClient.send({ type: "command", command: { kind: "start" } });
    const opening = await program.waitForState(
      (state) => state.phase === "opening" && state.playback !== null,
    );
    const openingPlayback = opening.state.playback!;

    preview.send({
      type: "stage_event",
      event: {
        kind: "audio_ended",
        runId: previewHello.runId,
        sessionId: previewHello.sessionId,
        cueId: openingPlayback.cueId,
        attempt: openingPlayback.attempt,
        sequence: openingPlayback.sequence,
      },
    });
    program.send({
      type: "stage_event",
      event: {
        kind: "audio_ended",
        runId: programHello.runId,
        sessionId: programHello.sessionId,
        cueId: openingPlayback.cueId,
        attempt: openingPlayback.attempt,
        sequence: openingPlayback.sequence,
      },
    });

    const script = await program.waitForState(
      (state) => state.phase === "script" && state.playback?.cueId === "cue-script",
    );
    const scriptPlayback = script.state.playback!;
    expect(scriptPlayback.attempt).toBe(1);
    expect(scriptPlayback.sequence).toBeGreaterThan(openingPlayback.sequence);

    program.send({
      type: "stage_event",
      event: {
        kind: "audio_ended",
        runId: programHello.runId,
        sessionId: programHello.sessionId,
        cueId: openingPlayback.cueId,
        attempt: openingPlayback.attempt,
        sequence: openingPlayback.sequence,
      },
    });
    program.send({
      type: "stage_event",
      event: {
        kind: "audio_ended",
        runId: programHello.runId,
        sessionId: programHello.sessionId,
        cueId: scriptPlayback.cueId,
        attempt: scriptPlayback.attempt,
        sequence: scriptPlayback.sequence,
      },
    });
    await program.waitForState((state) => state.phase === "closing");

    program.close();
    preview.close();
    consoleClient.close();
  });

  it("sends preload messages for the next ready cues", async () => {
    const consoleClient = await connect(server.port, "console");
    await consoleClient.waitForHello();
    await consoleClient.waitForSnapshot();

    const stage = await connect(server.port, "stage");
    const hello = await stage.waitForHello();
    consoleClient.send({ type: "command", command: { kind: "start" } });

    const preload = await stage.waitForPreload((cues) => cues.length === 2);
    expect(preload.cues.map((cue) => cue.cueId)).toEqual(["cue-script", "cue-closing"]);

    const opening = await stage.waitForState(
      (state) => state.phase === "opening" && state.playback !== null,
    );
    const playback = opening.state.playback!;
    stage.send({
      type: "stage_event",
      event: {
        kind: "audio_ended",
        runId: hello.runId,
        sessionId: hello.sessionId,
        cueId: playback.cueId,
        attempt: playback.attempt,
        sequence: playback.sequence,
      },
    });
    const nextPreload = await stage.waitForPreload(
      (cues) => cues.length === 1 && cues[0]?.cueId === "cue-closing",
    );
    expect(nextPreload.cues[0]?.audioUrl).toBe("audio/prepared/cue-closing.wav");

    stage.close();
    consoleClient.close();
  });

  it("applies skip_cue from the console", async () => {
    const consoleClient = await connect(server.port, "console");
    await consoleClient.waitForHello();
    await consoleClient.waitForSnapshot();

    const stage = await connect(server.port, "stage");
    await stage.waitForHello();
    consoleClient.send({ type: "command", command: { kind: "start" } });
    await stage.waitForState((state) => state.phase === "opening");

    consoleClient.send({ type: "command", command: { kind: "skip_cue" } });
    const script = await stage.waitForState((state) => state.phase === "script");
    expect(script.state.playback?.cueId).toBe("cue-script");

    stage.close();
    consoleClient.close();
  });

  it("applies comment pins and shows them in the snapshot", async () => {
    const consoleClient = await connect(server.port, "console");
    await consoleClient.waitForHello();
    await consoleClient.waitForSnapshot();

    commentSource.emit({ id: "c1", author: "みかん", text: "質問です" });
    const received = await consoleClient.waitForSnapshot((snapshot) =>
      snapshot.comments.some((entry) => entry.comment.id === "c1"),
    );
    expect(received.snapshot.comments[0]?.pinned).toBe(false);

    consoleClient.send({
      type: "command",
      command: { kind: "pin_comment", commentId: "c1", note: "質問として" },
    });
    const pinned = await consoleClient.waitForSnapshot((snapshot) =>
      snapshot.comments.some((entry) => entry.comment.id === "c1" && entry.pinned),
    );
    expect(pinned.snapshot.comments[0]?.pinNote).toBe("質問として");

    consoleClient.send({
      type: "command",
      command: { kind: "unpin_comment", commentId: "c1" },
    });
    const unpinned = await consoleClient.waitForSnapshot(
      (snapshot) =>
        snapshot.comments.some((entry) => entry.comment.id === "c1") &&
        snapshot.comments.every((entry) => !entry.pinned),
    );
    expect(unpinned.snapshot.comments[0]?.pinned).toBe(false);
    consoleClient.close();
  });

  it("forwards set_live_chat to the comment source", async () => {
    const consoleClient = await connect(server.port, "console");
    await consoleClient.waitForHello();
    await consoleClient.waitForSnapshot();

    consoleClient.send({
      type: "command",
      command: { kind: "set_live_chat", liveChatId: "chat-2" },
    });
    const updated = await consoleClient.waitForSnapshot(
      (snapshot) => snapshot.commentSource.liveChatId === "chat-2",
    );
    expect(commentSource.getStatus().liveChatId).toBe("chat-2");
    expect(updated.snapshot.commentSource.kind).toBe("fixture");
    consoleClient.close();
  });

  it("pauses and resumes comment processing without stopping the source", async () => {
    const consoleClient = await connect(server.port, "console");
    await consoleClient.waitForHello();
    await consoleClient.waitForSnapshot();

    consoleClient.send({ type: "command", command: { kind: "pause_comments" } });
    await consoleClient.waitForSnapshot();
    consoleClient.send({ type: "command", command: { kind: "resume_comments" } });
    const resumed = await consoleClient.waitForSnapshot();
    expect(resumed.snapshot.commentCorner.state).toBe("idle");
    expect(commentSource.getStatus().state).not.toBe("stopped");
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
    const opening = await second.waitForState(
      (state) => state.phase === "opening" && state.playback !== null,
    );
    const before = opening.state.playback!;

    first.close();
    await consoleClient.waitForSnapshot(
      (snapshot) => snapshot.phase === "paused" && snapshot.stages.length === 1,
    );

    consoleClient.send({
      type: "command",
      command: { kind: "takeover_program", sessionId: secondHello.sessionId },
    });
    const secondLease = await second.waitForLease("program");
    expect(secondLease.lease.sessionId).toBe(secondHello.sessionId);
    expect(secondLease.lease.role).toBe("program");
    const takenOver = await consoleClient.waitForSnapshot(
      (snapshot) =>
        snapshot.stages[0]?.role === "program" &&
        snapshot.stages[0]?.sessionId === secondHello.sessionId,
    );
    expect(takenOver.snapshot.stages[0]?.sessionId).toBe(secondHello.sessionId);

    consoleClient.send({ type: "command", command: { kind: "resume" } });
    const resumed = await second.waitForState(
      (state) => state.phase === "opening" && (state.playback?.sequence ?? 0) > before.sequence,
    );
    expect(resumed.state.playback?.cueId).toBe(before.cueId);
    expect(resumed.state.playback?.attempt).toBe(before.attempt);

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
