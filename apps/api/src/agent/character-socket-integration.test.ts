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
  type ContentDocument,
  type FontFace,
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

const FONT_FACES: FontFace[] = [
  {
    platformId: "HiraginoSans-W3",
    family: "Hiragino Sans",
    displayName: "Hiragino Sans W3",
    postScriptName: "HiraginoSans-W3",
    weight: 300,
    style: "normal",
    stretch: "normal",
    available: true,
  },
  {
    platformId: "HiraginoSans-W6",
    family: "Hiragino Sans",
    displayName: "Hiragino Sans W6",
    postScriptName: "HiraginoSans-W6",
    weight: 600,
    style: "normal",
    stretch: "normal",
    available: true,
  },
  {
    platformId: "HiraginoMinchoProN-W3",
    family: "Hiragino Mincho ProN",
    displayName: "Hiragino Mincho ProN W3",
    postScriptName: "HiraginoMinchoProN-W3",
    weight: 300,
    style: "normal",
    stretch: "normal",
    available: true,
  },
  {
    platformId: "TimesNewRomanPS-ItalicMT",
    family: "Times New Roman",
    displayName: "Times New Roman Italic",
    postScriptName: "TimesNewRomanPS-ItalicMT",
    weight: 400,
    style: "italic",
    stretch: "normal",
    available: true,
  },
];

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
    fontCatalogService: new FontCatalogService(
      new FakeFontCatalogAdapter(true, FONT_FACES),
    ),
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
      revisions: {
        create: {
          versionNumber: 1,
          expressions: {
            create: [{ id: "smile", name: "smile", position: 0 }],
          },
        },
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
    names: [],
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
  it("catalogs character reads and writes and keeps deletion unregistered", async () => {
    const schema = await client.request("schema.get", {});
    for (const name of ["character.list", "character.get"] as const) {
      expect(schema.agentOperations).toContainEqual({
        name,
        kind: "read",
        longRunning: false,
      });
    }
    for (const name of [
      "character.setVoices",
      "character.create",
      "character.update",
      "character.addAppearance",
      "character.updateAppearance",
    ] as const) {
      expect(schema.agentOperations).toContainEqual({
        name,
        kind: "mutation",
        longRunning: false,
      });
    }
    expect(schema.operations).toContainEqual({
      name: "character.addFromLibrary",
      category: "character",
    });

    const response = await rawRequest(client.socketPath, "character.delete", {
      characterId: libraryCharacterId,
    });
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe("AGENT_OPERATION_UNKNOWN");
    }
  });

  it("catalogs library reads and keeps Theme archive/delete, Face Set deletion and Voice Profile deletion unregistered", async () => {
    const schema = await client.request("schema.get", {});
    for (const name of [
      "theme.list",
      "theme.get",
      "faceSet.list",
      "faceSet.get",
      "faceSet.usages",
      "voiceProfile.list",
      "voiceProfile.get",
      "voiceProfile.listVoices",
      "voiceProfile.listModels",
    ] as const) {
      expect(schema.agentOperations).toContainEqual({
        name,
        kind: "read",
        longRunning: false,
      });
    }
    for (const name of [
      "voiceProfile.create",
      "voiceProfile.update",
      "faceSet.create",
      "faceSet.update",
    ] as const) {
      expect(schema.agentOperations).toContainEqual({
        name,
        kind: "mutation",
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
      "theme.update",
      "theme.archive",
      "theme.delete",
      "faceSet.delete",
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

  it("replaces a library character's voices without touching appearances", async () => {
    const entry = await createCharacter(prisma, {
      name: `声付け替え-${randomUUID()}`,
      names: [],
      voices: [],
      appearances: [],
    });

    const assigned = await client.request("character.setVoices", {
      characterId: entry.id,
      voices: [{ locale: "ja-JP", voiceProfileId: jaVoiceProfileId }],
    });
    expect(assigned.character.id).toBe(entry.id);
    expect(assigned.character.voices).toEqual([
      { locale: "ja-JP", voiceProfileId: jaVoiceProfileId },
    ]);
    expect(assigned.character.appearances).toEqual([]);

    const replaced = await client.request("character.setVoices", {
      characterId: entry.id,
      voices: [
        { locale: "ja-JP", voiceProfileId: jaVoiceProfile2Id },
        { locale: "en-US", voiceProfileId: enVoiceProfileId },
      ],
    });
    expect(replaced.character.voices).toEqual([
      { locale: "ja-JP", voiceProfileId: jaVoiceProfile2Id },
      { locale: "en-US", voiceProfileId: enVoiceProfileId },
    ]);

    const cleared = await client.request("character.setVoices", {
      characterId: entry.id,
      voices: [],
    });
    expect(cleared.character.voices).toEqual([]);

    const fetched = await client.request("character.get", { characterId: entry.id });
    expect(fetched.character.voices).toEqual([]);

    await expectAgentError(
      client.request("character.setVoices", {
        characterId: "missing-character",
        voices: [{ locale: "ja-JP", voiceProfileId: jaVoiceProfileId }],
      }),
      "RESOURCE_NOT_FOUND",
    );
    await expectAgentError(
      client.request("character.setVoices", {
        characterId: entry.id,
        voices: [{ locale: "ja-JP", voiceProfileId: "missing-profile" }],
      }),
      "VALIDATION_ERROR",
    );
    await expectAgentError(
      client.request("character.setVoices", {
        characterId: entry.id,
        voices: [{ locale: "en-US", voiceProfileId: jaVoiceProfileId }],
      }),
      "VALIDATION_ERROR",
    );
    await expectAgentError(
      client.request("character.setVoices", {
        characterId: entry.id,
        voices: [
          { locale: "ja-JP", voiceProfileId: jaVoiceProfileId },
          { locale: "ja-JP", voiceProfileId: jaVoiceProfile2Id },
        ],
      }),
      "VALIDATION_ERROR",
    );
  });

  it.skipIf(!probeAvailable)(
    "adds and updates a single appearance on a library character and verifies edge cases",
    async () => {
      const created = await client.request("character.create", {
        name: `外観差分テスト-${randomUUID()}`,
        voices: [{ locale: "ja-JP", voiceProfileId: jaVoiceProfileId }],
        appearances: [
          { assetId: imageAssetId, expression: "smile", pose: "front", label: "初期服", faceSetId },
        ],
      });
      const initialAppearanceId = created.character.appearances[0]!.id;
      const initialUpdatedAt = created.character.updatedAt;

      // 1. character.addAppearance: adds a new appearance at the end
      const added = await client.request("character.addAppearance", {
        characterId: created.character.id,
        assetId: imageAssetId,
        expression: "wink",
        pose: "side",
        label: "追加服",
        faceSetId: null,
      });
      expect(added.character.appearances).toHaveLength(2);
      expect(added.character.appearances[0]).toMatchObject({
        id: initialAppearanceId,
        expression: "smile",
        label: "初期服",
      });
      const newAppearance = added.character.appearances[1]!;
      expect(newAppearance.id).not.toBe(initialAppearanceId);
      expect(newAppearance).toMatchObject({
        assetId: imageAssetId,
        expression: "wink",
        pose: "side",
        label: "追加服",
        faceSetId: null,
      });
      expect(new Date(added.character.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(initialUpdatedAt).getTime(),
      );

      // 2. character.updateAppearance: update expression only (other fields preserved)
      const expressionUpdated = await client.request("character.updateAppearance", {
        characterId: created.character.id,
        appearanceId: initialAppearanceId,
        expression: "angry",
      });
      expect(expressionUpdated.character.appearances[0]).toMatchObject({
        id: initialAppearanceId,
        assetId: imageAssetId,
        expression: "angry",
        pose: "front",
        label: "初期服",
        faceSetId,
      });
      expect(expressionUpdated.character.appearances[1]).toEqual(newAppearance);
      expect(new Date(expressionUpdated.character.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(added.character.updatedAt).getTime(),
      );

      // 3. character.updateAppearance: clear label and faceSetId with null
      const cleared = await client.request("character.updateAppearance", {
        characterId: created.character.id,
        appearanceId: initialAppearanceId,
        label: null,
        faceSetId: null,
      });
      expect(cleared.character.appearances[0]).toMatchObject({
        id: initialAppearanceId,
        assetId: imageAssetId,
        expression: "angry",
        pose: "front",
        faceSetId: null,
      });
      expect(cleared.character.appearances[0]!.label).toBeUndefined();
      expect(new Date(cleared.character.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(expressionUpdated.character.updatedAt).getTime(),
      );

      // 4. Edge cases & Validation errors
      // - 0 fields specified -> VALIDATION_ERROR
      await expectAgentError(
        client.request("character.updateAppearance", {
          characterId: created.character.id,
          appearanceId: initialAppearanceId,
        }),
        "VALIDATION_ERROR",
      );

      // - Unknown characterId -> RESOURCE_NOT_FOUND
      await expectAgentError(
        client.request("character.addAppearance", {
          characterId: "missing-character",
          assetId: imageAssetId,
          expression: "smile",
          pose: "front",
        }),
        "RESOURCE_NOT_FOUND",
      );
      await expectAgentError(
        client.request("character.updateAppearance", {
          characterId: "missing-character",
          appearanceId: initialAppearanceId,
          expression: "smile",
        }),
        "RESOURCE_NOT_FOUND",
      );

      // - Unknown appearanceId -> RESOURCE_NOT_FOUND
      await expectAgentError(
        client.request("character.updateAppearance", {
          characterId: created.character.id,
          appearanceId: "missing-appearance",
          expression: "smile",
        }),
        "RESOURCE_NOT_FOUND",
      );

      // - Asset and FaceSet reference validation error (e.g. invalid assetId)
      await expectAgentError(
        client.request("character.addAppearance", {
          characterId: created.character.id,
          assetId: "missing-asset",
          expression: "smile",
          pose: "front",
        }),
        "VALIDATION_ERROR",
      );

      // - 50 appearances limit -> VALIDATION_ERROR
      const charWith50 = await createCharacter(prisma, {
        name: `50件テスト-${randomUUID()}`,
        names: [],
        voices: [],
        appearances: [],
      });
      await prisma.characterAppearance.createMany({
        data: Array.from({ length: 50 }, (_, i) => ({
          id: `app-limit-${i}`,
          characterId: charWith50.id,
          assetId: imageAssetId,
          expression: "smile",
          pose: "front",
          position: i,
        })),
      });
      await expectAgentError(
        client.request("character.addAppearance", {
          characterId: charWith50.id,
          assetId: imageAssetId,
          expression: "smile",
          pose: "front",
        }),
        "VALIDATION_ERROR",
      );

      // 5. Existing appearance can be updated via character.updateAppearance
      const arrayUpdated = await client.request("character.updateAppearance", {
        characterId: created.character.id,
        appearanceId: initialAppearanceId,
        expression: "smile",
        pose: "front",
      });
      expect(arrayUpdated.character.appearances).toHaveLength(2);
      expect(arrayUpdated.character.appearances[0]!.id).toBe(initialAppearanceId);
    },
  );

  it.skipIf(!probeAvailable)(
    "creates and partially updates a library character",
    async () => {
      const created = await client.request("character.create", {
        name: "エージェント作成",
        names: [{ locale: "ja-JP", name: "エージェント作成" }],
        voices: [{ locale: "ja-JP", voiceProfileId: jaVoiceProfileId }],
        appearances: [
          { assetId: imageAssetId, expression: "smile", pose: "front", faceSetId },
        ],
      });
      expect(created.character.name).toBe("エージェント作成");
      expect(created.character.appearances).toHaveLength(1);
      // The appearance id is assigned by the server, not invented by the caller.
      expect(created.character.appearances[0]!.id.length).toBeGreaterThan(0);

      // A metadata-only update leaves voices and appearances alone.
      const renamed = await client.request("character.update", {
        characterId: created.character.id,
        name: "エージェント改名",
      });
      expect(renamed.character.name).toBe("エージェント改名");
      expect(renamed.character.voices).toEqual(created.character.voices);
      expect(renamed.character.appearances).toEqual(created.character.appearances);

      // Replacing appearances leaves names and voices alone. Existing IDs are
      // preserved so work copies keep their library-appearance link.
      const firstAppearanceId = created.character.appearances[0]!.id;
      const updatedAppearance = await client.request("character.updateAppearance", {
        characterId: created.character.id,
        appearanceId: firstAppearanceId,
        expression: "normal",
        pose: "side",
        label: "私服",
        faceSetId: null,
      });
      const addedAppearance = await client.request("character.addAppearance", {
        characterId: created.character.id,
        assetId: imageAssetId,
        expression: "smile",
        pose: "front",
        faceSetId,
      });
      const appearanceUpdated = addedAppearance;
      expect(appearanceUpdated.character.names).toEqual(created.character.names);
      expect(appearanceUpdated.character.voices).toEqual(created.character.voices);
      expect(appearanceUpdated.character.appearances).toHaveLength(2);
      expect(updatedAppearance.character.appearances[0]).toMatchObject({
        id: firstAppearanceId,
        expression: "normal",
        pose: "side",
        label: "私服",
        faceSetId: null,
      });

      // Replacing voices leaves appearances alone.
      const voiceUpdated = await client.request("character.update", {
        characterId: created.character.id,
        voices: [],
      });
      expect(voiceUpdated.character.voices).toEqual([]);
      expect(voiceUpdated.character.appearances).toEqual(
        appearanceUpdated.character.appearances,
      );

      const fetched = await client.request("character.get", {
        characterId: created.character.id,
      });
      expect(fetched.character).toEqual(voiceUpdated.character);

      await expectAgentError(
        client.request("character.update", {
          characterId: "missing-character",
          name: "x",
        }),
        "RESOURCE_NOT_FOUND",
      );
      await expectAgentError(
        client.request("character.update", { characterId: created.character.id }),
        "VALIDATION_ERROR",
      );
      await expectAgentError(
        client.request("character.update", {
          characterId: created.character.id,
          voices: [{ locale: "en-US", voiceProfileId: jaVoiceProfileId }],
        }),
        "VALIDATION_ERROR",
      );
    },
  );

  it("creates a voice-only library character and copies it into a script", async () => {
    const created = await client.request("character.create", {
      name: `声だけ-${randomUUID()}`,
      voices: [{ locale: "ja-JP", voiceProfileId: jaVoiceProfileId }],
    });
    expect(created.character.appearances).toEqual([]);

    const work = await createWork(`声だけ-${randomUUID()}`);
    const edition = firstEdition(work);
    const initial = await client.request("script.get", {
      languageEditionId: edition.id,
    });
    const copied = await client.request("script.edit", {
      baseScriptVersionId: initial.scriptVersion.id,
      requestId: `voice-only-copy-${randomUUID()}`,
      operations: [
        { op: "character.addFromLibrary", libraryCharacterId: created.character.id },
      ],
    });
    const speakerId = copied.created.speakerIds[0]!;
    expect(
      copied.scriptVersion.content.speakers.find((speaker) => speaker.id === speakerId)
        ?.voiceProfileId,
    ).toBe(jaVoiceProfileId);
    const characterId = copied.created.characterIds[0]!;
    expect(
      copied.scriptVersion.content.characters.find(
        (character) => character.id === characterId,
      )?.appearances,
    ).toEqual([]);
  });

  it.skipIf(!probeAvailable)(
    "copies the voice assigned by character.setVoices into a script",
    async () => {
      const entry = await createCharacter(prisma, {
        name: `声コピー-${randomUUID()}`,
        names: [],
        voices: [{ locale: "ja-JP", voiceProfileId: jaVoiceProfile2Id }],
        appearances: [
          {
            id: `appearance-${randomUUID()}`,
            assetId: imageAssetId,
            expression: "normal",
            pose: "front",
            faceSetId: null,
          },
        ],
      });

      await client.request("character.setVoices", {
        characterId: entry.id,
        voices: [{ locale: "ja-JP", voiceProfileId: jaVoiceProfileId }],
      });

      const work = await createWork(`声コピー-${randomUUID()}`);
      const edition = firstEdition(work);
      const initial = await client.request("script.get", {
        languageEditionId: edition.id,
      });
      const copied = await client.request("script.edit", {
        baseScriptVersionId: initial.scriptVersion.id,
        requestId: `set-voices-copy-${randomUUID()}`,
        operations: [{ op: "character.addFromLibrary", libraryCharacterId: entry.id }],
      });
      const speakerId = copied.created.speakerIds[0]!;
      expect(
        copied.scriptVersion.content.speakers.find((speaker) => speaker.id === speakerId)
          ?.voiceProfileId,
      ).toBe(jaVoiceProfileId);
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
            op: "standing.upsert",
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

describe("agent font and theme revision reads over the socket", () => {
  async function addThemeRevision(themeId: string, version: number): Promise<void> {
    const base = getVisualTheme(SOFT_EDITORIAL_THEME_ID, SOFT_EDITORIAL_THEME_VERSION);
    if (base === undefined) {
      throw new Error("built-in theme missing");
    }
    await prisma.themeRevision.create({
      data: {
        themeId,
        versionNumber: version,
        definitionJson: JSON.stringify({
          ...toVisualThemeDefinitionV2(base),
          id: themeId,
          name: "版付きテーマ",
          version,
        }),
      },
    });
  }

  it("pages the installed font catalog with filters", async () => {
    const first = await client.request("font.list", {
      query: "hiragino",
      limit: 1,
    });
    expect(first.total).toBe(3);
    expect(first.fonts).toHaveLength(1);
    expect(first.fonts[0]?.family).toBe("Hiragino Mincho ProN");
    expect(first.nextOffset).toBe(1);
    expect(first.catalog).toMatchObject({ supported: true, reason: null });

    const rest = await client.request("font.list", {
      query: "hiragino",
      limit: 10,
      offset: 1,
    });
    expect(rest.fonts.map((entry) => entry.family)).toEqual([
      "Hiragino Sans",
      "Hiragino Sans",
    ]);
    expect(rest.nextOffset).toBeNull();

    const italic = await client.request("font.list", { style: "italic" });
    expect(italic.total).toBe(1);
    expect(italic.fonts[0]?.postScriptName).toBe("TimesNewRomanPS-ItalicMT");

    await expectAgentError(
      client.request("font.list", { minWeight: 700, maxWeight: 400 }),
      "VALIDATION_ERROR",
    );
  });

  it("reads an older Theme Revision, including an archived Theme, and diagnoses its fonts", async () => {
    const versionedThemeId = await seedTheme("版付きテーマ");
    await addThemeRevision(versionedThemeId, 2);

    const latest = await client.request("theme.get", { themeId: versionedThemeId });
    expect(latest.theme.version).toBe(2);
    const first = await client.request("theme.get", {
      themeId: versionedThemeId,
      version: 1,
    });
    expect(first.theme.version).toBe(1);
    expect(first.theme.definition.version).toBe(1);

    await prisma.theme.update({
      where: { id: versionedThemeId },
      data: { archivedAt: new Date() },
    });
    const archived = await client.request("theme.get", {
      themeId: versionedThemeId,
      version: 1,
    });
    expect(archived.theme.version).toBe(1);
    await expectAgentError(
      client.request("theme.get", { themeId: versionedThemeId }),
      "RESOURCE_NOT_FOUND",
    );
    await expectAgentError(
      client.request("theme.get", { themeId: versionedThemeId, version: 9 }),
      "RESOURCE_NOT_FOUND",
    );

    const diagnosis = await client.request("theme.diagnose", {
      themeId: versionedThemeId,
      version: 1,
    });
    expect(diagnosis.diagnosis.themeId).toBe(versionedThemeId);
    expect(diagnosis.diagnosis.version).toBe(1);
    expect(diagnosis.diagnosis.locale).toBe("ja-JP");
    expect(diagnosis.diagnosis.roles).toHaveLength(8);
    expect(diagnosis.diagnosis.catalogSupported).toBe(true);
    expect(diagnosis.diagnosis.missingFonts).toEqual([]);
  });

  it("reports a missing font family for a Theme Revision", async () => {
    const base = getVisualTheme(SOFT_EDITORIAL_THEME_ID, SOFT_EDITORIAL_THEME_VERSION);
    if (base === undefined) {
      throw new Error("built-in theme missing");
    }
    const theme = await prisma.theme.create({ data: { name: "診断用" } });
    const definition = structuredClone(toVisualThemeDefinitionV2(base));
    definition.id = theme.id;
    definition.name = "診断用";
    definition.version = 1;
    definition.textRoles.body.fontFace = {
      family: "Kakeai Missing Font",
      style: "normal",
      weight: 400,
      fallbacks: [],
    };
    await prisma.themeRevision.create({
      data: {
        themeId: theme.id,
        versionNumber: 1,
        definitionJson: JSON.stringify(definition),
      },
    });

    const diagnosis = await client.request("theme.diagnose", {
      themeId: theme.id,
      verify: false,
    });
    expect(diagnosis.diagnosis.missingFonts).toContain("Kakeai Missing Font");
    expect(diagnosis.diagnosis.roles.find((role) => role.role === "body")).toMatchObject({
      usesFallback: true,
    });
    expect(diagnosis.diagnosis.diagnostics.some((line) => line.startsWith("body:"))).toBe(
      true,
    );
  });
});

describe("agent theme lifecycle over the socket", () => {
  it("creates a Theme, edits its draft, publishes a Revision and refuses a second publish", async () => {
    const created = await client.request("theme.create", {
      name: "エージェント作成テーマ",
      sourceThemeRef: {
        id: SOFT_EDITORIAL_THEME_ID,
        version: SOFT_EDITORIAL_THEME_VERSION,
      },
    });
    expect(created.draft.definition.id).toBe(created.themeId);
    expect(created.draft.definition.name).toBe("エージェント作成テーマ");

    const fetched = await client.request("theme.draft.get", {
      themeId: created.themeId,
    });
    expect(fetched.draft?.definition.id).toBe(created.themeId);

    const definition = structuredClone(fetched.draft!.definition);
    definition.textRoles.body.fontSize = 44;
    const saved = await client.request("theme.draft.save", {
      themeId: created.themeId,
      definition,
    });
    expect(saved.draft.definition.textRoles.body.fontSize).toBe(44);

    const published = await client.request("theme.publish", {
      themeId: created.themeId,
    });
    expect(published.theme.version).toBe(1);
    expect(published.theme.definition.textRoles.body.fontSize).toBe(44);

    expect(
      (await client.request("theme.draft.get", { themeId: created.themeId })).draft,
    ).toBeNull();
    const read = await client.request("theme.get", {
      themeId: created.themeId,
      version: 1,
    });
    expect(read.theme.version).toBe(1);
    const list = await client.request("theme.list", {});
    expect(list.themes).toContainEqual({
      id: created.themeId,
      name: "エージェント作成テーマ",
      isBuiltIn: false,
      version: 1,
    });

    await expectAgentError(
      client.request("theme.publish", { themeId: created.themeId }),
      "INVALID_STATE",
    );
    await expectAgentError(
      client.request("theme.draft.get", { themeId: "missing-theme" }),
      "RESOURCE_NOT_FOUND",
    );
    expect(
      (await client.request("theme.draft.get", { themeId: SOFT_EDITORIAL_THEME_ID })).draft,
    ).toBeNull();
  });
});
