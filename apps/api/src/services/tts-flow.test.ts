import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createInitialContentDocument, type VoiceProfile } from "@kakeai/contracts";
import type { AppConfig } from "../config.ts";
import { loadConfig } from "../config.ts";
import { createPrismaClient } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { applySqlitePragmas } from "../db/pragmas.ts";
import { ensureDataDirectories } from "../storage/paths.ts";
import { createWorker } from "../worker/index.ts";
import * as jobs from "./jobs.ts";
import * as scriptVersions from "./script-versions.ts";
import * as ttsJobs from "./tts-jobs.ts";
import * as voiceProfiles from "./voice-profiles.ts";
import * as works from "./works.ts";

const execFileAsync = promisify(execFile);
const SPEED = 1;

let dataDir: string;
let fixturesDir: string;
let config: AppConfig;
let prisma: ReturnType<typeof createPrismaClient>;
let worker: ReturnType<typeof createWorker>;
let server: Server;
let wavBuffer: Buffer;
let synthesisMode: "ok" | "fail" | "reject" = "ok";
let recordedSynthesisBody: Record<string, unknown> | null = null;
let recordedSpeakerParam: string | null = null;
let ffmpegReady = false;

const SPEAKERS = [
  {
    name: "四国めたん",
    speaker_uuid: "uuid-metantan",
    styles: [
      { name: "ノーマル", id: 2 },
      { name: "あまあま", id: 0 },
    ],
  },
];

function handleMock(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/speakers") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(SPEAKERS));
    return;
  }
  if (req.method === "GET" && url.pathname === "/version") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify("0.19.0"));
    return;
  }
  if (req.method === "POST" && url.pathname === "/audio_query") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ speedScale: 1, accent_phrases: [] }));
    return;
  }
  if (req.method === "POST" && url.pathname === "/synthesis") {
    recordedSpeakerParam = url.searchParams.get("speaker");
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        recordedSynthesisBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
          string,
          unknown
        >;
      } catch {
        recordedSynthesisBody = null;
      }
      if (synthesisMode === "fail") {
        res.statusCode = 500;
        res.end("engine failure");
        return;
      }
      if (synthesisMode === "reject") {
        res.statusCode = 422;
        res.end("invalid input");
        return;
      }
      res.setHeader("Content-Type", "audio/wav");
      res.end(wavBuffer);
    });
    return;
  }
  res.statusCode = 404;
  res.end();
}

async function drainWorker(): Promise<void> {
  while (await worker.runOnce()) {
    continue;
  }
}

async function createProfile(): Promise<VoiceProfile> {
  return voiceProfiles.createVoiceProfile(prisma, {
    name: "めたん",
    adapterId: "voicevox",
    settings: { speakerUuid: "uuid-metantan", defaultStyleId: 2 },
  });
}

async function createLineVersion(voiceProfileId: string): Promise<string> {
  const work = await works.createWork(prisma, `TTS作品-${Date.now()}-${Math.random()}`, "ja-JP");
  const edition = work.languageEditions[0]!;
  const content = createInitialContentDocument();
  content.speakers = [
    {
      id: "speaker-narrator",
      name: "ナレーター",
      characterId: null,
      voiceProfileId,
    },
  ];
  const point = content.scenes[1]!;
  if (point.kind !== "point") {
    throw new Error("expected a point scene");
  }
  point.lines = [
    {
      id: "line-tts",
      speakerId: "speaker-narrator",
      captionText: "こんにちは",
      speechText: "こんにちは",
      selectedAudioTakeId: null,
    },
  ];
  const saved = await scriptVersions.saveScriptVersion(prisma, edition.id, {
    sourceScriptVersionId: null,
    content,
  });
  return saved.scriptVersion.id;
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-tts-"));
  process.env.KAKEAI_DATA_DIR = dataDir;
  config = loadConfig();
  await ensureDataDirectories(config.directories);
  await runMigrations();
  prisma = createPrismaClient(config.databaseUrl);
  await applySqlitePragmas(prisma);
  worker = createWorker({ prisma, config });

  fixturesDir = await mkdtemp(join(tmpdir(), "kakeai-tts-fixtures-"));
  try {
    await execFileAsync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=2",
      "-c:a",
      "pcm_s16le",
      join(fixturesDir, "audio.wav"),
    ]);
    wavBuffer = await readFile(join(fixturesDir, "audio.wav"));
    ffmpegReady = true;
  } catch {
    ffmpegReady = false;
  }

  server = createServer(handleMock);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("mock server did not bind");
  }
  config.voicevoxBaseUrl = `http://127.0.0.1:${address.port}`;
}, 60000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
  delete process.env.KAKEAI_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
  await rm(fixturesDir, { recursive: true, force: true });
});

