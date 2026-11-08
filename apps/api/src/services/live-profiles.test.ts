import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  contentDocumentSchema,
  type Character,
  type ContentDocument,
} from "@kakeai/contracts";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import type { AppConfig } from "../config.ts";
import { loadConfig } from "../config.ts";
import { createPrismaClient } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { applySqlitePragmas } from "../db/pragmas.ts";
import { ensureDataDirectories } from "../storage/paths.ts";
import * as scriptVersions from "../services/script-versions.ts";
import * as works from "../services/works.ts";
import { buildLiveAutoProfile } from "./live-profiles.ts";

function character(id: string, name: string): Character {
  return {
    id,
    name,
    names: [],
    voices: [{ locale: "ja-JP", voiceProfileId: `voice-${id}` }],
    appearances: [
      {
        id: `appearance-${id}`,
        assetId: "asset-bg",
        expression: "normal",
        pose: "standing",
        faceSetId: null,
        faceSetVersion: null,
        libraryAppearanceId: null,
      },
    ],
    libraryCharacterId: null,
  };
}

function line(id: string, speakerId: string, caption: string, speech: string) {
  return {
    id,
    speakerId,
    captionText: caption,
    speechText: speech,
    selectedAudioTakeId: null,
    expressionId: null,
  };
}

function contentWithCast(): ContentDocument {
  const content = validContentDocument();
  content.speakers = [
    {
      id: "speaker-left",
      name: "左",
      characterId: "char-left",
      voiceProfileId: "voice-char-left",
    },
    {
      id: "speaker-right",
      name: "右",
      characterId: "char-right",
      voiceProfileId: "voice-char-right",
    },
  ];
  content.characters = [character("char-left", "左キャラ"), character("char-right", "右キャラ")];
  content.scenes[0]!.lines = [
    line("line-intro", "speaker-left", "オープニングです。", "おーぷにんぐです。"),
  ];
  content.scenes[1]!.lines = [
    line("line-p1-1", "speaker-left", "最初の要点です。", "さいしょのようてんです。"),
  ];
  content.scenes[2]!.lines = [
    line("line-p2-1", "speaker-right", "二番目の要点です。", "にばんめのようてんです。"),
  ];
  content.scenes[4]!.lines = [
    line("line-outro", "speaker-left", "終わりです。", "おわりです。"),
  ];
  return contentDocumentSchema.parse(content);
}

async function createAsset(
  prisma: ReturnType<typeof createPrismaClient>,
  input: {
    id: string;
    kind: "image" | "audio";
    mediaType: string;
    durationMs: number | null;
    widthPx: number | null;
    heightPx: number | null;
    hasAudio: boolean;
  },
) {
  return prisma.asset.create({
    data: {
      id: input.id,
      kind: input.kind,
      origin: "uploaded",
      status: "ready",
      storageKey: `assets/${input.id}`,
      originalFilename: input.kind === "image" ? "image.png" : "audio.wav",
      mediaType: input.mediaType,
      byteSize: BigInt(10),
      sha256: `sha-${input.id}`,
      durationMs: input.durationMs,
      widthPx: input.widthPx,
      heightPx: input.heightPx,
      hasAudio: input.hasAudio,
    },
  });
}

let dataDir: string;
let config: AppConfig;
let prisma: ReturnType<typeof createPrismaClient>;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-live-profiles-"));
  process.env.KAKEAI_DATA_DIR = dataDir;
  config = loadConfig();
  await ensureDataDirectories(config.directories);
  await runMigrations();
  prisma = createPrismaClient(config.databaseUrl);
  await applySqlitePragmas(prisma);

  await createAsset(prisma, {
    id: "asset-bg",
    kind: "image",
    mediaType: "image/png",
    durationMs: null,
    widthPx: 1,
    heightPx: 1,
    hasAudio: false,
  });
  await createAsset(prisma, {
    id: "asset-audio-1",
    kind: "audio",
    mediaType: "audio/wav",
    durationMs: 3000,
    widthPx: null,
    heightPx: null,
    hasAudio: true,
  });
  await createAsset(prisma, {
    id: "asset-bgm",
    kind: "audio",
    mediaType: "audio/wav",
    durationMs: 5000,
    widthPx: null,
    heightPx: null,
    hasAudio: true,
  });
  await prisma.voiceProfile.createMany({
    data: [
      {
        id: "voice-char-left",
        name: "左の声",
        adapterId: "voicevox",
        voiceId: "voice-left",
        locale: "ja-JP",
        settingsJson: "{}",
      },
      {
        id: "voice-char-right",
        name: "右の声",
        adapterId: "voicevox",
        voiceId: "voice-right",
        locale: "ja-JP",
        settingsJson: "{}",
      },
    ],
  });
}, 60000);

afterAll(async () => {
  await prisma.$disconnect();
  delete process.env.KAKEAI_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe("buildLiveAutoProfile", () => {
  it("generates a profile from the Work and ScriptVersion", async () => {
    const work = await works.createWork(prisma, "自動生成テスト", "ja-JP");
    const edition = work.languageEditions[0]!;
    const saved = await scriptVersions.saveScriptVersion(prisma, edition.id, {
      sourceScriptVersionId: null,
      content: contentWithCast(),
    });

    const result = await buildLiveAutoProfile(prisma, {
      workId: work.id,
      scriptVersionId: saved.scriptVersion.id,
      includeCommentCorners: true,
    });

    expect(result.profile.show.title).toBe("自動生成テスト");
    expect(result.profile.segments.map((segment) => segment.kind)).toEqual([
      "opening",
      "script",
      "comment",
      "script",
      "closing",
    ]);
    expect(result.profile.materials[0]?.sceneId).toBe("scene-point-3");
    expect(result.summary.characters).toEqual({
      left: "左キャラ",
      right: "右キャラ",
    });
    expect(result.warnings).toEqual([]);
  });

  it("rejects a ScriptVersion from another Work", async () => {
    const work = await works.createWork(prisma, "自動生成テスト2", "ja-JP");
    const edition = work.languageEditions[0]!;
    const saved = await scriptVersions.saveScriptVersion(prisma, edition.id, {
      sourceScriptVersionId: null,
      content: contentWithCast(),
    });
    const other = await works.createWork(prisma, "別の作品", "ja-JP");

    await expect(
      buildLiveAutoProfile(prisma, {
        workId: other.id,
        scriptVersionId: saved.scriptVersion.id,
        includeCommentCorners: true,
      }),
    ).rejects.toMatchObject({ status: 422, code: "VALIDATION_ERROR" });
  });

  it("rejects a ScriptVersion with no character speakers", async () => {
    const work = await works.createWork(prisma, "自動生成テスト3", "ja-JP");
    const edition = work.languageEditions[0]!;
    const saved = await scriptVersions.saveScriptVersion(prisma, edition.id, {
      sourceScriptVersionId: null,
      content: validContentDocument(),
    });

    await expect(
      buildLiveAutoProfile(prisma, {
        workId: work.id,
        scriptVersionId: saved.scriptVersion.id,
        includeCommentCorners: true,
      }),
    ).rejects.toMatchObject({ status: 422, code: "VALIDATION_ERROR" });
  });
});
