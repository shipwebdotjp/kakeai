import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  liveRunConfigSchema,
  liveRuntimeConfigSchema,
  type LiveRunConfig,
  type LiveRuntimeConfig,
} from "@kakeai/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { YouTubeTokenMissingError, type YouTubeAccessTokenProvider } from "../auth/youtube-token.ts";
import { createCommentSource } from "./factory.ts";

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kakeai-live-comments-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function config(overrides: {
  dataDir: string;
  mode?: "local" | "external";
  baseUrl?: string;
  youtube?: {
    apiKey?: string;
    clientId?: string;
    clientSecret?: string;
    videoUrl?: string;
    liveChatId?: string;
  };
}): LiveRuntimeConfig {
  return liveRuntimeConfigSchema.parse({
    llm: {
      mode: overrides.mode ?? "local",
      baseUrl:
        overrides.baseUrl ??
        (overrides.mode === "external"
          ? "https://llm.example.com/v1"
          : "http://127.0.0.1:11434/v1"),
      model: "test-model",
    },
    tts: { adapters: {} },
    ...(overrides.youtube === undefined ? {} : { youtube: overrides.youtube }),
    port: 3010,
    dataDir: overrides.dataDir,
  });
}

async function writeFixture(root: string): Promise<string> {
  await mkdir(join(root, "fixtures"), { recursive: true });
  const path = join(root, "fixtures", "comments.json");
  await writeFile(
    path,
    JSON.stringify([{ atMs: 1_000, author: "みかん", text: "こんにちは" }]),
    "utf8",
  );
  return path;
}

async function runConfig(
  root: string,
  source:
    | { kind: "fixture" }
    | {
        kind: "youtube";
        videoUrl?: string | null;
        liveChatId?: string | null;
      },
): Promise<LiveRunConfig> {
  const fixturePath = source.kind === "fixture" ? await writeFixture(root) : undefined;
  return liveRunConfigSchema.parse({
    schemaVersion: 1,
    runId: "run-1",
    programVersionId: "program-version-1",
    package: {
      packageId: "livepkg-test",
      manifestSha256: "a".repeat(64),
      packagePath: root,
    },
    source:
      source.kind === "fixture"
        ? {
            kind: "fixture",
            fixturePath,
            fixtureSha256: createHash("sha256")
              .update(await readFile(fixturePath!, "utf8"))
              .digest("hex"),
          }
        : {
            kind: "youtube",
            videoUrl: source.videoUrl ?? "https://youtu.be/abcdefghijk",
            liveChatId: source.liveChatId ?? null,
          },
    startAt: null,
    requestedPort: 3010,
  });
}

function tokenProvider(): YouTubeAccessTokenProvider {
  return {
    getAccessToken: async () => "access-token",
    getAuthState: () => ({ authExpiresAt: null, needsReauth: false }),
  };
}

