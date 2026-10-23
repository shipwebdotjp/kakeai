import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createInitialContentDocument } from "@kakeai/contracts";
import {
  AgentClientError,
  createAgentClient,
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

const VOICEVOX_VOICE_ID = "uuid-metantan:2";

let dataDir: string;
let config: AppConfig;
let prisma: ReturnType<typeof createPrismaClient>;
let worker: ReturnType<typeof createWorker>;
let agentServer: AgentSocketServer;
let client: AgentClient;
let voicevoxMock: MockVoicevoxServer;
let voiceProfileId: string;

async function drainWorker(): Promise<void> {
  while (await worker.runOnce()) {
    continue;
  }
}

async function expectAgentError(
  promise: Promise<unknown>,
  code: string,
): Promise<AgentClientError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AgentClientError);
    expect((error as AgentClientError).code).toBe(code);
    return error as AgentClientError;
  }
  throw new Error(`expected ${code}`);
}

interface SavedScript {
  editionId: string;
  scriptVersionId: string;
  sceneId: string;
}

interface SetupLine {
  id: string;
  speechText: string;
  speakerId?: string | null;
}

/** Saves a point scene whose lines speak with the mock voice profile by default. */
async function saveScript(lines: SetupLine[]): Promise<SavedScript> {
  const created = await client.request("work.create", {
    title: `確定テスト-${randomUUID()}`,
  });
  const edition = created.work.languageEditions[0]!;
  const content = createInitialContentDocument();
  content.speakers = [
    { id: "speaker-vv", name: "ぶい", characterId: null, voiceProfileId },
  ];
  const scene = content.scenes.find((entry) => entry.kind === "point");
  if (scene === undefined) {
    throw new Error("point scene missing");
  }
  scene.lines = lines.map((line) => ({
    id: line.id,
    speakerId: line.speakerId === undefined ? "speaker-vv" : line.speakerId,
    captionText: line.speechText,
    speechText: line.speechText,
    selectedAudioTakeId: null,
    expressionId: null,
  }));
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

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-agent-attach-bulk-"));
  process.env.KAKEAI_DATA_DIR = dataDir;
  config = loadConfig();
  await ensureDataDirectories(config.directories);
  await runMigrations();
  prisma = createPrismaClient(config.databaseUrl);
  await applySqlitePragmas(prisma);
  worker = createWorker({ prisma, config });

  voicevoxMock = await startMockVoicevoxServer({
    speakers: VOICEVOX_SPEAKERS,
    wav: wavFixture(1000, 440),
    audioQuery: { speedScale: 1, accent_phrases: [] },
    engineVersion: "0.19.0",
  });
  config.voiceBaseUrls.voicevox = voicevoxMock.baseUrl;

  voiceProfileId = (
    await createVoiceProfile(prisma, {
      name: "めたん",
      adapterId: "voicevox",
      voiceId: VOICEVOX_VOICE_ID,
      locale: "ja-JP",
      settings: {},
    })
  ).id;

  agentServer = await startAgentSocketServer({
    config,
    prisma,
    fontCatalogService: new FontCatalogService(new FakeFontCatalogAdapter()),
  });
  client = createAgentClient({ dataRoot: config.dataRoot, agentId: "attach-bulk-agent" });
}, 60000);

