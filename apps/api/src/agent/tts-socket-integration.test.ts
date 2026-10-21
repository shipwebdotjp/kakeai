import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  createInitialContentDocument,
  type ContentDocument,
  type Job,
} from "@kakeai/contracts";
import {
  AgentClientError,
  createAgentClient,
  createJobGetter,
  waitForJob,
  type AgentClient,
} from "@kakeai/agent-client";
import type { AppConfig } from "../config.ts";
import { loadConfig } from "../config.ts";
import { createPrismaClient } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { applySqlitePragmas } from "../db/pragmas.ts";
import { FakeFontCatalogAdapter, FontCatalogService } from "../services/font-catalog.ts";
import { createVoiceProfile } from "../services/voice-profiles.ts";
import { ensureDataDirectories } from "../storage/paths.ts";
import { createWorker } from "../worker/index.ts";
import {
  startMockVoicevoxServer,
  wavFixture,
  type MockVoicevoxServer,
} from "../testing/tts-mocks.ts";
import { startAgentSocketServer, type AgentSocketServer } from "./socket-server.ts";

const VOICEVOX_SPEAKERS = [
  {
    name: "四国めたん",
    speaker_uuid: "uuid-metantan",
    styles: [{ name: "ノーマル", id: 2 }],
  },
];

const AIVIS_SPEAKERS = [
  {
    name: "Aivis話者",
    speaker_uuid: "uuid-aivis",
    styles: [{ name: "ノーマル", id: -1 }],
  },
];

const VOICEVOX_VOICE_ID = "uuid-metantan:2";
const AIVIS_VOICE_ID = "uuid-aivis:-1";
const OPENAI_VOICE_ID = "af_heart";
const OPENAI_MODEL = "kokoro";

const openAiCounters = { speech: 0, voices: 0 };

function resetCounters(): void {
  voicevoxMock.resetCounters();
  aivisspeechMock.resetCounters();
  openAiCounters.speech = 0;
  openAiCounters.voices = 0;
}

function json(res: ServerResponse, value: unknown): void {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(value));
}

function wav(res: ServerResponse, buffer: Buffer): void {
  res.setHeader("Content-Type", "audio/wav");
  res.end(buffer);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

let dataDir: string;
let config: AppConfig;
let prisma: ReturnType<typeof createPrismaClient>;
let worker: ReturnType<typeof createWorker>;
let agentServer: AgentSocketServer;
let client: AgentClient;
let voicevoxMock: MockVoicevoxServer;
let aivisspeechMock: MockVoicevoxServer;
let openAiServer: Server;

const voicevoxWav = wavFixture(1000, 440);
const aivisspeechWav = wavFixture(1250, 550);
const openAiWav = wavFixture(1500, 660);

let voicevoxProfileId: string;
let aivisspeechProfileId: string;
let openAiProfileId: string;

function handleOpenAi(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/v1/models") {
    json(res, { data: [{ id: OPENAI_MODEL }] });
    return;
  }
  if (req.method === "GET" && url.pathname === "/v1/audio/voices") {
    openAiCounters.voices += 1;
    if (url.searchParams.get("model") !== OPENAI_MODEL) {
      res.statusCode = 404;
      res.end();
      return;
    }
    json(res, { data: [{ id: OPENAI_VOICE_ID, name: "Heart" }] });
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/audio/speech") {
    openAiCounters.speech += 1;
    void readBody(req).then(() => wav(res, openAiWav));
    return;
  }
  res.statusCode = 404;
  res.end();
}

async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<Server> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

function baseUrlOf(server: Server): string {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("mock TTS server did not bind");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function drainWorker(): Promise<void> {
  while (await worker.runOnce()) {
    continue;
  }
}

async function expectAgentError(promise: Promise<unknown>, code: string): Promise<AgentClientError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AgentClientError);
    expect((error as AgentClientError).code).toBe(code);
    return error as AgentClientError;
  }
  throw new Error(`expected ${code}`);
}

interface SetupLine {
  id: string;
  speakerId: string | null;
  speechText: string;
}

interface SavedTtsScript {
  editionId: string;
  scriptVersionId: string;
  sceneId: string;
}

/**
 * Creates a Work through the socket and saves a point-scene script with the
 * requested lines, using the three adapter-backed speakers created in
 * `beforeAll`.
 */
