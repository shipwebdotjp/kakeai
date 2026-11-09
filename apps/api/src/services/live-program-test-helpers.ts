import { mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  liveFormatDocumentV1Schema,
  liveProgramDocumentSchema,
  type LiveFormatDocumentV1,
  type LiveProgramDocument,
} from "@kakeai/contracts";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { loadConfig } from "../config.ts";
import { createPrismaClient } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { applySqlitePragmas } from "../db/pragmas.ts";
import { serializeContent } from "../domain/content-json.ts";
import { ensureDataDirectories } from "../storage/paths.ts";

export interface LiveTestContext {
  dataDir: string;
  prisma: PrismaClient;
  close: () => Promise<void>;
}

export async function createLiveTestContext(prefix: string): Promise<LiveTestContext> {
  const dataDir = await mkdtemp(join(tmpdir(), prefix));
  const previousDataDir = process.env.KAKEAI_DATA_DIR;
  process.env.KAKEAI_DATA_DIR = dataDir;
  const config = loadConfig();
  await ensureDataDirectories(config.directories);
  await runMigrations();
  const prisma = createPrismaClient(config.databaseUrl);
  await applySqlitePragmas(prisma);
  return {
    dataDir,
    prisma,
    close: async () => {
      await prisma.$disconnect();
      if (previousDataDir === undefined) {
        delete process.env.KAKEAI_DATA_DIR;
      } else {
        process.env.KAKEAI_DATA_DIR = previousDataDir;
      }
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

export function testAssetSha(id: string): string {
  return createHash("sha256").update(`asset:${id}`).digest("hex");
}

export function testRenditionSha(id: string): string {
  return createHash("sha256").update(`rendition:${id}`).digest("hex");
}

export interface CreateLiveAssetInput {
  id: string;
  kind: "image" | "video" | "audio";
  mediaType: string;
  sha256?: string;
  rendition?: boolean;
  durationMs?: number;
  widthPx?: number;
  heightPx?: number;
  hasAudio?: boolean;
}

function defaultDimensions(input: CreateLiveAssetInput): {
  widthPx: number | null;
  heightPx: number | null;
} {
  if (input.widthPx !== undefined || input.heightPx !== undefined) {
    return {
      widthPx: input.widthPx ?? null,
      heightPx: input.heightPx ?? null,
    };
  }
  if (input.kind === "image" || input.kind === "video") {
    return { widthPx: 1920, heightPx: 1080 };
  }
  return { widthPx: null, heightPx: null };
}

export async function createLiveAsset(
  prisma: PrismaClient,
  input: CreateLiveAssetInput,
) {
  const sha256 = input.sha256 ?? testAssetSha(input.id);
  const dimensions = defaultDimensions(input);
  const durationMs =
    input.durationMs ?? (input.kind === "audio" ? 3000 : null);
  const asset = await prisma.asset.create({
    data: {
      id: input.id,
      kind: input.kind,
      origin: "uploaded",
      status: "ready",
      storageKey: `assets/${input.id}`,
      originalFilename: `file-${input.id}`,
      mediaType: input.mediaType,
      byteSize: BigInt(10),
      sha256,
      durationMs,
      widthPx: dimensions.widthPx,
      heightPx: dimensions.heightPx,
      hasAudio: input.hasAudio ?? input.kind === "audio",
    },
  });
  if (input.rendition) {
    await prisma.assetRendition.create({
      data: {
        id: `rendition-${input.id}`,
        assetId: input.id,
        purpose: "render",
        storageKey: `renditions/${input.id}`,
        mediaType: input.mediaType,
        sha256: testRenditionSha(input.id),
        byteSize: BigInt(8),
        durationMs,
        widthPx: dimensions.widthPx,
        heightPx: dimensions.heightPx,
      },
    });
  }
  return asset;
}

export async function createLiveCharacter(
  prisma: PrismaClient,
  input: {
    id: string;
    name: string;
    appearanceAssetId: string;
    faceSetId?: string | null;
  },
) {
  return prisma.character.create({
    data: {
      id: input.id,
      name: input.name,
      names: { create: [{ locale: "ja-JP", name: input.name }] },
      appearances: {
        create: [
          {
            assetId: input.appearanceAssetId,
            expression: "normal",
            pose: "standing",
            faceSetId: input.faceSetId ?? null,
          },
        ],
      },
    },
  });
}

export async function createLiveVoiceProfile(
  prisma: PrismaClient,
  input: {
    id: string;
    adapterId?: string;
    voiceId?: string;
    settingsJson?: string;
  },
) {
  return prisma.voiceProfile.create({
    data: {
      id: input.id,
      name: input.id,
      adapterId: input.adapterId ?? "voicevox",
      voiceId: input.voiceId ?? "voice-1",
      locale: "ja-JP",
      settingsJson: input.settingsJson ?? "{}",
    },
  });
}

export function liveFormatFixture(overrides: {
  characterId: string;
  voiceProfileId: string;
}): LiveFormatDocumentV1 {
  return liveFormatDocumentV1Schema.parse({
    schemaVersion: 1,
    name: "ニュース30分",
    title: "今週のニュース",
    locale: "ja-JP",
    targetDurationMs: 600_000,
    stageTemplate: "news-desk",
    theme: { id: "soft-editorial", version: 1 },
    cast: {
      left: {
        characterId: overrides.characterId,
        voiceProfileId: overrides.voiceProfileId,
      },
      right: null,
    },
    segments: [
      {
        id: "format-seg-opening",
        kind: "opening",
        label: "オープニング",
        targetDurationMs: 60_000,
      },
      {
        id: "format-seg-script",
        kind: "script",
        label: "本編",
        targetDurationMs: 300_000,
        visual: {
          kind: "card",
          cardId: "format-card-points",
          stateId: "format-state-title",
        },
      },
      {
        id: "format-cut-in",
        kind: "cut_in",
        label: "コーナーへ",
        targetDurationMs: 10_000,
      },
      {
        id: "format-seg-closing",
        kind: "closing",
        label: "クロージング",
        targetDurationMs: 60_000,
      },
    ],
    cues: [
      {
        id: "format-cue-opening",
        role: "opening",
        speaker: "left",
        caption: "今週も始まりました。",
        speech: "こんしゅうも はじまりました。",
        expression: "normal",
      },
      {
        id: "format-cue-closing",
        role: "closing",
        speaker: "left",
        caption: "本日はここまでです。",
        speech: "ほんじつは ここまでです。",
        expression: "normal",
      },
      {
        id: "format-cue-fallback",
        role: "fallback",
        speaker: "left",
        caption: "少し補足します。",
        speech: "すこし ほそくします。",
        expression: "normal",
      },
    ],
    cards: [
      {
        id: "format-card-points",
        type: "list",
        states: [
          { id: "format-state-title", title: "今日のポイント", items: [] },
          {
            id: "format-state-point-1",
            title: "今日のポイント",
            items: [{ id: "item-1", text: "新しい取り組み" }],
            activeItemId: "item-1",
          },
        ],
      },
    ],
    safety: {
      blockedTopics: [],
      persona: "親しみやすいニュース解説役。",
      maxResponseChars: 180,
      maxResponseCues: 2,
      fallbackCueId: "format-cue-fallback",
    },
  });
}

/** Adds one real script cue so the copied draft can pass version validation. */
export function addScriptCue(
  document: LiveProgramDocument,
  cueId = "test-script-cue",
): LiveProgramDocument {
  return liveProgramDocumentSchema.parse({
    ...document,
    cues: [
      ...document.cues,
      {
        id: cueId,
        speaker: "left",
        caption: "本編の最初の話題です。",
        speech: "ほんぺんの さいしょの わだいです。",
        expression: "normal",
      },
    ],
    segments: document.segments.map((segment) =>
      segment.kind === "script"
        ? { ...segment, cues: [...segment.cues, cueId] }
        : segment,
    ),
  });
}

export async function createLiveWorkWithScene(
  prisma: PrismaClient,
  input: { workId: string; sceneId?: string },
): Promise<{ workId: string; sceneId: string }> {
  const content = validContentDocument();
  const sceneId = input.sceneId ?? "scene-intro";
  if (!content.scenes.some((scene) => scene.id === sceneId)) {
    throw new Error(`Scene fixture が見つかりません: ${sceneId}`);
  }
  const work = await prisma.work.create({
    data: { id: input.workId, title: "素材元の作品", originalLocale: "ja-JP" },
  });
  const edition = await prisma.languageEdition.create({
    data: { workId: work.id, locale: "ja-JP" },
  });
  const script = await prisma.scriptVersion.create({
    data: {
      languageEditionId: edition.id,
      versionNumber: 1,
      contentSchemaVersion: 1,
      contentJson: serializeContent(content),
      author: "human",
    },
  });
  await prisma.languageEdition.update({
    where: { id: edition.id },
    data: { currentScriptVersionId: script.id },
  });
  return { workId: work.id, sceneId };
}
