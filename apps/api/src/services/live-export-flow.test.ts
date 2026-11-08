import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  liveCharacterSheetSchema,
  livePackageManifestSchema,
  livePackageShowSchema,
  type Character,
  type LiveShowProfile,
  type TtsAdapter,
} from "@kakeai/contracts";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import type { AppConfig } from "../config.ts";
import { loadConfig } from "../config.ts";
import { createPrismaClient } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { applySqlitePragmas } from "../db/pragmas.ts";
import { ensureDataDirectories } from "../storage/paths.ts";
import { FakeFontCatalogAdapter, FontCatalogService } from "../services/font-catalog.ts";
import * as scriptVersions from "../services/script-versions.ts";
import * as works from "../services/works.ts";
import { createLiveExportJob } from "../services/live-exports.ts";
import { processLiveExportJob } from "../worker/live-export.ts";
import { wavFixture } from "../testing/tts-mocks.ts";

const testFontCatalog = new FontCatalogService(new FakeFontCatalogAdapter());

function pngHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  buffer[24] = 8;
  buffer[25] = 6;
  return buffer;
}

async function writeAssetFile(
  config: AppConfig,
  storageKey: string,
  data: Buffer,
): Promise<void> {
  const path = join(config.directories.root, storageKey);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, data);
}

async function createAsset(
  prisma: ReturnType<typeof createPrismaClient>,
  config: AppConfig,
  input: {
    id: string;
    kind: "image" | "audio";
    mediaType: string;
    data: Buffer;
    durationMs: number | null;
    widthPx: number | null;
    heightPx: number | null;
    hasAudio: boolean;
  },
) {
  const sha256 = createHash("sha256").update(input.data).digest("hex");
  const storageKey = `assets/${sha256}`;
  await writeAssetFile(config, storageKey, input.data);
  return prisma.asset.create({
    data: {
      id: input.id,
      kind: input.kind,
      origin: "uploaded",
      status: "ready",
      storageKey,
      originalFilename: input.kind === "image" ? "image.png" : "audio.wav",
      mediaType: input.mediaType,
      byteSize: BigInt(input.data.byteLength),
      sha256,
      durationMs: input.durationMs,
      widthPx: input.widthPx,
      heightPx: input.heightPx,
      hasAudio: input.hasAudio,
    },
  });
}

function showProfile(): LiveShowProfile {
  return {
    schemaVersion: 1,
    show: {
      title: "ライブ書き出しテスト",
      locale: "ja-JP",
      targetDurationMs: 600_000,
      stageTemplate: "news-desk",
      theme: "theme.css",
      characters: { left: "char-left", right: null },
      startAt: null,
    },
    commentSource: { kind: "youtube" },
    segments: [
      {
        id: "seg-opening",
        kind: "opening",
        label: "オープニング",
        targetDurationMs: 60_000,
        cues: ["cue-opening"],
      },
      {
        id: "seg-script",
        kind: "script",
        label: "本編",
        targetDurationMs: 300_000,
        cues: ["cue-script"],
        material: "material-1",
      },
      {
        id: "seg-closing",
        kind: "closing",
        label: "クロージング",
        targetDurationMs: 60_000,
        cues: ["cue-closing"],
      },
    ],
    scriptCues: [{ id: "cue-script", lineId: "line-p1-1", materialId: "material-2" }],
    liveCues: [
      {
        id: "cue-opening",
        speaker: "left",
        caption: "始まります。",
        speech: "はじまります。",
        expression: "normal",
        audioAssetId: "asset-audio-1",
      },
      {
        id: "cue-closing",
        speaker: "left",
        caption: "終わります。",
        speech: "おわります。",
        expression: "normal",
        audioAssetId: "asset-audio-1",
      },
    ],
    materials: [
      { id: "material-1", sceneId: "scene-intro", focus: true, format: "png", durationMs: 4000 },
      { id: "material-2", sceneId: "scene-outro", focus: false, format: "html", durationMs: 4000 },
    ],
    commentPolicy: {
      mode: "corner",
      freshnessMin: 10,
      maxCommentsPerCorner: 4,
      maxHumanPinsPerCorner: 4,
      maxExtraSlots: 2,
      allowImmediateInterrupt: false,
      skipWhenEmpty: true,
    },
    safety: {
      blockedTopics: [],
      persona: "親しみやすい解説役",
      maxResponseChars: 180,
      maxResponseCues: 2,
      fallbackCueId: "cue-opening",
    },
    playout: {
      minBufferMs: 10_000,
      maxThinkingMs: 2000,
      closingReserveMs: 120_000,
      noApprovalDelay: true,
    },
  };
}

let dataDir: string;
let config: AppConfig;
let prisma: ReturnType<typeof createPrismaClient>;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-live-export-"));
  process.env.KAKEAI_DATA_DIR = dataDir;
  config = loadConfig();
  await ensureDataDirectories(config.directories);
  await runMigrations();
  prisma = createPrismaClient(config.databaseUrl);
  await applySqlitePragmas(prisma);
}, 60000);

