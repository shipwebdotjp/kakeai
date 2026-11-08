import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  livePackageShowSchema,
  liveRuntimeConfigSchema,
  type LivePackageShow,
  type LiveRuntimeConfig,
} from "@kakeai/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { YouTubeTokenMissingError, type YouTubeAccessTokenProvider } from "../auth/youtube-token.ts";
import { testShow } from "../testing/package-fixture.ts";
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

function showWithFixture(): LivePackageShow {
  return livePackageShowSchema.parse({
    ...testShow(),
    test: { fixture: "fixtures/comments.json" },
  });
}

async function writeFixture(root: string): Promise<void> {
  await mkdir(join(root, "fixtures"), { recursive: true });
  await writeFile(
    join(root, "fixtures", "comments.json"),
    JSON.stringify([{ atMs: 1_000, author: "みかん", text: "こんにちは" }]),
    "utf8",
  );
}

function tokenProvider(): YouTubeAccessTokenProvider {
  return {
    getAccessToken: async () => "access-token",
    getAuthState: () => ({ authExpiresAt: null, needsReauth: false }),
  };
}

describe("createCommentSource", () => {
  it("uses the fixture in test mode and allows an external LLM", async () => {
    const packageRoot = await tempDir();
    const dataDir = await tempDir();
    await writeFixture(packageRoot);

    const source = await createCommentSource({
      show: showWithFixture(),
      packageRoot,
      testMode: true,
      config: config({ dataDir, mode: "external" }),
    });
    expect(source.getStatus()).toMatchObject({ kind: "fixture", state: "idle" });
  });

  it("uses an empty fixture when test mode has no fixture", async () => {
    const packageRoot = await tempDir();
    const dataDir = await tempDir();
    const source = await createCommentSource({
      show: testShow(),
      packageRoot,
      testMode: true,
      config: config({ dataDir }),
    });
    expect(source.getStatus().kind).toBe("fixture");
  });

  it("uses the fixture source when the show selects fixture", async () => {
    const packageRoot = await tempDir();
    const dataDir = await tempDir();
    await writeFixture(packageRoot);
    const show = livePackageShowSchema.parse({
      ...showWithFixture(),
      commentSource: { kind: "fixture" },
    });
    const source = await createCommentSource({
      show,
      packageRoot,
      config: config({ dataDir, mode: "external" }),
    });
    expect(source.getStatus().kind).toBe("fixture");
  });

  it("rejects a real YouTube source with an external LLM", async () => {
    const packageRoot = await tempDir();
    const dataDir = await tempDir();
    await expect(
      createCommentSource({
        show: testShow(),
        packageRoot,
        config: config({
          dataDir,
          mode: "external",
          youtube: { clientId: "c", clientSecret: "s", liveChatId: "chat-1" },
        }),
      }),
    ).rejects.toThrow(/ローカル LLM/);
  });

  it("rejects mode: local when the base URL is not loopback", async () => {
    const packageRoot = await tempDir();
    const dataDir = await tempDir();
    await expect(
      createCommentSource({
        show: testShow(),
        packageRoot,
        config: config({
          dataDir,
          baseUrl: "https://llm.example.com/v1",
          youtube: { clientId: "c", clientSecret: "s", liveChatId: "chat-1" },
        }),
      }),
    ).rejects.toThrow(/ローカル LLM/);
  });

  it("requires YouTube config for a real source", async () => {
    const packageRoot = await tempDir();
    const dataDir = await tempDir();
    await expect(
      createCommentSource({
        show: testShow(),
        packageRoot,
        config: config({ dataDir }),
      }),
    ).rejects.toThrow(/youtube/);
  });

  it("requires a saved token for an OAuth-only source", async () => {
    const packageRoot = await tempDir();
    const dataDir = await tempDir();
    await expect(
      createCommentSource({
        show: testShow(),
        packageRoot,
        config: config({
          dataDir,
          youtube: { clientId: "c", clientSecret: "s", liveChatId: "chat-1" },
        }),
      }),
    ).rejects.toBeInstanceOf(YouTubeTokenMissingError);
  });

  it("creates a real YouTube source with only an API key", async () => {
    const packageRoot = await tempDir();
    const dataDir = await tempDir();
    const source = await createCommentSource({
      show: testShow(),
      packageRoot,
      config: config({
        dataDir,
        youtube: { apiKey: "api-key-1", videoUrl: "https://youtu.be/abcdefghijk" },
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
    const packageRoot = await tempDir();
    const dataDir = await tempDir();
    const source = await createCommentSource({
      show: testShow(),
      packageRoot,
      config: config({
        dataDir,
        youtube: {
          apiKey: "api-key-1",
          clientId: "c",
          clientSecret: "s",
          videoUrl: "https://youtu.be/abcdefghijk",
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
    const packageRoot = await tempDir();
    const dataDir = await tempDir();
    let fetchCalls = 0;
    const source = await createCommentSource({
      show: testShow(),
      packageRoot,
      config: config({
        dataDir,
        youtube: { clientId: "c", clientSecret: "s", videoUrl: "https://youtu.be/abcdefghijk" },
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
