import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultLiveRuntimeConfig,
  loadLiveRuntimeConfigFile,
  resolveLiveRuntimeConfig,
} from "./config.ts";

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kakeai-live-config-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function writeConfig(value: unknown): Promise<string> {
  const dir = await tempDir();
  const path = join(dir, "live.json");
  await writeFile(path, JSON.stringify(value), "utf8");
  return path;
}

describe("live runtime config", () => {
  it("applies defaults to an older config without comments, youtube or llm.timeoutMs", async () => {
    const dataDir = await tempDir();
    const path = await writeConfig({
      llm: { mode: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "test-model" },
      tts: { adapters: {} },
      port: 3010,
      dataDir,
    });
    const config = await loadLiveRuntimeConfigFile(path);
    expect(config.llm.timeoutMs).toBe(15_000);
    expect(config.youtube).toBeUndefined();
    expect(config.comments).toEqual({
      ngWords: [],
      maxLength: 300,
      maxPerAuthorPerMinute: 3,
      analysisBatchSize: 20,
      analysisTimeoutMs: 15_000,
      cornerHoldMs: 4_000,
    });
  });

  it("keeps explicit new values and fills the rest", async () => {
    const dataDir = await tempDir();
    const path = await writeConfig({
      llm: {
        mode: "local",
        baseUrl: "http://127.0.0.1:11434/v1",
        model: "test-model",
        timeoutMs: 7_000,
      },
      tts: { adapters: {} },
      youtube: {
        clientId: "client-1",
        clientSecret: "secret-1",
        videoUrl: "https://youtu.be/abcdefghijk",
        pollingIntervalMs: 12_000,
      },
      comments: { ngWords: ["宣伝"], maxLength: 120 },
      port: 3020,
      dataDir,
    });
    const config = await loadLiveRuntimeConfigFile(path);
    expect(config.llm.timeoutMs).toBe(7_000);
    expect(config.youtube).toMatchObject({
      clientId: "client-1",
      videoUrl: "https://youtu.be/abcdefghijk",
      pollingIntervalMs: 12_000,
    });
    expect(config.comments).toMatchObject({
      ngWords: ["宣伝"],
      maxLength: 120,
      analysisBatchSize: 20,
    });
  });

  it("rejects invalid new fields", async () => {
    const dataDir = await tempDir();
    const base = {
      llm: { mode: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "test-model" },
      tts: { adapters: {} },
      port: 3010,
      dataDir,
    };
    await expect(
      loadLiveRuntimeConfigFile(
        await writeConfig({ ...base, llm: { ...base.llm, timeoutMs: 0 } }),
      ),
    ).rejects.toThrow();
    await expect(
      loadLiveRuntimeConfigFile(await writeConfig({ ...base, comments: { maxLength: 0 } })),
    ).rejects.toThrow();
    await expect(
      loadLiveRuntimeConfigFile(await writeConfig({ ...base, comments: { unknown: true } })),
    ).rejects.toThrow();
  });

  it("returns the documented defaults and applies CLI overrides", async () => {
    const defaults = defaultLiveRuntimeConfig();
    expect(defaults.llm.mode).toBe("local");
    expect(defaults.llm.timeoutMs).toBe(15_000);
    expect(defaults.comments.cornerHoldMs).toBe(4_000);

    const dataDir = await tempDir();
    const resolved = resolveLiveRuntimeConfig(defaults, { port: 3099, dataDir });
    expect(resolved.port).toBe(3099);
    expect(resolved.dataDir).toBe(dataDir);
    expect(resolved.comments).toEqual(defaults.comments);
  });
});
