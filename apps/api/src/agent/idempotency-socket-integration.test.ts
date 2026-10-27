import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  SOFT_EDITORIAL_THEME_ID,
  SOFT_EDITORIAL_THEME_VERSION,
  agentTtsCreateInputSchema,
  createInitialContentDocument,
} from "@kakeai/contracts";
import { createAgentClient, AgentClientError, type AgentClient } from "@kakeai/agent-client";
import type { AppConfig } from "../config.ts";
import { loadConfig } from "../config.ts";
import { createPrismaClient } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { applySqlitePragmas } from "../db/pragmas.ts";
import { computeAgentRequestHash } from "../services/agent-request-hash.ts";
import { pruneAgentRequests } from "../services/agent-requests.ts";
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

/** Saves a point scene whose lines all speak with the mock voice profile. */
async function saveScript(lines: { id: string; speechText: string }[]): Promise<SavedScript> {
  const created = await client.request("work.create", {
    title: `冪等テスト-${randomUUID()}`,
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
    speakerId: "speaker-vv",
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

/** Creates a composition with a draft that passes the bundle validation. */
async function createPublishableComposition(): Promise<string> {
  const runtimeCompositionId = `cmp.agent.idempotent.${randomUUID()}`;
  const created = await client.request("composition.create", {
    name: "Idempotent Publish",
    runtimeCompositionId,
    canvasProfile: "landscape",
    authoringStyle: {
      visualTheme: {
        id: SOFT_EDITORIAL_THEME_ID,
        version: SOFT_EDITORIAL_THEME_VERSION,
      },
    },
  });
  const compositionId = created.composition.id;
  await client.request("composition.draft.update", {
    compositionId,
    files: {
      "index.html": [
        "<!doctype html><html><head><meta charset=\"utf-8\"></head><body>",
        `<div id="app" data-composition-id="${runtimeCompositionId}" data-width="1920" data-height="1080" data-duration="4" data-fps="30"></div>`,
        `<script>window.__timelines = window.__timelines || {};window.__timelines["${runtimeCompositionId}"] = { duration: 4 };</script>`,
        "</body></html>",
      ].join(""),
    },
    manifest: { durationMs: 4000 },
  });
  return compositionId;
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-agent-idempotency-"));
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
  client = createAgentClient({ dataRoot: config.dataRoot, agentId: "idempotency-agent" });
}, 60000);

afterAll(async () => {
  await agentServer.close();
  await prisma.$disconnect();
  await voicevoxMock.close();
  delete process.env.KAKEAI_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe("idempotency ledger for the high-cost operations", () => {
  it("returns the same tts Job for the same requestId and creates one Job", async () => {
    const script = await saveScript([{ id: "line-idem", speechText: "こんにちは" }]);
    const requestId = `tts-${randomUUID()}`;

    const first = await client.request("tts.create", {
      scriptVersionId: script.scriptVersionId,
      narrationSegmentId: "line-idem",
      requestId,
    });
    const second = await client.request("tts.create", {
      scriptVersionId: script.scriptVersionId,
      narrationSegmentId: "line-idem",
      requestId,
    });

    expect(second.job.id).toBe(first.job.id);
    expect(
      await prisma.job.count({
        where: { kind: "tts", scriptVersionId: script.scriptVersionId },
      }),
    ).toBe(1);

    const rows = await prisma.agentRequest.findMany({
      where: { operation: "tts.create", requestId },
    });
    expect(rows).toHaveLength(1);
    // A client supplied id is namespaced, so it cannot impersonate the
    // reserved id of a client that sends none.
    expect(rows[0]!.agentId).toBe("agent:idempotency-agent");
    // The ledger stores a reference to the created Job, not the response.
    expect(rows[0]!.resultRef).toContain(first.job.id);
  });

  it("reports a conflict when the same requestId carries a different input", async () => {
    const script = await saveScript([{ id: "line-conflict", speechText: "こんにちは" }]);
    const requestId = `tts-conflict-${randomUUID()}`;

    await client.request("tts.create", {
      scriptVersionId: script.scriptVersionId,
      narrationSegmentId: "line-conflict",
      requestId,
    });
    const conflict = await expectAgentError(
      client.request("tts.create", {
        scriptVersionId: script.scriptVersionId,
        narrationSegmentId: "line-conflict",
        speechText: "ちがう",
        requestId,
      }),
      "IDEMPOTENCY_CONFLICT",
    );
    expect(conflict.issues.length).toBeGreaterThan(0);
    expect(
      await prisma.job.count({
        where: { kind: "tts", scriptVersionId: script.scriptVersionId },
      }),
    ).toBe(1);
  });

  it("replays the current state of the Job instead of the queued snapshot", async () => {
    const script = await saveScript([{ id: "line-replay", speechText: "こんにちは" }]);
    const requestId = `tts-replay-${randomUUID()}`;

    const first = await client.request("tts.create", {
      scriptVersionId: script.scriptVersionId,
      narrationSegmentId: "line-replay",
      requestId,
    });
    expect(first.job.status).toBe("queued");

    await drainWorker();

    const replay = await client.request("tts.create", {
      scriptVersionId: script.scriptVersionId,
      narrationSegmentId: "line-replay",
      requestId,
    });
    expect(replay.job.id).toBe(first.job.id);
    expect(replay.job.status).toBe("succeeded");
    expect(replay.job.ttsResult?.narrationSegmentId).toBe("line-replay");
    expect(
      await prisma.job.count({
        where: { kind: "tts", scriptVersionId: script.scriptVersionId },
      }),
    ).toBe(1);
  });

  it("creates one render Job for the same requestId", async () => {
    const script = await saveScript([]);
    const requestId = `render-${randomUUID()}`;

    const first = await client.request("render.start", {
      scriptVersionId: script.scriptVersionId,
      requestId,
    });
    const second = await client.request("render.start", {
      scriptVersionId: script.scriptVersionId,
      requestId,
    });

    expect(second.job.id).toBe(first.job.id);
    expect(
      await prisma.job.count({
        where: { kind: "render", scriptVersionId: script.scriptVersionId },
      }),
    ).toBe(1);
  });

  it("creates one CompositionVersion for the same requestId", async () => {
    const compositionId = await createPublishableComposition();
    const requestId = `publish-${randomUUID()}`;

    const first = await client.request("composition.publish", { compositionId, requestId });
    const second = await client.request("composition.publish", { compositionId, requestId });

    expect(second.dryRun).toBe(false);
    if (first.dryRun || second.dryRun) {
      throw new Error("expected a publish outcome");
    }
    expect(second.version.id).toBe(first.version.id);
    expect(second.version.versionNumber).toBe(first.version.versionNumber);
    expect(
      await prisma.compositionVersion.count({ where: { compositionId } }),
    ).toBe(1);
  });

  it("never records a dry run publish", async () => {
    const compositionId = await createPublishableComposition();
    const requestId = `publish-dry-${randomUUID()}`;

    const dryRun = await client.request("composition.publish", {
      compositionId,
      dryRun: true,
      requestId,
    });
    expect(dryRun.dryRun).toBe(true);
    expect(
      await prisma.agentRequest.count({ where: { operation: "composition.publish", requestId } }),
    ).toBe(0);
    expect(
      await prisma.compositionVersion.count({ where: { compositionId } }),
    ).toBe(0);
  });

  it("treats an omitted dryRun and dryRun false as the same request", async () => {
    const compositionId = await createPublishableComposition();
    const requestId = `publish-dry-false-${randomUUID()}`;

    const first = await client.request("composition.publish", {
      compositionId,
      dryRun: false,
      requestId,
    });
    const second = await client.request("composition.publish", { compositionId, requestId });

    expect(first.dryRun).toBe(false);
    expect(second.dryRun).toBe(false);
    if (first.dryRun || second.dryRun) {
      throw new Error("expected a publish outcome");
    }
    expect(second.version.id).toBe(first.version.id);
    expect(
      await prisma.compositionVersion.count({ where: { compositionId } }),
    ).toBe(1);
  });

  it("prunes rows that are older than the retention window", async () => {
    const script = await saveScript([{ id: "line-prune", speechText: "こんにちは" }]);
    const requestId = `tts-prune-${randomUUID()}`;
    const old = await prisma.agentRequest.create({
      data: {
        operation: "tts.create",
        agentId: "agent:idempotency-agent",
        requestId: `old-${requestId}`,
        requestHash: "sha256:old",
        resultRef: JSON.stringify({ jobId: "job-old" }),
        createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      },
    });

    await client.request("tts.create", {
      scriptVersionId: script.scriptVersionId,
      narrationSegmentId: "line-prune",
      requestId,
    });
    // The prune runs at most once every few minutes, so the next run is forced
    // with a clock far enough in the future.
    await pruneAgentRequests(prisma, Date.now() + 24 * 60 * 60 * 1000);

    expect(await prisma.agentRequest.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.agentRequest.count({ where: { requestId } })).toBe(1);
  });

  it("returns the same Jobs for a bulk request with the same requestId", async () => {
    const script = await saveScript([
      { id: "line-bulk-1", speechText: "いち" },
      { id: "line-bulk-2", speechText: "に" },
    ]);
    const requestId = `bulk-${randomUUID()}`;

    const first = await client.request("tts.createBulk", {
      scriptVersionId: script.scriptVersionId,
      requestId,
    });
    const second = await client.request("tts.createBulk", {
      scriptVersionId: script.scriptVersionId,
      requestId,
    });

    expect(first.jobs.map((entry: { job: { id: string } }) => entry.job.id)).toEqual(
      second.jobs.map((entry: { job: { id: string } }) => entry.job.id),
    );
    expect(first.jobs).toHaveLength(2);
    expect(
      await prisma.job.count({
        where: { kind: "tts", scriptVersionId: script.scriptVersionId },
      }),
    ).toBe(2);
  });

  it("writes no ledger row when the caller sends no requestId", async () => {
    const script = await saveScript([{ id: "line-plain", speechText: "こんにちは" }]);
    const before = await prisma.agentRequest.count();

    const first = await client.request("tts.create", {
      scriptVersionId: script.scriptVersionId,
      narrationSegmentId: "line-plain",
    });
    const second = await client.request("tts.create", {
      scriptVersionId: script.scriptVersionId,
      narrationSegmentId: "line-plain",
    });

    expect(second.job.id).not.toBe(first.job.id);
    expect(await prisma.agentRequest.count()).toBe(before);
  });

  it("releases the claim when the operation fails", async () => {
    const script = await saveScript([{ id: "line-retry", speechText: "こんにちは" }]);
    const requestId = `tts-fail-${randomUUID()}`;

    await expectAgentError(
      client.request("tts.create", {
        scriptVersionId: script.scriptVersionId,
        narrationSegmentId: "line-missing",
        requestId,
      }),
      "RESOURCE_NOT_FOUND",
    );
    expect(await prisma.agentRequest.count({ where: { requestId } })).toBe(0);

    // The id is free again, so a genuine retry runs the operation.
    const retried = await client.request("tts.create", {
      scriptVersionId: script.scriptVersionId,
      narrationSegmentId: "line-retry",
      requestId,
    });
    expect(retried.job.status).toBe("queued");
    expect(await prisma.agentRequest.count({ where: { requestId } })).toBe(1);
  });

  it("reports that a concurrent duplicate is still in flight", async () => {
    const script = await saveScript([{ id: "line-inflight", speechText: "こんにちは" }]);
    const requestId = `tts-inflight-${randomUUID()}`;
    // A row without a result reference is a request that is still running.
    const parsed = agentTtsCreateInputSchema.parse({
      scriptVersionId: script.scriptVersionId,
      narrationSegmentId: "line-inflight",
      requestId,
    });
    await prisma.agentRequest.create({
      data: {
        operation: "tts.create",
        agentId: "agent:idempotency-agent",
        requestId,
        requestHash: computeAgentRequestHash("tts.create", parsed),
      },
    });

    const inProgress = await expectAgentError(
      client.request("tts.create", {
        scriptVersionId: script.scriptVersionId,
        narrationSegmentId: "line-inflight",
        requestId,
      }),
      "AGENT_IDEMPOTENCY_IN_PROGRESS",
    );
    expect(inProgress.issues.length).toBeGreaterThan(0);
    expect(
      await prisma.job.count({
        where: { kind: "tts", scriptVersionId: script.scriptVersionId },
      }),
    ).toBe(0);
  });

  it("takes over a claim that its owner never finished", async () => {
    const script = await saveScript([{ id: "line-stale", speechText: "こんにちは" }]);
    const requestId = `tts-stale-${randomUUID()}`;
    const parsed = agentTtsCreateInputSchema.parse({
      scriptVersionId: script.scriptVersionId,
      narrationSegmentId: "line-stale",
      requestId,
    });
    await prisma.agentRequest.create({
      data: {
        operation: "tts.create",
        agentId: "agent:idempotency-agent",
        requestId,
        requestHash: computeAgentRequestHash("tts.create", parsed),
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    const result = await client.request("tts.create", {
      scriptVersionId: script.scriptVersionId,
      narrationSegmentId: "line-stale",
      requestId,
    });
    expect(result.job.status).toBe("queued");
    expect(
      await prisma.job.count({
        where: { kind: "tts", scriptVersionId: script.scriptVersionId },
      }),
    ).toBe(1);
  });

  it("takes over an abandoned claim even when the new input differs", async () => {
    const script = await saveScript([{ id: "line-poison", speechText: "こんにちは" }]);
    const requestId = `tts-poison-${randomUUID()}`;
    // An abandoned claim must not block the key for ever, not even when the
    // new request carries a different input.
    await prisma.agentRequest.create({
      data: {
        operation: "tts.create",
        agentId: "agent:idempotency-agent",
        requestId,
        requestHash: "sha256:another-input",
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    const result = await client.request("tts.create", {
      scriptVersionId: script.scriptVersionId,
      narrationSegmentId: "line-poison",
      requestId,
    });
    expect(result.job.status).toBe("queued");
    expect(
      await prisma.job.count({
        where: { kind: "tts", scriptVersionId: script.scriptVersionId },
      }),
    ).toBe(1);
  });

  it("files a request of an unidentified client under the reserved default id", async () => {
    const anonymous = createAgentClient({ dataRoot: config.dataRoot });
    const script = await saveScript([{ id: "line-anonymous", speechText: "こんにちは" }]);
    const requestId = `tts-anonymous-${randomUUID()}`;

    const created = await anonymous.request("tts.create", {
      scriptVersionId: script.scriptVersionId,
      narrationSegmentId: "line-anonymous",
      requestId,
    });
    expect(created.job.status).toBe("queued");

    const row = await prisma.agentRequest.findFirstOrThrow({ where: { requestId } });
    expect(row.agentId).toBe("none");
  });
});
