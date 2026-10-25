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
import { DEFAULT_SCENE_IDS } from "@kakeai/contracts";
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
import { ensureDataDirectories } from "../storage/paths.ts";
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
    styles: [
      { name: "ノーマル", id: 2 },
      { name: "ヒソヒソ", id: 3 },
    ],
  },
];

const OPENAI_MODEL = "kokoro";
const OPENAI_VOICE_ID = "af_heart";

function json(res: ServerResponse, value: unknown): void {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(value));
}

function handleOpenAi(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/v1/models") {
    json(res, { data: [{ id: OPENAI_MODEL }] });
    return;
  }
  if (req.method === "GET" && url.pathname === "/v1/audio/voices") {
    if (url.searchParams.get("model") !== OPENAI_MODEL) {
      res.statusCode = 404;
      res.end();
      return;
    }
    json(res, { data: [{ id: OPENAI_VOICE_ID, name: "Heart" }] });
    return;
  }
  res.statusCode = 404;
  res.end();
}

async function listen(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<Server> {
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

async function expectAgentError(
  promise: Promise<unknown>,
  code: string,
): Promise<AgentClientError> {
  try {
    await promise;
  } catch ( error ) {
    expect(error).toBeInstanceOf(AgentClientError);
    expect((error as AgentClientError).code).toBe(code);
    return error as AgentClientError;
  }
  throw new Error(`expected ${code}`);
}

let dataDir: string;
let config: AppConfig;
let prisma: ReturnType<typeof createPrismaClient>;
let agentServer: AgentSocketServer;
let client: AgentClient;
let voicevoxMock: MockVoicevoxServer;
let openAiServer: Server;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-agent-voice-profile-"));
  process.env.KAKEAI_DATA_DIR = dataDir;
  config = loadConfig();
  await ensureDataDirectories(config.directories);
  await runMigrations();
  prisma = createPrismaClient(config.databaseUrl);
  await applySqlitePragmas(prisma);

  voicevoxMock = await startMockVoicevoxServer({
    speakers: VOICEVOX_SPEAKERS,
    wav: wavFixture(1000, 440),
    engineVersion: "0.19.0",
  });
  openAiServer = await listen(handleOpenAi);
  config.voiceBaseUrls.voicevox = voicevoxMock.baseUrl;
  config.voiceBaseUrls["openai-compatible"] = baseUrlOf(openAiServer);

  agentServer = await startAgentSocketServer({
    config,
    prisma,
    fontCatalogService: new FontCatalogService(new FakeFontCatalogAdapter()),
  });
  client = createAgentClient({ dataRoot: config.dataRoot, agentId: "voice-profile-e2e-agent" });
}, 60000);

