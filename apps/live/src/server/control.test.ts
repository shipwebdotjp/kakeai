import { mkdtemp, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_LIVE_COMMENTS_CONFIG,
  liveRuntimeConfigSchema,
  type LiveCharacterSheet,
} from "@kakeai/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { loadLivePackage } from "../package/loader.ts";
import { LiveController } from "../runtime/controller.ts";
import { createTestPackage, testRunConfig, type TestPackage } from "../testing/package-fixture.ts";
import { testV2Show } from "../testing/v2-show.ts";
import { createLiveServer, type LiveServer } from "./server.ts";
import { createControlStatus } from "./control.ts";

interface HttpResponse {
  status: number;
  body: unknown;
}

function request(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<HttpResponse> {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = httpRequest(
      url,
      { method: options.method ?? "GET", headers: options.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolvePromise({
            status: res.statusCode ?? 0,
            body: text.length === 0 ? null : (JSON.parse(text) as unknown),
          });
        });
      },
    );
    req.on("error", rejectPromise);
    req.end();
  });
}

const TOKEN = "control-token-for-test";

describe("live control plane", () => {
  let pkg: TestPackage | undefined;
  let server: LiveServer | undefined;
  let dataDir: string | undefined;

  afterEach(async () => {
    await server?.close().catch(() => undefined);
    server = undefined;
    await pkg?.cleanup().catch(() => undefined);
    pkg = undefined;
    if (dataDir !== undefined) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
  });

  async function start(token = TOKEN) {
    pkg = await createTestPackage({ includeCommentCorner: true });
    const loaded = await loadLivePackage(pkg.rootDir);
    dataDir = await mkdtemp(join(tmpdir(), "kakeai-live-control-"));
    const config = liveRuntimeConfigSchema.parse({
      llm: { mode: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "test", timeoutMs: 5000 },
      tts: { adapters: {}, timeoutMs: 20000, maxConcurrentTts: 2 },
      comments: { ...DEFAULT_LIVE_COMMENTS_CONFIG, ngWords: [] },
      port: 3020,
      dataDir,
    });
    server = await createLiveServer({
      package: loaded,
      config,
      port: 0,
      controlToken: token,
      runConfig: await testRunConfig(pkg),
    });
    return server;
  }

  it("requires the control token and reflects app/show state", async () => {
    const running = await start();
    const statusUrl = `${running.url}/control/status`;

    expect((await request(statusUrl)).status).toBe(401);
    expect(
      (
        await request(statusUrl, {
          headers: { Authorization: "Bearer wrong-token" },
        })
      ).status,
    ).toBe(401);

    const response = await request(statusUrl, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      runId: running.runStore.runId,
      ready: true,
      status: "ready",
      showStarted: false,
      showEnded: false,
      stageUrl: `${running.url}/stage`,
      consoleUrl: `${running.url}/console`,
    });

    running.controller.handleCommand({ kind: "start" });
    const started = await request(statusUrl, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(started.body).toMatchObject({
      status: "running",
      showStarted: true,
      showEnded: false,
    });
  });

  it("rejects a non-loopback Host even with a valid token", async () => {
    const running = await start();
    const response = await request(`${running.url}/control/status`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Host: "example.com",
      },
    });
    expect(response.status).toBe(403);
  });

  it("requests a graceful stop with the token and loopback Origin", async () => {
    let requested = false;
    pkg = await createTestPackage({ includeCommentCorner: true });
    const loaded = await loadLivePackage(pkg.rootDir);
    dataDir = await mkdtemp(join(tmpdir(), "kakeai-live-control-"));
    const config = liveRuntimeConfigSchema.parse({
      llm: { mode: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "test", timeoutMs: 5000 },
      tts: { adapters: {}, timeoutMs: 20000, maxConcurrentTts: 2 },
      comments: { ...DEFAULT_LIVE_COMMENTS_CONFIG, ngWords: [] },
      port: 3020,
      dataDir,
    });
    server = await createLiveServer({
      package: loaded,
      config,
      port: 0,
      controlToken: TOKEN,
      runConfig: await testRunConfig(pkg),
      onStopRequested: () => {
        requested = true;
      },
    });
    const response = await request(`${server.url}/control/stop`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Origin: server.url,
      },
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, status: "stopped" });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    expect(requested).toBe(true);

    const status = await request(`${server.url}/control/status`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(status.body).toMatchObject({ status: "stopped" });
  });

  it("disables /control for manual runs without a token", async () => {
    pkg = await createTestPackage({ includeCommentCorner: true });
    const loaded = await loadLivePackage(pkg.rootDir);
    dataDir = await mkdtemp(join(tmpdir(), "kakeai-live-control-"));
    const config = liveRuntimeConfigSchema.parse({
      llm: { mode: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "test", timeoutMs: 5000 },
      tts: { adapters: {}, timeoutMs: 20000, maxConcurrentTts: 2 },
      comments: { ...DEFAULT_LIVE_COMMENTS_CONFIG, ngWords: [] },
      port: 3020,
      dataDir,
    });
    server = await createLiveServer({
      package: loaded,
      config,
      port: 0,
      runConfig: await testRunConfig(pkg),
    });
    const response = await request(`${server.url}/control/status`);
    expect(response.status).toBe(404);
  });

  it("reports failure ahead of stopping", () => {
    const status = createControlStatus({
      token: TOKEN,
      runId: "run_1",
      stageUrl: "http://127.0.0.1:3020/stage",
      consoleUrl: "http://127.0.0.1:3020/console",
      startedAt: null,
      lifecycle: () => ({ phase: "error", started: false, ended: false }),
      isStopping: () => true,
      failure: () => ({ code: "live_failed", message: "失敗しました。" }),
      requestStop: () => undefined,
    });
    expect(status.status).toBe("failed");
    expect(status.failure?.code).toBe("live_failed");
  });
});

describe("stage startAt", () => {
  it("comes from the Live Run config, not the v2 show", () => {
    const characters: LiveCharacterSheet = {
      schemaVersion: 1,
      characters: [],
      faceSets: [],
    };
    const startAt = "2026-11-15T10:00:00.000Z";
    const controller = new LiveController({
      runId: "run_1",
      show: testV2Show(),
      characters,
      startAt,
    });
    expect(controller.getState().show.startAt).toBe(startAt);
    expect(testV2Show()).not.toHaveProperty("show.startAt");
  });
});