afterAll(async () => {
  await agentServer.close();
  await prisma.$disconnect();
  await voicevoxMock.close();
  delete process.env.KAKEAI_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe("tts.attachBulk over the socket", () => {
  it("is catalogued as a short mutation", async () => {
    const schema = await client.request("schema.get", {});
    expect(schema.agentOperations).toContainEqual({
      name: "tts.attachBulk",
      kind: "mutation",
      longRunning: false,
    });
  });

  it("returns pending while Jobs run and finalizes only the succeeded Job", async () => {
    const script = await saveScript([
      { id: "line-ok", speechText: "いち" },
      { id: "line-cancelled", speechText: "に" },
    ]);
    const bulkRequestId = `bulk-${randomUUID()}`;
    const bulk = await client.request("tts.createBulk", {
      scriptVersionId: script.scriptVersionId,
      requestId: bulkRequestId,
    });
    expect(bulk.jobs).toHaveLength(2);

    const pending = await client.request("tts.attachBulk", {
      scriptVersionId: script.scriptVersionId,
      bulkRequestId,
      requestId: `attach-pending-${randomUUID()}`,
    });
    expect(pending.status).toBe("pending");
    expect(pending.counts).toEqual({
      queued: 2,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    });
    expect(pending.scriptVersion).toBeNull();
    // A pending attach creates no Script Version.
    expect(
      await prisma.scriptVersion.count({ where: { languageEditionId: script.editionId } }),
    ).toBe(2);

    const cancelledJob = bulk.jobs.find(
      (entry) => entry.narrationSegmentId === "line-cancelled",
    )!;
    await client.request("job.cancel", { jobId: cancelledJob.job.id });
    await drainWorker();

    const attachRequestId = `attach-${randomUUID()}`;
    const finalized = await client.request("tts.attachBulk", {
      scriptVersionId: script.scriptVersionId,
      bulkRequestId,
      requestId: attachRequestId,
    });
    expect(finalized.status).toBe("finalized");
    expect(finalized.counts).toEqual({
      queued: 0,
      running: 0,
      succeeded: 1,
      failed: 0,
      cancelled: 1,
    });
    expect(finalized.excluded).toEqual([]);
    expect(finalized.failures).toHaveLength(1);
    expect(finalized.failures[0]).toMatchObject({
      narrationSegmentId: "line-cancelled",
      jobId: cancelledJob.job.id,
      status: "cancelled",
    });
    expect(finalized.scriptVersion).not.toBeNull();
    expect(finalized.scriptVersion!.versionNumber).toBe(3);

    const scene = finalized.scriptVersion!.content.scenes.find(
      (entry) => entry.id === script.sceneId,
    )!;
    const okLine = scene.lines.find((line) => line.id === "line-ok")!;
    const cancelledLine = scene.lines.find((line) => line.id === "line-cancelled")!;
    expect(okLine.selectedAudioTakeId).not.toBeNull();
    expect(cancelledLine.selectedAudioTakeId).toBeNull();
    const take = finalized.scriptVersion!.content.audioTakes.find(
      (entry) => entry.id === okLine.selectedAudioTakeId,
    )!;
    expect(take).toMatchObject({ narrationSegmentId: "line-ok", source: "tts" });
    expect(take.durationMs).toBeGreaterThan(0);

    // The same attach requestId replays the existing version.
    const replayed = await client.request("tts.attachBulk", {
      scriptVersionId: script.scriptVersionId,
      bulkRequestId,
      requestId: attachRequestId,
    });
    expect(replayed.status).toBe("finalized");
    expect(replayed.scriptVersion!.id).toBe(finalized.scriptVersion!.id);
    expect(
      await prisma.scriptVersion.count({ where: { languageEditionId: script.editionId } }),
    ).toBe(3);
  });

  it("rejects bulks without a ledger entry and bulks from another agent", async () => {
    const script = await saveScript([{ id: "line-plain", speechText: "こんにちは" }]);

    // No requestId on the bulk run means no ledger row to restore.
    await client.request("tts.createBulk", { scriptVersionId: script.scriptVersionId });
    await expectAgentError(
      client.request("tts.attachBulk", {
        scriptVersionId: script.scriptVersionId,
        bulkRequestId: `bulk-missing-${randomUUID()}`,
        requestId: `attach-${randomUUID()}`,
      }),
      "RESOURCE_NOT_FOUND",
    );

    const otherAgent = createAgentClient({
      dataRoot: config.dataRoot,
      agentId: "attach-bulk-other-agent",
    });
    const bulkRequestId = `bulk-other-${randomUUID()}`;
    await client.request("tts.createBulk", {
      scriptVersionId: script.scriptVersionId,
      requestId: bulkRequestId,
    });
    await expectAgentError(
      otherAgent.request("tts.attachBulk", {
        scriptVersionId: script.scriptVersionId,
        bulkRequestId,
        requestId: `attach-${randomUUID()}`,
      }),
      "RESOURCE_NOT_FOUND",
    );
  });

  it("rejects a stale base without attaching", async () => {
    const script = await saveScript([{ id: "line-stale", speechText: "さん" }]);
    const bulkRequestId = `bulk-stale-${randomUUID()}`;
    await client.request("tts.createBulk", {
      scriptVersionId: script.scriptVersionId,
      requestId: bulkRequestId,
    });
    await drainWorker();

    // Advance the edition so the bulk source is no longer current.
    await client.request("script.edit", {
      baseScriptVersionId: script.scriptVersionId,
      requestId: `edit-stale-${randomUUID()}`,
      operations: [],
    });

    await expectAgentError(
      client.request("tts.attachBulk", {
        scriptVersionId: script.scriptVersionId,
        bulkRequestId,
        requestId: `attach-stale-${randomUUID()}`,
      }),
      "SCRIPT_BASE_STALE",
    );
    expect(
      await prisma.scriptVersion.count({ where: { languageEditionId: script.editionId } }),
    ).toBe(3);
  });

  it("finalizes an all-excluded bulk without creating a version", async () => {
    const script = await saveScript([{ id: "line-nospeaker", speechText: "よん", speakerId: null }]);
    const bulkRequestId = `bulk-excluded-${randomUUID()}`;
    const bulk = await client.request("tts.createBulk", {
      scriptVersionId: script.scriptVersionId,
      requestId: bulkRequestId,
    });
    expect(bulk.jobs).toEqual([]);
    expect(bulk.excluded).toHaveLength(1);

    const finalized = await client.request("tts.attachBulk", {
      scriptVersionId: script.scriptVersionId,
      bulkRequestId,
      requestId: `attach-excluded-${randomUUID()}`,
    });
    expect(finalized.status).toBe("finalized");
    expect(finalized.counts).toEqual({
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    });
    expect(finalized.excluded).toEqual(bulk.excluded);
    expect(finalized.failures).toEqual([]);
    expect(finalized.scriptVersion).toBeNull();
    expect(
      await prisma.scriptVersion.count({ where: { languageEditionId: script.editionId } }),
    ).toBe(2);
  });

  it("reports an unavailable asset as a failure instead of attaching", async () => {
    const script = await saveScript([{ id: "line-asset", speechText: "ご" }]);
    const bulkRequestId = `bulk-asset-${randomUUID()}`;
    const bulk = await client.request("tts.createBulk", {
      scriptVersionId: script.scriptVersionId,
      requestId: bulkRequestId,
    });
    expect(bulk.jobs).toHaveLength(1);
    await drainWorker();

    const finished = await client.request("job.get", { jobId: bulk.jobs[0]!.job.id });
    expect(finished.job.status).toBe("succeeded");
    await prisma.asset.delete({ where: { id: finished.job.ttsResult!.assetId } });

    const finalized = await client.request("tts.attachBulk", {
      scriptVersionId: script.scriptVersionId,
      bulkRequestId,
      requestId: `attach-asset-${randomUUID()}`,
    });
    expect(finalized.status).toBe("finalized");
    expect(finalized.counts).toEqual({
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 1,
      cancelled: 0,
    });
    expect(finalized.failures).toHaveLength(1);
    expect(finalized.failures[0]).toMatchObject({
      narrationSegmentId: "line-asset",
      code: "ASSET_UNAVAILABLE",
    });
    expect(finalized.scriptVersion).toBeNull();
    expect(
      await prisma.scriptVersion.count({ where: { languageEditionId: script.editionId } }),
    ).toBe(2);
  });
});