afterAll(async () => {
  await agentServer.close();
  await prisma.$disconnect();
  await voicevoxMock.close();
  await new Promise<void>((resolve) => openAiServer.close(() => resolve()));
  delete process.env.KAKEAI_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe("agent voiceProfile write operations over the socket", () => {
  it("catalogs the new operations with their kinds", async () => {
    const schema = await client.request("schema.get", {});
    expect(schema.agentOperations).toContainEqual({
      name: "voiceProfile.listVoices",
      kind: "read",
      longRunning: false,
    });
    expect(schema.agentOperations).toContainEqual({
      name: "voiceProfile.listModels",
      kind: "read",
      longRunning: false,
    });
    expect(schema.agentOperations).toContainEqual({
      name: "voiceProfile.create",
      kind: "mutation",
      longRunning: false,
    });
    expect(schema.agentOperations).toContainEqual({
      name: "voiceProfile.update",
      kind: "mutation",
      longRunning: false,
    });
  });

  it("lists engine voices and models", async () => {
    const voices = await client.request("voiceProfile.listVoices", {
      adapterId: "voicevox",
    });
    expect(voices.adapterId).toBe("voicevox");
    expect(voices.voices.map((voice) => voice.voiceId).sort()).toEqual([
      "uuid-metantan:2",
      "uuid-metantan:3",
    ]);

    const voicevoxModels = await client.request("voiceProfile.listModels", {
      adapterId: "voicevox",
    });
    expect(voicevoxModels).toEqual({ adapterId: "voicevox", models: [] });

    const openAiModels = await client.request("voiceProfile.listModels", {
      adapterId: "openai-compatible",
    });
    expect(openAiModels).toEqual({ adapterId: "openai-compatible", models: [OPENAI_MODEL] });

    const openAiVoices = await client.request("voiceProfile.listVoices", {
      adapterId: "openai-compatible",
      model: OPENAI_MODEL,
    });
    expect(openAiVoices.voices.map((voice) => voice.voiceId)).toEqual([OPENAI_VOICE_ID]);
  });

  it("returns TTS_ENGINE_UNAVAILABLE when the engine is down", async () => {
    const previous = config.voiceBaseUrls.voicevox;
    config.voiceBaseUrls.voicevox = "http://127.0.0.1:1";
    try {
      await expectAgentError(
        client.request("voiceProfile.listVoices", { adapterId: "voicevox" }),
        "TTS_ENGINE_UNAVAILABLE",
      );
    } finally {
      config.voiceBaseUrls.voicevox = previous;
    }
  });

  it("creates a profile, reads it back, and assigns it to a speaker", async () => {
    const created = await client.request("voiceProfile.create", {
      name: `エージェント声-${randomUUID()}`,
      adapterId: "voicevox",
      voiceId: "uuid-metantan:2",
      locale: "ja-JP",
      settings: {},
    });
    expect(created.voiceProfile.id).toMatch(/^[0-9a-z]+$/u);
    expect(created.voiceProfile).toMatchObject({
      adapterId: "voicevox",
      voiceId: "uuid-metantan:2",
      locale: "ja-JP",
    });

    const fetched = await client.request("voiceProfile.get", {
      voiceProfileId: created.voiceProfile.id,
    });
    expect(fetched.voiceProfile).toEqual(created.voiceProfile);

    const listed = await client.request("voiceProfile.list", {});
    expect(listed.voiceProfiles.map((profile) => profile.id)).toContain(
      created.voiceProfile.id,
    );

    const work = await client.request("work.create", {
      title: `声割当-${randomUUID()}`,
    });
    const edition = work.work.languageEditions[0]!;
    const initial = await client.request("script.get", {
      languageEditionId: edition.id,
    });
    const edited = await client.request("script.edit", {
      baseScriptVersionId: initial.scriptVersion.id,
      requestId: `voice-assign-${randomUUID()}`,
      operations: [
        {
          op: "speaker.add",
          key: "narrator",
          name: "ナレーター",
          voiceProfileId: created.voiceProfile.id,
        },
        {
          op: "line.add",
          key: "line-1",
          sceneId: DEFAULT_SCENE_IDS.point1,
          captionText: "こんにちは",
          speechText: "こんにちは",
          speakerId: { key: "narrator" },
        },
      ],
    });
    expect(edited.scriptVersion.content.speakers[0]?.voiceProfileId).toBe(
      created.voiceProfile.id,
    );
  });

  it("creates an openai-compatible profile with a model setting", async () => {
    const created = await client.request("voiceProfile.create", {
      name: `エージェントOAI-${randomUUID()}`,
      adapterId: "openai-compatible",
      voiceId: OPENAI_VOICE_ID,
      locale: "en-US",
      settings: { model: OPENAI_MODEL },
    });
    expect(created.voiceProfile.settings).toEqual({ model: OPENAI_MODEL });
  });

  it("rejects invalid create inputs", async () => {
    await expectAgentError(
      client.request("voiceProfile.create", {
        name: "   ",
        adapterId: "voicevox",
        voiceId: "uuid-metantan:2",
        locale: "ja-JP",
        settings: {},
      }),
      "VALIDATION_ERROR",
    );
    await expectAgentError(
      client.request("voiceProfile.create", {
        name: "声",
        adapterId: "unknown-adapter" as never,
        voiceId: "uuid-metantan:2",
        locale: "ja-JP",
        settings: {},
      }),
      "VALIDATION_ERROR",
    );
    // openai-compatible requires settings.model.
    await expectAgentError(
      client.request("voiceProfile.create", {
        name: "声",
        adapterId: "openai-compatible",
        voiceId: OPENAI_VOICE_ID,
        locale: "en-US",
        settings: {},
      }),
      "VALIDATION_ERROR",
    );
  });

  it("updates a profile and rejects unknown ids and adapterId changes", async () => {
    const created = await client.request("voiceProfile.create", {
      name: `更新前-${randomUUID()}`,
      adapterId: "voicevox",
      voiceId: "uuid-metantan:2",
      locale: "ja-JP",
      settings: {},
    });

    const updated = await client.request("voiceProfile.update", {
      voiceProfileId: created.voiceProfile.id,
      name: `更新後-${randomUUID()}`,
      voiceId: "uuid-metantan:3",
      locale: "ja-JP",
      settings: {},
    });
    expect(updated.voiceProfile.id).toBe(created.voiceProfile.id);
    expect(updated.voiceProfile.voiceId).toBe("uuid-metantan:3");
    expect(updated.voiceProfile.name).not.toBe(created.voiceProfile.name);

    await expectAgentError(
      client.request("voiceProfile.update", {
        voiceProfileId: "missing",
        name: "声",
        voiceId: "uuid-metantan:2",
        locale: "ja-JP",
        settings: {},
      }),
      "RESOURCE_NOT_FOUND",
    );

    // adapterId is immutable, like the HTTP PATCH contract.
    await expectAgentError(
      client.request("voiceProfile.update", {
        voiceProfileId: created.voiceProfile.id,
        name: "声",
        voiceId: "uuid-metantan:2",
        locale: "ja-JP",
        settings: {},
        adapterId: "aivisspeech",
      } as never),
      "VALIDATION_ERROR",
    );
  });
});