describe("createCommentSource", () => {
  it("uses the Run fixture without caring about the LLM mode", async () => {
    const root = await tempDir();
    const dataDir = await tempDir();
    const source = await createCommentSource({
      runConfig: await runConfig(root, { kind: "fixture" }),
      config: config({ dataDir, mode: "external" }),
    });
    expect(source.getStatus()).toMatchObject({ kind: "fixture", state: "idle" });
  });

  it("rejects a fixture whose SHA-256 does not match the Run", async () => {
    const root = await tempDir();
    const dataDir = await tempDir();
    const run = await runConfig(root, { kind: "fixture" });
    await writeFile(join(root, "fixtures", "comments.json"), "[]", "utf8");
    await expect(
      createCommentSource({ runConfig: run, config: config({ dataDir }) }),
    ).rejects.toThrow(/SHA-256/);
  });

  it("hashes and parses the fixture from a single read", async () => {
    const root = await tempDir();
    const dataDir = await tempDir();
    const fixtureJson = JSON.stringify([{ atMs: 1_000, author: "みかん", text: "こんにちは" }]);
    const run = liveRunConfigSchema.parse({
      schemaVersion: 1,
      runId: "run-1",
      programVersionId: "program-version-1",
      package: {
        packageId: "livepkg-test",
        manifestSha256: "a".repeat(64),
        packagePath: root,
      },
      source: {
        kind: "fixture",
        fixturePath: join(root, "fixtures", "comments.json"),
        fixtureSha256: createHash("sha256").update(fixtureJson).digest("hex"),
      },
      startAt: null,
      requestedPort: 3010,
    });
    let reads = 0;
    const source = await createCommentSource({
      runConfig: run,
      config: config({ dataDir }),
      readFixtureBytes: async () => {
        reads += 1;
        // A second read returns different bytes; hashing one read and parsing
        // another would be a TOCTOU bug.
        return Buffer.from(reads === 1 ? fixtureJson : "[]", "utf8");
      },
    });

    expect(reads).toBe(1);
    expect(source.getStatus()).toMatchObject({ kind: "fixture", state: "idle" });
  });

  it("does not fill a Run's null liveChatId from local youtube config", async () => {
    const root = await tempDir();
    const dataDir = await tempDir();
    const source = await createCommentSource({
      runConfig: await runConfig(root, {
        kind: "youtube",
        videoUrl: "https://youtu.be/run-source",
        liveChatId: null,
      }),
      config: config({
        dataDir,
        youtube: {
          apiKey: "api-key-1",
          videoUrl: "https://youtu.be/local-source",
          liveChatId: "chat-local",
        },
      }),
    });
    expect(source.getStatus().liveChatId).toBeNull();
  });

  it("rejects a fixture above the 10 MiB limit before parsing", async () => {
    const root = await tempDir();
    const dataDir = await tempDir();
    await expect(
      createCommentSource({
        runConfig: await runConfig(root, { kind: "fixture" }),
        config: config({ dataDir }),
        readFixtureBytes: async () => new Uint8Array(10 * 1024 * 1024 + 1),
      }),
    ).rejects.toThrow(/大きすぎます/);
  });

  it("rejects a real YouTube source with an external LLM", async () => {
    const root = await tempDir();
    const dataDir = await tempDir();
    await expect(
      createCommentSource({
        runConfig: await runConfig(root, { kind: "youtube", liveChatId: "chat-1" }),
        config: config({
          dataDir,
          mode: "external",
          youtube: { clientId: "c", clientSecret: "s" },
        }),
      }),
    ).rejects.toThrow(/ローカル LLM/);
  });

  it("rejects mode: local when the base URL is not loopback", async () => {
    const root = await tempDir();
    const dataDir = await tempDir();
    await expect(
      createCommentSource({
        runConfig: await runConfig(root, { kind: "youtube", liveChatId: "chat-1" }),
        config: config({
          dataDir,
          baseUrl: "https://llm.example.com/v1",
          youtube: { clientId: "c", clientSecret: "s" },
        }),
      }),
    ).rejects.toThrow(/ローカル LLM/);
  });

  it("requires YouTube config for a real source", async () => {
    const root = await tempDir();
    const dataDir = await tempDir();
    await expect(
      createCommentSource({
        runConfig: await runConfig(root, { kind: "youtube" }),
        config: config({ dataDir }),
      }),
    ).rejects.toThrow(/認証設定/);
  });

  it("requires a saved token for an OAuth-only source", async () => {
    const root = await tempDir();
    const dataDir = await tempDir();
    await expect(
      createCommentSource({
        runConfig: await runConfig(root, { kind: "youtube", liveChatId: "chat-1" }),
        config: config({
          dataDir,
          youtube: { clientId: "c", clientSecret: "s" },
        }),
      }),
    ).rejects.toBeInstanceOf(YouTubeTokenMissingError);
  });

  it("creates a real YouTube source with only an API key", async () => {
    const root = await tempDir();
    const dataDir = await tempDir();
    const source = await createCommentSource({
      runConfig: await runConfig(root, { kind: "youtube" }),
      config: config({
        dataDir,
        youtube: { apiKey: "api-key-1" },
      }),
    });
    expect(source.getStatus()).toMatchObject({
      kind: "youtube",
      state: "idle",
      authMode: "apiKey",
      fallbackAvailable: false,
    });
  });

  it("exposes the OAuth fallback without requiring a token up front", async () => {
    const root = await tempDir();
    const dataDir = await tempDir();
    const source = await createCommentSource({
      runConfig: await runConfig(root, { kind: "youtube" }),
      config: config({
        dataDir,
        youtube: {
          apiKey: "api-key-1",
          clientId: "c",
          clientSecret: "s",
        },
      }),
    });
    expect(source.getStatus()).toMatchObject({
      kind: "youtube",
      state: "idle",
      authMode: "apiKey",
      fallbackAvailable: true,
      authExpiresAt: null,
    });
  });

  it("creates a YouTube source without calling the API at construction", async () => {
    const root = await tempDir();
    const dataDir = await tempDir();
    let fetchCalls = 0;
    const source = await createCommentSource({
      runConfig: await runConfig(root, { kind: "youtube" }),
      config: config({
        dataDir,
        youtube: { clientId: "c", clientSecret: "s" },
      }),
      tokenProvider: tokenProvider(),
      fetch: async () => {
        fetchCalls += 1;
        return new Response("{}");
      },
    });
    expect(source.getStatus()).toMatchObject({
      kind: "youtube",
      state: "idle",
      liveChatId: null,
    });
    expect(fetchCalls).toBe(0);
  });
});