describe("voice profiles", () => {
  it("lists adapter voices with styles", async () => {
    const listing = await voiceProfiles.listAdapterVoices(config, "voicevox");
    expect(listing.voices).toEqual([
      {
        voiceId: "uuid-metantan",
        name: "四国めたん",
        styles: [
          { styleId: 2, name: "ノーマル" },
          { styleId: 0, name: "あまあま" },
        ],
      },
    ]);
  });

  it("rejects deletion of a referenced profile", async () => {
    const profile = await createProfile();
    await createLineVersion(profile.id);
    await expect(voiceProfiles.deleteVoiceProfile(prisma, profile.id)).rejects.toMatchObject({
      code: "VOICE_PROFILE_IN_USE",
    });
  });

  it("reports an unavailable engine", async () => {
    const previous = config.voicevoxBaseUrl;
    config.voicevoxBaseUrl = "http://127.0.0.1:1";
    try {
      await expect(
        voiceProfiles.listAdapterVoices(config, "voicevox"),
      ).rejects.toMatchObject({ code: "TTS_ENGINE_UNAVAILABLE" });
    } finally {
      config.voicevoxBaseUrl = previous;
    }
  });
});

describe("tts job", () => {
  it("generates a wav asset, applies speed, and records provenance", async () => {
    if (!ffmpegReady) {
      return;
    }
    synthesisMode = "ok";
    recordedSynthesisBody = null;
    const profile = await createProfile();
    const scriptVersionId = await createLineVersion(profile.id);

    const job = await ttsJobs.createTtsJob(prisma, config, scriptVersionId, "line-tts", {
      styleId: 0,
      speedScale: 0.75,
    });
    expect(job.kind).toBe("tts");
    expect(job.status).toBe("queued");
    expect(job.ttsResult).toBeNull();

    await drainWorker();
    const finished = await jobs.getJob(prisma, job.id);
    expect(finished.status).toBe("succeeded");
    expect(finished.ttsResult).not.toBeNull();
    expect(finished.ttsResult!.source).toBe("tts");
    expect(finished.ttsResult!.durationMs).toBeGreaterThan(0);

    expect(recordedSpeakerParam).toBe("0");
    expect((recordedSynthesisBody as { speedScale?: unknown } | null)?.speedScale).toBe(0.75);

    const asset = await prisma.asset.findUniqueOrThrow({
      where: { id: finished.ttsResult!.assetId },
    });
    expect(asset.kind).toBe("audio");
    expect(asset.origin).toBe("generated");
    expect(asset.status).toBe("ready");
    const provenance = JSON.parse(asset.provenanceJson ?? "{}") as Record<string, unknown>;
    expect(provenance).toMatchObject({
      adapterId: "voicevox",
      voiceId: "uuid-metantan",
      styleId: 0,
      speedScale: 0.75,
      engineVersion: "0.19.0",
      scriptVersionId,
      narrationSegmentId: "line-tts",
    });
  });

  it("reuses an existing asset for identical bytes", async () => {
    if (!ffmpegReady) {
      return;
    }
    synthesisMode = "ok";
    const profile = await createProfile();
    const scriptVersionId = await createLineVersion(profile.id);

    const first = await ttsJobs.createTtsJob(prisma, config, scriptVersionId, "line-tts", {
      styleId: 0,
      speedScale: 0.75,
    });
    await drainWorker();
    const firstDone = await jobs.getJob(prisma, first.id);
    const countAfterFirst = await prisma.asset.count();

    const second = await ttsJobs.createTtsJob(prisma, config, scriptVersionId, "line-tts", {
      styleId: 0,
      speedScale: 0.75,
    });
    await drainWorker();
    const secondDone = await jobs.getJob(prisma, second.id);

    expect(secondDone.status).toBe("succeeded");
    expect(secondDone.ttsResult!.assetId).toBe(firstDone.ttsResult!.assetId);
    expect(await prisma.asset.count()).toBe(countAfterFirst);
  });

  it("rejects empty speech text and an unknown segment", async () => {
    const work = await works.createWork(prisma, "TTS検証", "ja-JP");
    const edition = work.languageEditions[0]!;
    const content = createInitialContentDocument();
    const point = content.scenes[1]!;
    if (point.kind !== "point") {
      throw new Error("expected a point scene");
    }
    point.lines = [
      {
        id: "line-empty",
        speakerId: null,
        captionText: "",
        speechText: "   ",
        selectedAudioTakeId: null,
      },
    ];
    const saved = await scriptVersions.saveScriptVersion(prisma, edition.id, {
      sourceScriptVersionId: null,
      content,
    });

    await expect(
      ttsJobs.createTtsJob(prisma, config, saved.scriptVersion.id, "line-empty", {
        speedScale: SPEED,
      }),
    ).rejects.toMatchObject({ code: "TTS_INPUT_INVALID" });

    await expect(
      ttsJobs.createTtsJob(prisma, config, saved.scriptVersion.id, "line-missing", {
        speedScale: SPEED,
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });

  it("rejects a style outside the profile", async () => {
    const profile = await createProfile();
    const scriptVersionId = await createLineVersion(profile.id);
    await expect(
      ttsJobs.createTtsJob(prisma, config, scriptVersionId, "line-tts", {
        styleId: 99,
        speedScale: SPEED,
      }),
    ).rejects.toMatchObject({ code: "TTS_INPUT_INVALID" });
  });

  it("reports an unavailable engine at enqueue", async () => {
    const profile = await createProfile();
    const scriptVersionId = await createLineVersion(profile.id);
    const previous = config.voicevoxBaseUrl;
    config.voicevoxBaseUrl = "http://127.0.0.1:1";
    try {
      await expect(
        ttsJobs.createTtsJob(prisma, config, scriptVersionId, "line-tts", {
          speedScale: SPEED,
        }),
      ).rejects.toMatchObject({ code: "TTS_ENGINE_UNAVAILABLE" });
    } finally {
      config.voicevoxBaseUrl = previous;
    }
  });

  it("marks the job failed when the engine rejects the input", async () => {
    if (!ffmpegReady) {
      return;
    }
    const profile = await createProfile();
    const scriptVersionId = await createLineVersion(profile.id);
    synthesisMode = "reject";
    try {
      const job = await ttsJobs.createTtsJob(prisma, config, scriptVersionId, "line-tts", {
        speedScale: SPEED,
      });
      await drainWorker();
      const finished = await jobs.getJob(prisma, job.id);
      expect(finished.status).toBe("failed");
      expect(finished.error?.code).toBe("TTS_INPUT_REJECTED");
    } finally {
      synthesisMode = "ok";
    }
  });

  it("uses a request speech text override", async () => {
    const profile = await createProfile();
    const scriptVersionId = await createLineVersion(profile.id);
    const job = await ttsJobs.createTtsJob(prisma, config, scriptVersionId, "line-tts", {
      speechText: "べつのことば",
      speedScale: SPEED,
    });
    const row = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    const snapshot = JSON.parse(row.inputSnapshotJson) as { speechText?: string };
    expect(snapshot.speechText).toBe("べつのことば");
    await jobs.cancelJob(prisma, job.id);
  });

  it("rejects an empty request speech text", async () => {
    const profile = await createProfile();
    const scriptVersionId = await createLineVersion(profile.id);
    await expect(
      ttsJobs.createTtsJob(prisma, config, scriptVersionId, "line-tts", {
        speechText: "   ",
        speedScale: SPEED,
      }),
    ).rejects.toMatchObject({ code: "TTS_INPUT_INVALID" });
  });

  it("cancels a queued tts job", async () => {
    const profile = await createProfile();
    const scriptVersionId = await createLineVersion(profile.id);
    const job = await ttsJobs.createTtsJob(prisma, config, scriptVersionId, "line-tts", {
      speedScale: SPEED,
    });
    const cancelled = await jobs.cancelJob(prisma, job.id);
    expect(cancelled.status).toBe("cancelled");
  });
});