afterAll(async () => {
  await prisma.$disconnect();
  delete process.env.KAKEAI_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe("live export flow", () => {
  it("writes a verifiable package without mutating content tables", async () => {
    const image = await createAsset(prisma, config, {
      id: "asset-bg",
      kind: "image",
      mediaType: "image/png",
      data: pngHeader(1, 1),
      durationMs: null,
      widthPx: 1,
      heightPx: 1,
      hasAudio: false,
    });
    const audio = await createAsset(prisma, config, {
      id: "asset-audio-1",
      kind: "audio",
      mediaType: "audio/wav",
      data: wavFixture(3000, 440),
      durationMs: 3000,
      widthPx: null,
      heightPx: null,
      hasAudio: true,
    });
    await createAsset(prisma, config, {
      id: "asset-bgm",
      kind: "audio",
      mediaType: "audio/wav",
      data: wavFixture(5000, 220),
      durationMs: 5000,
      widthPx: null,
      heightPx: null,
      hasAudio: true,
    });
    await prisma.voiceProfile.create({
      data: {
        id: "voice-1",
        name: "テスト声",
        adapterId: "voicevox",
        voiceId: "voice-1",
        locale: "ja-JP",
        settingsJson: "{}",
      },
    });

    const work = await works.createWork(prisma, "ライブ書き出し", "ja-JP");
    const edition = work.languageEditions[0]!;
    const content = validContentDocument();
    const speaker = content.speakers[0]!;
    speaker.characterId = "char-left";
    speaker.voiceProfileId = "voice-1";
    const character: Character = {
      id: "char-left",
      name: "左キャラ",
      names: [],
      voices: [{ locale: "ja-JP", voiceProfileId: "voice-1" }],
      appearances: [
        {
          id: "appearance-1",
          assetId: image.id,
          expression: "normal",
          pose: "standing",
          faceSetId: null,
          faceSetVersion: null,
          libraryAppearanceId: null,
        },
      ],
      libraryCharacterId: null,
    };
    content.characters.push(character);
    const saved = await scriptVersions.saveScriptVersion(prisma, edition.id, {
      sourceScriptVersionId: null,
      content,
    });

    const outDir = join(dataDir, "package");
    const before = {
      scriptVersions: await prisma.scriptVersion.count(),
      assets: await prisma.asset.count(),
      voiceProfiles: await prisma.voiceProfile.count(),
      faceSets: await prisma.faceSet.count(),
    };

    const job = await createLiveExportJob(
      prisma,
      {
        workId: work.id,
        scriptVersionId: saved.scriptVersion.id,
        profile: showProfile(),
        outDir,
      },
      testFontCatalog,
    );
    expect(job.kind).toBe("live_export");
    expect(job.status).toBe("queued");

    const adapter: TtsAdapter = {
      id: "voicevox",
      listVoices: async () => ({ voices: [], engineVersion: null }),
      synthesize: async () => ({ data: wavFixture(1000, 440), mediaType: "audio/wav" }),
    };
    const row = await prisma.job.update({
      where: { id: job.id },
      data: { status: "running", startedAt: new Date() },
    });
    await processLiveExportJob(prisma, config, row, {
      adapterFor: () => adapter,
      rasterizer: {
        renderPng: async () => pngHeader(1920, 1080),
      },
      isCancelled: async () => false,
    });

    const finished = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(finished.status).toBe("succeeded");
    expect(finished.resultJson).not.toBeNull();
    const result = JSON.parse(finished.resultJson!);
    expect(result.packagePath).toBe(outDir);
    expect(result.preparedCueCount).toBe(3);

    const manifest = livePackageManifestSchema.parse(
      JSON.parse(await readFile(join(outDir, "manifest.json"), "utf8")),
    );
    expect(manifest.files.length).toBeGreaterThan(0);
    expect(manifest.files.some((file) => file.path === "show.json")).toBe(true);
    expect(manifest.files.some((file) => file.path === "characters.json")).toBe(true);
    expect(manifest.files.some((file) => file.path === "materials/card-0001.png")).toBe(true);
    expect(manifest.files.some((file) => file.path === "materials/card-0002.html")).toBe(true);
    expect(manifest.files.some((file) => file.path === "audio/prepared/cue-0001.wav")).toBe(true);
    expect(manifest.files.every((file) => !file.path.startsWith("/"))).toBe(true);

    const exportedShow = livePackageShowSchema.parse(
      JSON.parse(await readFile(join(outDir, "show.json"), "utf8")),
    );
    expect(exportedShow.cues.find((cue) => cue.id === "cue-script")?.materialId).toBe(
      "material-2",
    );
    liveCharacterSheetSchema.parse(
      JSON.parse(await readFile(join(outDir, "characters.json"), "utf8")),
    );

    const html = await readFile(join(outDir, "materials/card-0002.html"), "utf8");
    expect(html).not.toMatch(/<script\b/i);

    const files = await readdir(outDir);
    expect(files).toContain("manifest.json");
    expect(files).toContain("show.json");
    expect(files).toContain("characters.json");
    expect(files).toContain("theme.css");
    expect(files).toContain("materials");
    expect(files).toContain("audio");

    const after = {
      scriptVersions: await prisma.scriptVersion.count(),
      assets: await prisma.asset.count(),
      voiceProfiles: await prisma.voiceProfile.count(),
      faceSets: await prisma.faceSet.count(),
    };
    expect(after).toEqual(before);
    expect((await stat(outDir)).isDirectory()).toBe(true);
    expect(audio.id).toBe("asset-audio-1");
  });
});
