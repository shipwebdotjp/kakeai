import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  liveAudioUrlSchema,
  liveRuntimeConfigSchema,
  type LiveRuntimeConfig,
  type LiveSpeaker,
  type TtsAdapter,
  type TtsSynthesisRequest,
} from "@kakeai/contracts";
import {
  generateGeneratedSpeech,
  GeneratedSpeechError,
  TtsNotConfiguredError,
} from "./generated-speech.ts";

const tempRoots: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function wavBytes(dataSize = 800): Uint8Array {
  const sampleRate = 8000;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return new Uint8Array(buffer);
}

function config(
  overrides: {
    adapterBaseUrl?: string;
    timeoutMs?: number;
    maxConcurrentTts?: number;
  } = {},
): LiveRuntimeConfig {
  return liveRuntimeConfigSchema.parse({
    llm: { mode: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "test-model" },
    tts: {
      adapters: {
        voicevox: { baseUrl: overrides.adapterBaseUrl ?? "http://127.0.0.1:50021" },
      },
      ...(overrides.timeoutMs === undefined ? {} : { timeoutMs: overrides.timeoutMs }),
      ...(overrides.maxConcurrentTts === undefined
        ? {}
        : { maxConcurrentTts: overrides.maxConcurrentTts }),
    },
    port: 3010,
    dataDir: "/tmp/kakeai-live-test",
  });
}

function speaker(refAudio?: string): LiveSpeaker {
  return {
    id: "speaker-left",
    name: "みかん",
    side: "left",
    characterId: null,
    voice: {
      adapterId: "voicevox",
      voiceId: "voice-1",
      speedScale: 1,
      settings: {},
      ...(refAudio === undefined ? {} : { refAudio }),
    },
  };
}

function fakeAdapter(
  synthesize: (request: TtsSynthesisRequest) => Promise<{ data: Uint8Array; mediaType: string }>,
): TtsAdapter {
  return {
    id: "voicevox",
    async listVoices() {
      return { voices: [], engineVersion: null };
    },
    synthesize: (_context, request) => synthesize(request),
  };
}