async function saveTtsScript(
  lines: SetupLine[],
  mutate?: (content: ContentDocument) => void,
): Promise<SavedTtsScript> {
  const created = await client.request("work.create", { title: `TTS統合-${randomUUID()}` });
  const edition = created.work.languageEditions[0]!;
  const content = createInitialContentDocument();
  content.speakers = [
    { id: "speaker-vv", name: "ぶい", characterId: null, voiceProfileId: voicevoxProfileId },
    { id: "speaker-av", name: "えーぶい", characterId: null, voiceProfileId: aivisspeechProfileId },
    {
      id: "speaker-oai",
      name: "おーえーあい",
      characterId: null,
      voiceProfileId: openAiProfileId,
    },
  ];
  const scene = content.scenes.find((entry) => entry.kind === "point");
  if (scene === undefined) {
    throw new Error("point scene missing");
  }
  scene.lines = lines.map((line) => ({
    id: line.id,
    speakerId: line.speakerId,
    captionText: line.speechText,
    speechText: line.speechText,
    selectedAudioTakeId: null,
    expressionId: null,
  }));
  mutate?.(content);
  const saved = await client.request("script.save", {
    languageEditionId: edition.id,
    content,
  });
  return {
    editionId: edition.id,
    scriptVersionId: saved.scriptVersion.id,
    sceneId: scene.id,
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

function ttsResultOf(job: Job): NonNullable<Job["ttsResult"]> {
  if (job.ttsResult === null) {
    throw new Error("expected a ttsResult");
  }
  return job.ttsResult;
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-agent-tts-"));
  process.env.KAKEAI_DATA_DIR = dataDir;
  config = loadConfig();
  await ensureDataDirectories(config.directories);
  await runMigrations();
  prisma = createPrismaClient(config.databaseUrl);
  await applySqlitePragmas(prisma);
  worker = createWorker({ prisma, config });

  voicevoxMock = await startMockVoicevoxServer({
    speakers: VOICEVOX_SPEAKERS,
    wav: voicevoxWav,
    audioQuery: { speedScale: 1, accent_phrases: [] },
    engineVersion: "0.19.0",
  });
  aivisspeechMock = await startMockVoicevoxServer({
    speakers: AIVIS_SPEAKERS,
    wav: aivisspeechWav,
    audioQuery: { speedScale: 1, intonationScale: 2, tempoDynamicsScale: 1.5 },
    engineVersion: "1.0.0",
  });
  openAiServer = await listen(handleOpenAi);
  config.voiceBaseUrls.voicevox = voicevoxMock.baseUrl;
  config.voiceBaseUrls.aivisspeech = aivisspeechMock.baseUrl;
  config.voiceBaseUrls["openai-compatible"] = baseUrlOf(openAiServer);

  voicevoxProfileId = (
    await createVoiceProfile(prisma, {
      name: "めたん",
      adapterId: "voicevox",
      voiceId: VOICEVOX_VOICE_ID,
      locale: "ja-JP",
      settings: {},
    })
  ).id;
  aivisspeechProfileId = (
    await createVoiceProfile(prisma, {
      name: "Aivis",
      adapterId: "aivisspeech",
      voiceId: AIVIS_VOICE_ID,
      locale: "ja-JP",
      settings: {},
    })
  ).id;
  openAiProfileId = (
    await createVoiceProfile(prisma, {
      name: "Kokoro",
      adapterId: "openai-compatible",
      voiceId: OPENAI_VOICE_ID,
      locale: "en-US",
      settings: { model: OPENAI_MODEL },
    })
  ).id;

  agentServer = await startAgentSocketServer({
    config,
    prisma,
    fontCatalogService: new FontCatalogService(new FakeFontCatalogAdapter()),
  });
  client = createAgentClient({ dataRoot: config.dataRoot, agentId: "tts-e2e-agent" });
}, 60000);

afterAll(async () => {
  await agentServer.close();
  await prisma.$disconnect();
  await voicevoxMock.close();
  await aivisspeechMock.close();
  await closeServer(openAiServer);
  delete process.env.KAKEAI_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe("agent tts operations over the socket", () => {
  it("catalogs tts.create and tts.createBulk as long-running mutations", async () => {
    const schema = await client.request("schema.get", {});
    expect(schema.agentOperations).toContainEqual({
      name: "tts.create",
      kind: "mutation",
      longRunning: true,
    });
    expect(schema.agentOperations).toContainEqual({
      name: "tts.createBulk",
      kind: "mutation",
      longRunning: true,
    });
    expect(schema.schemaDigest).toMatch(/^fnv1a64:/u);
  });

  it("creates one Job per adapter and returns ttsResult through job.get and job.wait", async () => {
    resetCounters();
    const script = await saveTtsScript([
      { id: "line-vv", speakerId: "speaker-vv", speechText: "こんにちは" },
      { id: "line-av", speakerId: "speaker-av", speechText: "おはよう" },
      { id: "line-oai", speakerId: "speaker-oai", speechText: "hello" },
    ]);

    const created: Array<{ segmentId: string; job: Job }> = [];
    for (const [segmentId, speedScale] of [
      ["line-vv", undefined],
      ["line-av", 1.25],
      ["line-oai", 0.75],
    ] as const) {
      const result = await client.request("tts.create", {
        scriptVersionId: script.scriptVersionId,
        narrationSegmentId: segmentId,
        ...(speedScale === undefined ? {} : { speedScale }),
      });
      expect(result.job.kind).toBe("tts");
      expect(result.job.status).toBe("queued");
      expect(result.job.scriptVersionId).toBe(script.scriptVersionId);
      created.push({ segmentId, job: result.job });
    }

    // The omitted speed falls back to the shared contract default (1.0).
    const firstRow = await prisma.job.findUniqueOrThrow({
      where: { id: created[0]!.job.id },
    });
    expect((JSON.parse(firstRow.inputSnapshotJson) as { speedScale?: number }).speedScale).toBe(1);

    // No second worker exists: nothing may move the Jobs before the test drains.
    const stillQueued = await client.request("job.get", { jobId: created[0]!.job.id });
    expect(stillQueued.job.status).toBe("queued");

    await drainWorker();

    const waited = await waitForJob(
      { jobId: created[0]!.job.id, timeoutMs: 5000, intervalMs: 10 },
      { getJob: createJobGetter(client), now: Date.now, sleep: (ms) => delay(ms) },
    );
    expect(waited.timedOut).toBe(false);
    expect(waited.job.status).toBe("succeeded");
    const waitedResult = ttsResultOf(waited.job);
    expect(waitedResult).toMatchObject({
      narrationSegmentId: "line-vv",
      source: "tts",
    });
    expect(waitedResult.durationMs).toBeGreaterThan(0);

    for (const entry of created) {
      const fetched = await client.request("job.get", { jobId: entry.job.id });
      expect(fetched.job.status).toBe("succeeded");
      expect(fetched.job.error).toBeNull();
      const result = ttsResultOf(fetched.job);
      expect(result.narrationSegmentId).toBe(entry.segmentId);
      expect(result.source).toBe("tts");
      expect(result.assetId.length).toBeGreaterThan(0);
      expect(result.durationMs).toBeGreaterThan(0);
      const asset = await client.request("asset.get", { assetId: result.assetId });
      expect(asset.asset.kind).toBe("audio");
      expect(asset.asset.status).toBe("ready");
      expect(asset.asset.origin).toBe("generated");
      expect(asset.asset.durationMs).toBe(result.durationMs);
    }

    // The opaque `uuid:style` voice IDs are decoded to the adapter's speaker
    // parameter, so a regression in voice mapping cannot pass on 200 alone.
    expect(voicevoxMock.lastSynthesisRequest).toEqual({
      speaker: "2",
      text: "こんにちは",
    });
    expect(aivisspeechMock.lastSynthesisRequest).toEqual({
      speaker: "-1",
      text: "おはよう",
    });

    // Every adapter was exercised through the configured loopback base URL.
    // Each Job resolves the voice listing once, so the counters stay at one
    // synthesis and one listing round-trip per adapter.
    expect(voicevoxMock.counters).toEqual({ synthesis: 1, speakers: 1, version: 1 });
    expect(aivisspeechMock.counters).toEqual({ synthesis: 1, speakers: 1, version: 1 });
    expect(openAiCounters).toEqual({ speech: 1, voices: 1 });
  });

  it("enqueues bulk Jobs for unselected lines and reports exclusions", async () => {
    resetCounters();
    const manualAsset = await prisma.asset.create({
      data: {
        kind: "audio",
        origin: "uploaded",
        status: "ready",
        storageKey: `test/manual-${randomUUID()}`,
        originalFilename: "manual.wav",
        mediaType: "audio/wav",
        byteSize: BigInt(1),
        sha256: `sha-${randomUUID()}`,
        durationMs: 1000,
      },
    });
    const script = await saveTtsScript(
      [
        { id: "line-bulk-a", speakerId: "speaker-vv", speechText: "いち" },
        { id: "line-bulk-b", speakerId: "speaker-av", speechText: "に" },
        { id: "line-bulk-empty", speakerId: "speaker-av", speechText: "   " },
        { id: "line-bulk-nospeaker", speakerId: null, speechText: "よん" },
      ],
      (content) => {
        content.audioTakes = [
          {
            id: "take-bulk-b",
            narrationSegmentId: "line-bulk-b",
            source: "manual",
            assetId: manualAsset.id,
            durationMs: 1000,
          },
        ];
        const scene = content.scenes.find((entry) => entry.kind === "point");
        const selected = scene?.lines.find((line) => line.id === "line-bulk-b");
        if (selected === undefined) {
          throw new Error("selected line missing");
        }
        selected.selectedAudioTakeId = "take-bulk-b";
      },
    );

    const bulk = await client.request("tts.createBulk", {
      scriptVersionId: script.scriptVersionId,
    });
    expect(bulk.jobs.map((entry) => entry.narrationSegmentId)).toEqual(["line-bulk-a"]);
    expect(bulk.excluded.map((entry) => entry.narrationSegmentId).sort()).toEqual([
      "line-bulk-empty",
      "line-bulk-nospeaker",
    ]);
    expect(bulk.excluded.every((entry) => entry.code === "TTS_INPUT_INVALID")).toBe(true);

    await drainWorker();
    for (const entry of bulk.jobs) {
      const fetched = await client.request("job.get", { jobId: entry.job.id });
      expect(fetched.job.status).toBe("succeeded");
      const result = ttsResultOf(fetched.job);
      expect(result.narrationSegmentId).toBe(entry.narrationSegmentId);
      const asset = await client.request("asset.get", { assetId: result.assetId });
      expect(asset.asset.status).toBe("ready");
    }
    expect(voicevoxMock.counters.synthesis).toBe(1);
  });

  it("attaches a succeeded ttsResult through script.edit line.assignTake", async () => {
    resetCounters();
    const script = await saveTtsScript([
      { id: "line-attach", speakerId: "speaker-oai", speechText: "attach me" },
    ]);
    const created = await client.request("tts.create", {
      scriptVersionId: script.scriptVersionId,
      narrationSegmentId: "line-attach",
    });
    await drainWorker();

    const finished = await client.request("job.get", { jobId: created.job.id });
    expect(finished.job.status).toBe("succeeded");
    const result = ttsResultOf(finished.job);

    // The attach step re-reads the latest version instead of trusting the
    // version the Job was created from.
    const latest = await client.request("script.get", { languageEditionId: script.editionId });
    expect(latest.scriptVersion.id).toBe(script.scriptVersionId);

    const edited = await client.request("script.edit", {
      baseScriptVersionId: latest.scriptVersion.id,
      requestId: "tts-attach-1",
      operations: [
        {
          op: "line.assignTake",
          sceneId: script.sceneId,
          lineId: "line-attach",
          assetId: result.assetId,
          source: "tts",
        },
      ],
    });
    expect(edited.replay).toBe(false);
    expect(edited.scriptVersion.versionNumber).toBe(latest.scriptVersion.versionNumber + 1);
    expect(edited.created.audioTakeIds).toHaveLength(1);

    const takeId = edited.created.audioTakeIds[0]!;
    const take = edited.scriptVersion.content.audioTakes.find((entry) => entry.id === takeId);
    expect(take).toEqual({
      id: takeId,
      narrationSegmentId: "line-attach",
      source: "tts",
      assetId: result.assetId,
      durationMs: result.durationMs,
    });
    const scene = edited.scriptVersion.content.scenes.find(
      (entry) => entry.id === script.sceneId,
    );
    const line = scene?.lines.find((entry) => entry.id === "line-attach");
    expect(line?.selectedAudioTakeId).toBe(takeId);
  });

  it("returns stable errors for missing segments, invalid input and unavailable engines", async () => {
    resetCounters();
    const script = await saveTtsScript([
      { id: "line-errors", speakerId: "speaker-vv", speechText: "こんにちは" },
    ]);

    await expectAgentError(
      client.request("tts.create", {
        scriptVersionId: script.scriptVersionId,
        narrationSegmentId: "line-missing",
      }),
      "RESOURCE_NOT_FOUND",
    );

    const invalid = await expectAgentError(
      client.request("tts.create", {
        scriptVersionId: script.scriptVersionId,
        narrationSegmentId: "line-errors",
        speechText: "   ",
      }),
      "TTS_INPUT_INVALID",
    );
    expect(invalid.issues?.length).toBeGreaterThan(0);

    const previous = config.voiceBaseUrls.voicevox;
    config.voiceBaseUrls.voicevox = "http://127.0.0.1:1";
    try {
      await expectAgentError(
        client.request("tts.create", {
          scriptVersionId: script.scriptVersionId,
          narrationSegmentId: "line-errors",
        }),
        "TTS_ENGINE_UNAVAILABLE",
      );
    } finally {
      config.voiceBaseUrls.voicevox = previous;
    }

    await expectAgentError(
      // A missing required field is rejected by the dispatcher schema.
      client.request("tts.createBulk", {} as unknown as { scriptVersionId: string }),
      "VALIDATION_ERROR",
    );
  });
});
