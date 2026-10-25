import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_PROTOCOL_VERSION,
  DEFAULT_SCENE_IDS,
  SOFT_EDITORIAL_THEME_ID,
  SOFT_EDITORIAL_THEME_VERSION,
  agentResponseSchema,
  getVisualTheme,
  toVisualThemeDefinitionV2,
  type AgentResponse,
  type AgentOperationName,
  type ContentDocument,
  type Work,
} from "@kakeai/contracts";
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
import { createCharacter } from "../services/character-library.ts";
import { FakeFontCatalogAdapter, FontCatalogService } from "../services/font-catalog.ts";
import { createVoiceProfile } from "../services/voice-profiles.ts";
import { ensureDataDirectories } from "../storage/paths.ts";
import { createWorker } from "../worker/index.ts";
import { startAgentSocketServer, type AgentSocketServer } from "./socket-server.ts";

// A 1x1 PNG. It is only used to exercise content detection and probing.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
  "base64",
);

function ffprobeAvailable(): boolean {
  try {
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const probeAvailable = ffprobeAvailable();

let dataDir: string;
let fixtureDir: string;
let fixturePath: string;
let config: AppConfig;
let prisma: ReturnType<typeof createPrismaClient>;
let worker: ReturnType<typeof createWorker>;
let agentServer: AgentSocketServer;
let client: AgentClient;

let libraryCharacterId: string;
let imageAssetId: string;
let faceSetId: string;
let jaVoiceProfileId: string;
let jaVoiceProfile2Id: string;
let enVoiceProfileId: string;
let themeId: string;
let archivedThemeId: string;

async function drainWorker(): Promise<void> {
  while (await worker.runOnce()) {
    continue;
  }
}

function firstEdition(work: Work) {
  const edition = work.languageEditions[0];
  if (edition === undefined) {
    throw new Error("language edition missing");
  }
  return edition;
}

async function createWork(title: string, locale?: ContentDocument["locale"]): Promise<Work> {
  const result = await client.request("work.create", {
    title,
    ...(locale === undefined ? {} : { locale }),
  });
  return result.work;
}

async function seedTheme(name: string, archived = false): Promise<string> {
  const base = getVisualTheme(SOFT_EDITORIAL_THEME_ID, SOFT_EDITORIAL_THEME_VERSION);
  if (base === undefined) {
    throw new Error("built-in theme missing");
  }
  const theme = await prisma.theme.create({
    data: {
      name,
      ...(archived ? { archivedAt: new Date() } : {}),
    },
  });
  await prisma.themeRevision.create({
    data: {
      themeId: theme.id,
      versionNumber: 1,
      definitionJson: JSON.stringify({
        ...toVisualThemeDefinitionV2(base),
        id: theme.id,
        name,
        version: 1,
      }),
    },
  });
  return theme.id;
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

/** Sends one NDJSON request directly so the resident server, not the client
 * catalog, decides whether the operation is registered. */
function rawRequest(
  socketPath: string,
  operation: string,
  input: unknown,
  requestId = "raw-character-1",
): Promise<AgentResponse> {
  return new Promise<AgentResponse>((resolve, reject) => {
    const socket = connect(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("timed out waiting for the raw response"));
    }, 5000);
    let buffer = "";
    socket.setEncoding("utf8");
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ protocolVersion: AGENT_PROTOCOL_VERSION })}\n`);
      socket.write(`${JSON.stringify({ requestId, operation, input })}\n`);
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) {
        return;
      }
      clearTimeout(timer);
      socket.destroy();
      resolve(agentResponseSchema.parse(JSON.parse(buffer.slice(0, newline))));
    });
  });
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-agent-character-"));
  fixtureDir = await mkdtemp(join(tmpdir(), "kakeai-agent-character-fixture-"));
  fixturePath = join(fixtureDir, "character.png");
  await writeFile(fixturePath, PNG_1X1);

  process.env.KAKEAI_DATA_DIR = dataDir;
  config = loadConfig();
  await ensureDataDirectories(config.directories);
  await runMigrations();
  prisma = createPrismaClient(config.databaseUrl);
  await applySqlitePragmas(prisma);
  worker = createWorker({ prisma, config });
  agentServer = await startAgentSocketServer({
    config,
    prisma,
    fontCatalogService: new FontCatalogService(new FakeFontCatalogAdapter()),
  });
  client = createAgentClient({ dataRoot: config.dataRoot, agentId: "character-e2e-agent" });

  jaVoiceProfileId = (
    await createVoiceProfile(prisma, {
      name: "めたん",
      adapterId: "voicevox",
      voiceId: "uuid-metan:1",
      locale: "ja-JP",
      settings: {},
    })
  ).id;
  jaVoiceProfile2Id = (
    await createVoiceProfile(prisma, {
      name: "めたん（別スタイル）",
      adapterId: "voicevox",
      voiceId: "uuid-metan:3",
      locale: "ja-JP",
      settings: {},
    })
  ).id;
  enVoiceProfileId = (
    await createVoiceProfile(prisma, {
      name: "Metan",
      adapterId: "voicevox",
      voiceId: "uuid-metan:2",
      locale: "en-US",
      settings: {},
    })
  ).id;

  const faceSet = await prisma.faceSet.create({
    data: {
      name: "キャラクター表情",
      expressions: {
        create: [{ id: "smile", name: "smile", position: 0 }],
      },
    },
  });
  faceSetId = faceSet.id;

  themeId = await seedTheme("エージェント用テーマ");
  archivedThemeId = await seedTheme("アーカイブ済みテーマ", true);

  // The copy path needs a ready image Asset for the appearances, so the
  // library fixture is seeded only when the probe can make one.
  if (!probeAvailable) {
    return;
  }
  const imported = await client.request("asset.import", {
    path: fixturePath,
    originalFilename: "character.png",
  });
  await drainWorker();
  const ready = await client.request("asset.get", { assetId: imported.asset.id });
  if (ready.asset.status !== "ready") {
    throw new Error("imported character image did not become ready");
  }
  imageAssetId = ready.asset.id;

  const entry = await createCharacter(prisma, {
    name: "四国めたん",
    voices: [
      { locale: "ja-JP", voiceProfileId: jaVoiceProfileId },
      { locale: "en-US", voiceProfileId: enVoiceProfileId },
    ],
    appearances: [
      {
        id: "library-appearance-face",
        assetId: imageAssetId,
        expression: "smile",
        pose: "front",
        label: "夏服",
        faceSetId,
      },
      {
        id: "library-appearance-plain",
        assetId: imageAssetId,
        expression: "normal",
        pose: "side",
        faceSetId: null,
      },
    ],
  });
  libraryCharacterId = entry.id;
}, 60000);

afterAll(async () => {
  await agentServer.close();
  await prisma.$disconnect();
  delete process.env.KAKEAI_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
  await rm(fixtureDir, { recursive: true, force: true });
});

describe("agent character operations over the socket", () => {
  it("catalogs character reads and keeps library mutations unregistered", async () => {
    const schema = await client.request("schema.get", {});
    for (const name of ["character.list", "character.get"] as const) {
      expect(schema.agentOperations).toContainEqual({
        name,
        kind: "read",
        longRunning: false,
      });
    }
    expect(schema.operations).toContainEqual({
      name: "character.addFromLibrary",
      category: "character",
    });

    for (const operation of ["character.create", "character.update", "character.delete"]) {
      const response = await rawRequest(client.socketPath, operation, {});
      expect(response.ok).toBe(false);
      if (!response.ok) {
        expect(response.error.code).toBe("AGENT_OPERATION_UNKNOWN");
      }
    }

    await expectAgentError(
      client.request(
        "character.create" as AgentOperationName,
        {} as never,
      ),
      "AGENT_OPERATION_UNKNOWN",
    );
  });

  it("catalogs library reads and keeps Theme / Face Set / Voice Profile writes unregistered", async () => {
    const schema = await client.request("schema.get", {});
    for (const name of [
      "theme.list",
      "theme.get",
      "faceSet.list",
      "faceSet.get",
      "voiceProfile.list",
      "voiceProfile.get",
    ] as const) {
      expect(schema.agentOperations).toContainEqual({
        name,
        kind: "read",
        longRunning: false,
      });
    }
    expect(schema.operations).toContainEqual({
      name: "speaker.add",
      category: "speaker",
    });
    expect(schema.operations).toContainEqual({
      name: "speaker.setVoiceProfile",
      category: "speaker",
    });

    for (const operation of [
      "theme.create",
      "theme.update",
      "theme.archive",
      "faceSet.create",
      "faceSet.update",
      "voiceProfile.create",
      "voiceProfile.update",
      "voiceProfile.delete",
    ]) {
      const response = await rawRequest(
        client.socketPath,
        operation,
        {},
        `raw-${operation}`,
      );
      expect(response.ok).toBe(false);
      if (!response.ok) {
        expect(response.error.code).toBe("AGENT_OPERATION_UNKNOWN");
      }
    }
  });

  it("reads selectable Themes, Face Sets and Voice Profiles", async () => {
    const themes = await client.request("theme.list", {});
    expect(themes.themes).toContainEqual({
      id: SOFT_EDITORIAL_THEME_ID,
      name: "Soft Editorial",
      isBuiltIn: true,
      version: SOFT_EDITORIAL_THEME_VERSION,
    });
    expect(themes.themes).toContainEqual({
      id: themeId,
      name: "エージェント用テーマ",
      isBuiltIn: false,
      version: 1,
    });
    expect(themes.themes.some((theme) => theme.id === archivedThemeId)).toBe(false);

    const theme = await client.request("theme.get", { themeId });
    expect(theme.theme.definition.id).toBe(themeId);
    await expectAgentError(
      client.request("theme.get", { themeId: archivedThemeId }),
      "RESOURCE_NOT_FOUND",
    );

    const faceSets = await client.request("faceSet.list", {});
    const listedFaceSet = faceSets.faceSets.find((entry) => entry.id === faceSetId);
    expect(listedFaceSet?.expressions.map((expression) => expression.id)).toEqual([
      "smile",
    ]);
    const faceSet = await client.request("faceSet.get", { faceSetId });
    expect(faceSet.faceSet.id).toBe(faceSetId);
    await expectAgentError(
      client.request("faceSet.get", { faceSetId: "missing" }),
      "RESOURCE_NOT_FOUND",
    );

    const profiles = await client.request("voiceProfile.list", {});
    expect(profiles.voiceProfiles).toContainEqual(
      expect.objectContaining({ id: jaVoiceProfileId, locale: "ja-JP" }),
    );
    const profile = await client.request("voiceProfile.get", {
      voiceProfileId: jaVoiceProfileId,
    });
    expect(profile.voiceProfile.id).toBe(jaVoiceProfileId);
    await expectAgentError(
      client.request("voiceProfile.get", { voiceProfileId: "missing" }),
      "RESOURCE_NOT_FOUND",
    );
  });

  it("creates a keyed narrator, selects a user Theme, and enforces voice rules", async () => {
    const work = await createWork(`ナレーター-${randomUUID()}`);
    const edition = firstEdition(work);
    const initial = await client.request("script.get", {
      languageEditionId: edition.id,
    });

    const edited = await client.request("script.edit", {
      baseScriptVersionId: initial.scriptVersion.id,
      requestId: `narrator-${randomUUID()}`,
      operations: [
        {
          op: "speaker.add",
          key: "narrator",
          name: "ナレーター",
          voiceProfileId: jaVoiceProfileId,
        },
        {
          op: "line.add",
          key: "narrator-line",
          sceneId: DEFAULT_SCENE_IDS.point1,
          captionText: "こんにちは",
          speechText: "こんにちは",
          speakerId: { key: "narrator" },
        },
        {
          op: "document.setVisualTheme",
          id: themeId,
          version: 1,
        },
      ],
    });
    const speakerId = edited.created.speakerIds[0]!;
    const lineId = edited.created.lineIds[0]!;
    expect(edited.scriptVersion.content.visualTheme).toEqual({
      id: themeId,
      version: 1,
    });
    expect(
      edited.scriptVersion.content.speakers.find((speaker) => speaker.id === speakerId),
    ).toMatchObject({
      name: "ナレーター",
      characterId: null,
      voiceProfileId: jaVoiceProfileId,
    });
    expect(
      edited.scriptVersion.content.scenes
        .flatMap((scene) => scene.lines)
        .find((line) => line.id === lineId)?.speakerId,
    ).toBe(speakerId);

    const changed = await client.request("script.edit", {
      baseScriptVersionId: edited.scriptVersion.id,
      requestId: `narrator-voice-${randomUUID()}`,
      operations: [
        {
          op: "speaker.setVoiceProfile",
          speakerId,
          voiceProfileId: jaVoiceProfile2Id,
        },
      ],
    });
    expect(
      changed.scriptVersion.content.speakers.find((speaker) => speaker.id === speakerId)
        ?.voiceProfileId,
    ).toBe(jaVoiceProfile2Id);

    await expectAgentError(
      client.request("script.edit", {
        baseScriptVersionId: changed.scriptVersion.id,
        requestId: `narrator-locale-${randomUUID()}`,
        operations: [
          {
            op: "speaker.setVoiceProfile",
            speakerId,
            voiceProfileId: enVoiceProfileId,
          },
        ],
      }),
      "EDIT_PRECONDITION_FAILED",
    );
    await expectAgentError(
      client.request("script.edit", {
        baseScriptVersionId: changed.scriptVersion.id,
        requestId: `archived-theme-${randomUUID()}`,
        operations: [
          {
            op: "document.setVisualTheme",
            id: archivedThemeId,
            version: 1,
          },
        ],
      }),
      "EDIT_TARGET_NOT_FOUND",
    );
  });

  it("returns an empty created set when a speaker.add edit is replayed", async () => {
    const work = await createWork(`再生-${randomUUID()}`);
    const edition = firstEdition(work);
    const initial = await client.request("script.get", {
      languageEditionId: edition.id,
    });
    const requestId = `speaker-replay-${randomUUID()}`;
    const operations = [
      {
        op: "speaker.add" as const,
        name: "ナレーター",
        voiceProfileId: jaVoiceProfileId,
      },
    ];
    const first = await client.request("script.edit", {
      baseScriptVersionId: initial.scriptVersion.id,
      requestId,
      operations,
    });
    expect(first.replay).toBe(false);
    expect(first.created.speakerIds).toHaveLength(1);

    const replay = await client.request("script.edit", {
      baseScriptVersionId: initial.scriptVersion.id,
      requestId,
      operations,
    });
    expect(replay.replay).toBe(true);
    expect(replay.created.speakerIds).toEqual([]);
    expect(replay.scriptVersion.id).toBe(first.scriptVersion.id);

    const current = await client.request("script.get", {
      languageEditionId: edition.id,
    });
    expect(
      current.scriptVersion.content.speakers.some(
        (speaker) => speaker.id === first.created.speakerIds[0],
      ),
    ).toBe(true);
  });

  it.skipIf(!probeAvailable)(
    "rejects a Speaker voice that differs from the Character Voice",
    async () => {
      const work = await createWork(`キャラクター声-${randomUUID()}`);
      const edition = firstEdition(work);
      const initial = await client.request("script.get", {
        languageEditionId: edition.id,
      });
      const copied = await client.request("script.edit", {
        baseScriptVersionId: initial.scriptVersion.id,
        requestId: `copy-${randomUUID()}`,
        operations: [
          {
            op: "character.addFromLibrary",
            libraryCharacterId,
          },
        ],
      });
      const speakerId = copied.created.speakerIds[0]!;
      expect(
        copied.scriptVersion.content.speakers.find((speaker) => speaker.id === speakerId)
          ?.voiceProfileId,
      ).toBe(jaVoiceProfileId);

      await expectAgentError(
        client.request("script.edit", {
          baseScriptVersionId: copied.scriptVersion.id,
          requestId: `character-voice-${randomUUID()}`,
          operations: [
            {
              op: "speaker.setVoiceProfile",
              speakerId,
              voiceProfileId: jaVoiceProfile2Id,
            },
          ],
        }),
        "EDIT_PRECONDITION_FAILED",
      );
    },
  );

  it.skipIf(!probeAvailable)(
    "lists and fetches a library character with voices and Face Set references",
    async () => {
      const listed = await client.request("character.list", {});
      const entry = listed.characters.find((row) => row.id === libraryCharacterId);
      expect(entry).toBeDefined();
      expect(entry?.name).toBe("四国めたん");
      expect(entry?.voices).toEqual([
        { locale: "ja-JP", voiceProfileId: jaVoiceProfileId },
        { locale: "en-US", voiceProfileId: enVoiceProfileId },
      ]);
      expect(entry?.appearances).toHaveLength(2);
      expect(
        entry?.appearances.find((appearance) => appearance.id === "library-appearance-face"),
      ).toMatchObject({ faceSetId, label: "夏服" });
      expect(
        entry?.appearances.find((appearance) => appearance.id === "library-appearance-plain"),
      ).toMatchObject({ faceSetId: null });

      const fetched = await client.request("character.get", {
        characterId: libraryCharacterId,
      });
      expect(fetched.character).toEqual(entry);

      await expectAgentError(
        client.request("character.get", { characterId: "missing-character" }),
        "RESOURCE_NOT_FOUND",
      );
    },
  );

  it.skipIf(!probeAvailable)(
    "copies the library character, keeps the copy local and persists speaker and standing IDs",
    async () => {
      const work = await createWork("キャラクター統合テスト作品");
      const edition = firstEdition(work);
      const initial = await client.request("script.get", { languageEditionId: edition.id });
      const pointScene = initial.scriptVersion.content.scenes.find(
        (scene) => scene.kind === "point",
      );
      if (pointScene === undefined) {
        throw new Error("point scene missing");
      }

      const first = await client.request("script.edit", {
        baseScriptVersionId: edition.currentScriptVersion.id,
        requestId: "character-copy-1",
        operations: [
          { op: "character.addFromLibrary", libraryCharacterId },
          { op: "character.addFromLibrary", libraryCharacterId },
        ],
      });
      expect(first.replay).toBe(false);
      expect(first.created.characterIds).toHaveLength(2);
      expect(first.created.appearanceIds).toHaveLength(4);
      expect(first.created.speakerIds).toHaveLength(2);
      expect(new Set(first.created.characterIds).size).toBe(2);
      expect(new Set(first.created.appearanceIds).size).toBe(4);
      expect(new Set(first.created.speakerIds).size).toBe(2);
      // The point-scene add does not create any scene, line or cue.
      expect(first.created.sceneIds).toEqual([]);
      expect(first.created.lineIds).toEqual([]);
      expect(first.created.cueIds).toEqual([]);

      const library = await client.request("character.get", {
        characterId: libraryCharacterId,
      });
      const firstCharacterId = first.created.characterIds[0]!;
      const secondCharacterId = first.created.characterIds[1]!;
      const firstSpeakerId = first.created.speakerIds[0]!;
      const secondSpeakerId = first.created.speakerIds[1]!;
      const firstAppearanceId = first.created.appearanceIds[0]!;
      const secondAppearanceId = first.created.appearanceIds[2]!;

      const readBack = await client.request("script.get", {
        scriptVersionId: first.scriptVersion.id,
      });
      for (const [characterId, speakerId] of [
        [firstCharacterId, firstSpeakerId],
        [secondCharacterId, first.created.speakerIds[1]!],
      ] as const) {
        const copied = readBack.scriptVersion.content.characters.find(
          (character) => character.id === characterId,
        );
        expect(copied).toBeDefined();
        expect(copied?.id).not.toBe(library.character.id);
        expect(copied?.name).toBe(library.character.name);
        expect(copied?.voices).toEqual(library.character.voices);
        expect(copied?.appearances).toHaveLength(2);
        for (const appearance of copied?.appearances ?? []) {
          const source = library.character.appearances.find(
            (entry) =>
              entry.assetId === appearance.assetId &&
              entry.expression === appearance.expression &&
              entry.pose === appearance.pose,
          );
          expect(source).toBeDefined();
          expect(appearance.id).not.toBe(source?.id);
          expect(appearance.faceSetId).toBe(source?.faceSetId);
          expect(appearance.label).toBe(source?.label);
        }
        const speaker = readBack.scriptVersion.content.speakers.find(
          (entry) => entry.id === speakerId,
        );
        expect(speaker).toMatchObject({
          name: library.character.name,
          characterId,
          voiceProfileId: jaVoiceProfileId,
        });
      }
      // The library itself is read-only and unchanged.
      const libraryAfter = await client.request("character.get", {
        characterId: libraryCharacterId,
      });
      expect(libraryAfter.character).toEqual(library.character);

      // `script.validate` shares the same resource loading, so the copy
      // operation must resolve there too without writing a version.
      const validatedCopy = await client.request("script.validate", {
        baseScriptVersionId: first.scriptVersion.id,
        operations: [{ op: "character.addFromLibrary", libraryCharacterId }],
      });
      expect(validatedCopy.timeline.totalDurationMs).toBeGreaterThan(0);

      const second = await client.request("script.edit", {
        baseScriptVersionId: first.scriptVersion.id,
        requestId: "character-copy-2",
        operations: [
          {
            op: "line.add",
            key: "line-a",
            sceneId: pointScene.id,
            captionText: "コピーした話者です。",
            speechText: "コピーした話者です。",
            speakerId: firstSpeakerId,
          },
          {
            op: "line.add",
            key: "line-b",
            sceneId: pointScene.id,
            captionText: "話者を設定します。",
            speechText: "話者を設定します。",
          },
          {
            op: "line.setSpeaker",
            sceneId: pointScene.id,
            lineId: { key: "line-b" },
            speakerId: secondSpeakerId,
          },
          {
            op: "standing.set",
            sceneId: pointScene.id,
            side: "left",
            characterId: firstCharacterId,
            appearanceId: firstAppearanceId,
          },
        ],
      });

      const finalContent = second.scriptVersion.content;
      const finalScene = finalContent.scenes.find((scene) => scene.id === pointScene.id);
      const lines = finalScene?.lines ?? [];
      expect(lines).toHaveLength(2);
      expect(lines[0]?.speakerId).toBe(firstSpeakerId);
      expect(lines[0]?.captionText).toBe("コピーした話者です。");
      expect(lines[1]?.speakerId).toBe(secondSpeakerId);
      expect(second.created.lineIds).toHaveLength(2);
      const standing = finalScene?.visualCues.find(
        (cue) => cue.template.id === "character.standing",
      );
      expect(standing?.input).toMatchObject({
        characterId: firstCharacterId,
        appearanceId: firstAppearanceId,
        side: "left",
      });
      expect(
        finalContent.characters.some(
          (character) =>
            character.id === secondCharacterId &&
            character.appearances.some((appearance) => appearance.id === secondAppearanceId),
        ),
      ).toBe(true);

      const validated = await client.request("script.validate", { content: finalContent });
      expect(validated.timeline.totalDurationMs).toBeGreaterThan(0);
    },
  );

  it.skipIf(!probeAvailable)(
    "selects the voice profile that matches the document locale",
    async () => {
      const work = await createWork("Character locale test", "en-US");
      const edition = firstEdition(work);
      const initial = await client.request("script.get", { languageEditionId: edition.id });
      expect(initial.scriptVersion.content.locale).toBe("en-US");

      const edited = await client.request("script.edit", {
        baseScriptVersionId: initial.scriptVersion.id,
        requestId: "character-copy-en",
        operations: [{ op: "character.addFromLibrary", libraryCharacterId }],
      });
      const characterId = edited.created.characterIds[0]!;
      const speaker = edited.scriptVersion.content.speakers.find(
        (entry) => entry.characterId === characterId,
      );
      expect(speaker?.voiceProfileId).toBe(enVoiceProfileId);
      expect(
        edited.scriptVersion.content.characters.find((entry) => entry.id === characterId)?.voices,
      ).toEqual([
        { locale: "ja-JP", voiceProfileId: jaVoiceProfileId },
        { locale: "en-US", voiceProfileId: enVoiceProfileId },
      ]);
    },
  );

  it.skipIf(!probeAvailable)(
    "returns EDIT_TARGET_NOT_FOUND for an unknown library character",
    async () => {
      const work = await createWork("Character error test");
      const edition = firstEdition(work);
      const error = await expectAgentError(
        client.request("script.edit", {
          baseScriptVersionId: edition.currentScriptVersion.id,
          requestId: "character-copy-missing",
          operations: [
            { op: "character.addFromLibrary", libraryCharacterId: "missing-character" },
          ],
        }),
        "EDIT_TARGET_NOT_FOUND",
      );
      expect(error.issues?.[0]?.path).toEqual(["operations", 0, "libraryCharacterId"]);
      // A failed batch does not create a version.
      const current = await client.request("script.get", { languageEditionId: edition.id });
      expect(current.scriptVersion.id).toBe(edition.currentScriptVersion.id);
    },
  );
});