describe("generated speech", () => {
  it("writes a WAV under the run directory and returns a run URL", async () => {
    const runDir = await tempDir("kakeai-live-run-");
    const packageRoot = await tempDir("kakeai-live-pkg-");
    const requests: TtsSynthesisRequest[] = [];
    const result = await generateGeneratedSpeech({
      runDir,
      packageRoot,
      speaker: speaker(),
      text: "なるほど。",
      cueId: "cue-gen-1",
      config: config(),
      now: () => new Date("2026-11-07T12:00:00.000Z"),
      adapterFor: () =>
        fakeAdapter(async (request) => {
          requests.push(request);
          return { data: wavBytes(), mediaType: "audio/wav" };
        }),
    });

    expect(result.audio).toMatch(/^run:generated\/cue-gen-1-[a-z0-9]+\.wav$/u);
    expect(result.durationMs).toBe(50);
    expect(result.mediaType).toBe("audio/wav");
    expect(result.byteSize).toBe(44 + 800);
    expect(relative(join(runDir, "generated"), result.path)).not.toContain("..");
    expect((await readFile(result.path)).byteLength).toBe(result.byteSize);
    expect(requests[0]).toMatchObject({
      text: "なるほど。",
      voiceId: "voice-1",
      speedScale: 1,
    });
  });

  it("passes the package reference audio as an absolute path", async () => {
    const runDir = await tempDir("kakeai-live-run-");
    const packageRoot = await tempDir("kakeai-live-pkg-");
    await mkdir(join(packageRoot, "media", "voice"), { recursive: true });
    await writeFile(join(packageRoot, "media", "voice", "ref.wav"), wavBytes(), "utf8");
    const received: TtsSynthesisRequest[] = [];

    await generateGeneratedSpeech({
      runDir,
      packageRoot,
      speaker: speaker("media/voice/ref.wav"),
      text: "テスト",
      cueId: "cue-ref",
      config: config(),
      adapterFor: () =>
        fakeAdapter(async (request) => {
          received.push(request);
          return { data: wavBytes(), mediaType: "audio/wav" };
        }),
    });

    expect(received[0]?.refAudioPath).toBe(join(packageRoot, "media", "voice", "ref.wav"));
  });

  it("sanitizes cue ids so generated files stay inside the run directory", async () => {
    const runDir = await tempDir("kakeai-live-run-");
    const packageRoot = await tempDir("kakeai-live-pkg-");
    const result = await generateGeneratedSpeech({
      runDir,
      packageRoot,
      speaker: speaker(),
      text: "テスト",
      cueId: "../../escape",
      config: config(),
      adapterFor: () => fakeAdapter(async () => ({ data: wavBytes(), mediaType: "audio/wav" })),
    });
    const rel = relative(runDir, result.path);
    expect(rel.startsWith("generated/")).toBe(true);
    expect(rel).not.toContain("..");
    expect(liveAudioUrlSchema.safeParse(result.audio).success).toBe(true);
  });

  it("produces a contract-valid URL for non-ASCII cue ids", async () => {
    const runDir = await tempDir("kakeai-live-run-");
    const packageRoot = await tempDir("kakeai-live-pkg-");
    const result = await generateGeneratedSpeech({
      runDir,
      packageRoot,
      speaker: speaker(),
      text: "テスト",
      cueId: "コメント応答",
      config: config(),
      adapterFor: () => fakeAdapter(async () => ({ data: wavBytes(), mediaType: "audio/wav" })),
    });
    expect(liveAudioUrlSchema.safeParse(result.audio).success).toBe(true);
  });

  it("requires the adapter connection settings", async () => {
    const runDir = await tempDir("kakeai-live-run-");
    const packageRoot = await tempDir("kakeai-live-pkg-");
    await expect(
      generateGeneratedSpeech({
        runDir,
        packageRoot,
        speaker: speaker(),
        text: "テスト",
        cueId: "cue-1",
        config: liveRuntimeConfigSchema.parse({
          llm: { mode: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "m" },
          tts: { adapters: {} },
          port: 3010,
          dataDir: "/tmp/kakeai-live-test",
        }),
      }),
    ).rejects.toBeInstanceOf(TtsNotConfiguredError);
  });

  it("rejects non-loopback TTS endpoints", async () => {
    const runDir = await tempDir("kakeai-live-run-");
    const packageRoot = await tempDir("kakeai-live-pkg-");
    await expect(
      generateGeneratedSpeech({
        runDir,
        packageRoot,
        speaker: speaker(),
        text: "テスト",
        cueId: "cue-1",
        config: config({ adapterBaseUrl: "https://tts.example.com" }),
        adapterFor: () => fakeAdapter(async () => ({ data: wavBytes(), mediaType: "audio/wav" })),
      }),
    ).rejects.toBeInstanceOf(TtsNotConfiguredError);
  });

  it("wraps TTS failures and releases the semaphore", async () => {
    const runDir = await tempDir("kakeai-live-run-");
    const packageRoot = await tempDir("kakeai-live-pkg-");
    const shared = config({ maxConcurrentTts: 1 });
    let calls = 0;
    const adapterFor = (): TtsAdapter =>
      fakeAdapter(async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error("engine down");
        }
        return { data: wavBytes(), mediaType: "audio/wav" };
      });

    await expect(
      generateGeneratedSpeech({
        runDir,
        packageRoot,
        speaker: speaker(),
        text: "失敗",
        cueId: "cue-fail",
        config: shared,
        adapterFor,
      }),
    ).rejects.toMatchObject({ reason: "tts" });
    const result = await generateGeneratedSpeech({
      runDir,
      packageRoot,
      speaker: speaker(),
      text: "成功",
      cueId: "cue-ok",
      config: shared,
      adapterFor,
    });
    expect(result.durationMs).toBe(50);
  });

  it("times out without retrying", async () => {
    const runDir = await tempDir("kakeai-live-run-");
    const packageRoot = await tempDir("kakeai-live-pkg-");
    let calls = 0;
    await expect(
      generateGeneratedSpeech({
        runDir,
        packageRoot,
        speaker: speaker(),
        text: "遅い",
        cueId: "cue-slow",
        config: config({ timeoutMs: 10 }),
        adapterFor: () =>
          fakeAdapter(async () => {
            calls += 1;
            return new Promise<{ data: Uint8Array; mediaType: string }>(() => undefined);
          }),
      }),
    ).rejects.toMatchObject({ reason: "timeout" });
    expect(calls).toBe(1);
  });

  it("limits concurrent TTS calls across generateGeneratedSpeech callers", async () => {
    const runDir = await tempDir("kakeai-live-run-");
    const packageRoot = await tempDir("kakeai-live-pkg-");
    const shared = config({ maxConcurrentTts: 2 });
    let active = 0;
    let maxActive = 0;
    const adapterFor = (): TtsAdapter =>
      fakeAdapter(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 15));
        active -= 1;
        return { data: wavBytes(), mediaType: "audio/wav" };
      });

    const results = await Promise.all(
      [1, 2, 3].map((index) =>
        generateGeneratedSpeech({
          runDir,
          packageRoot,
          speaker: speaker(),
          text: "同時",
          cueId: `cue-${index}`,
          config: shared,
          adapterFor,
        }),
      ),
    );
    expect(results).toHaveLength(3);
    expect(maxActive).toBe(2);
  });

  it("rejects an invalid audio duration", async () => {
    const runDir = await tempDir("kakeai-live-run-");
    const packageRoot = await tempDir("kakeai-live-pkg-");
    await expect(
      generateGeneratedSpeech({
        runDir,
        packageRoot,
        speaker: speaker(),
        text: "壊れた音声",
        cueId: "cue-bad",
        config: config(),
        adapterFor: () =>
          fakeAdapter(async () => ({
            data: new Uint8Array([1, 2, 3]),
            mediaType: "audio/wav",
          })),
      }),
    ).rejects.toBeInstanceOf(GeneratedSpeechError);
  });
});
