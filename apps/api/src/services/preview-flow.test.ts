import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createInitialContentDocument, scriptVersionPreviewSchema } from "@kakeai/contracts";
import type { AppConfig } from "../config.ts";
import { loadConfig } from "../config.ts";
import { createPrismaClient } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { applySqlitePragmas } from "../db/pragmas.ts";
import { ensureDataDirectories } from "../storage/paths.ts";
import { ApiError } from "../http/errors.ts";
import { createWorker } from "../worker/index.ts";
import * as assets from "./assets.ts";
import * as scriptVersions from "./script-versions.ts";
import * as works from "./works.ts";

const execFileAsync = promisify(execFile);

let dataDir: string;
let fixturesDir: string;
let config: AppConfig;
let prisma: ReturnType<typeof createPrismaClient>;
let worker: ReturnType<typeof createWorker>;
let ffmpegReady = false;

async function generateFixtures(): Promise<void> {
  await execFileAsync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30", "-frames:v", "1", join(fixturesDir, "image.png")]);
  await execFileAsync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "pcm_s16le", join(fixturesDir, "audio.wav")]);
}

async function upload(originalFilename: string, sourcePath: string) {
  const tempPath = join(config.directories.tmp, `test-${randomUUID()}`);
  await copyFile(sourcePath, tempPath);
  const buffer = await readFile(sourcePath);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  return assets.ingestUpload(prisma, config.directories, config.limits, {
    tempPath,
    originalFilename,
    sha256,
    byteSize: buffer.length,
  });
}

async function drainWorker(): Promise<void> {
  while (await worker.runOnce()) {
    continue;
  }
}

async function readyImage(): Promise<{ id: string; sha256: string }> {
  const outcome = await upload("image.png", join(fixturesDir, "image.png"));
  await drainWorker();
  const ready = await assets.getAsset(prisma, outcome.asset.id);
  expect(ready.status).toBe("ready");
  return { id: ready.id, sha256: ready.sha256 };
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-preview-"));
  process.env.KAKEAI_DATA_DIR = dataDir;
  config = loadConfig();
  await ensureDataDirectories(config.directories);
  await runMigrations();
  prisma = createPrismaClient(config.databaseUrl);
  await applySqlitePragmas(prisma);
  worker = createWorker({ prisma, config });

  fixturesDir = await mkdtemp(join(tmpdir(), "kakeai-preview-fixtures-"));
  try {
    await generateFixtures();
    ffmpegReady = true;
  } catch {
    ffmpegReady = false;
  }
}, 60000);

afterAll(async () => {
  await prisma.$disconnect();
  delete process.env.KAKEAI_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
  await rm(fixturesDir, { recursive: true, force: true });
});

describe("script version preview", () => {
  it("compiles the saved version to composition html with render content urls", async () => {
    if (!ffmpegReady) {
      return;
    }
    const image = await readyImage();
    const work = await works.createWork(prisma, "プレビュー作品", "ja-JP");
    const edition = work.languageEditions[0]!;
    const content = createInitialContentDocument();
    const intro = content.scenes[0]!;
    if (intro.kind !== "intro") {
      throw new Error("expected an intro scene");
    }
    intro.visualCues.push({
      id: "vc-intro-bg",
      template: { id: "media.full-bleed", version: 1 },
      range: { kind: "scene" },
      input: { assetId: image.id, fit: "cover" },
    });
    const saved = await scriptVersions.saveScriptVersion(prisma, edition.id, {
      sourceScriptVersionId: null,
      content,
    });

    const preview = await scriptVersions.getScriptVersionPreview(
      prisma,
      config.directories,
      saved.scriptVersion.id,
    );

    expect(scriptVersionPreviewSchema.safeParse(preview).success).toBe(true);
    expect(preview.scriptVersionId).toBe(saved.scriptVersion.id);
    expect(preview.compositionHtml).toContain('data-composition-id="kakeai-main"');
    expect(preview.compositionHtml).toContain(
      `/api/v1/assets/${encodeURIComponent(image.id)}/render-content`,
    );
    expect(preview.assets).toEqual([
      {
        assetId: image.id,
        contentUrl: `/api/v1/assets/${encodeURIComponent(image.id)}/render-content`,
        sha256: image.sha256,
      },
    ]);
    expect(preview.renderer.engine).toBe("hyperframes");
    expect(preview.renderer.compilerVersion).toBe("app-1");
  });

  it("includes a standing appearance image in the preview", async () => {
    if (!ffmpegReady) {
      return;
    }
    const image = await readyImage();
    const work = await works.createWork(prisma, "立ち絵プレビュー", "ja-JP");
    const edition = work.languageEditions[0]!;
    const content = createInitialContentDocument();
    content.characters = [
      {
        id: "character-rin",
        name: "リン",
        appearances: [
          { id: "appearance-smile", assetId: image.id, expression: "smile", pose: "front" },
        ],
      },
    ];
    const intro = content.scenes[0]!;
    intro.visualCues.push({
      id: "vc-standing",
      template: { id: "character.standing", version: 1 },
      range: { kind: "scene" },
      input: {
        characterId: "character-rin",
        appearanceId: "appearance-smile",
        x: 0.85,
        y: 0.85,
        scale: 1,
      },
    });
    const saved = await scriptVersions.saveScriptVersion(prisma, edition.id, {
      sourceScriptVersionId: null,
      content,
    });

    const preview = await scriptVersions.getScriptVersionPreview(
      prisma,
      config.directories,
      saved.scriptVersion.id,
    );

    expect(preview.compositionHtml).toContain('class="kakeai-standing"');
    expect(preview.compositionHtml).toContain("left:85%;top:85%;width:480px;");
    expect(preview.compositionHtml).toContain(
      `/api/v1/assets/${encodeURIComponent(image.id)}/render-content`,
    );
    expect(preview.assets.map((asset) => asset.assetId)).toEqual([image.id]);
  });

  it("includes narration and BGM audio in the preview assets", async () => {
    if (!ffmpegReady) {
      return;
    }
    const audioAsset = await upload("audio.wav", join(fixturesDir, "audio.wav"));
    await drainWorker();
    const readyAudio = await assets.getAsset(prisma, audioAsset.asset.id);
    expect(readyAudio.status).toBe("ready");
    if (readyAudio.durationMs === null) {
      throw new Error("expected audio duration");
    }
    const work = await works.createWork(prisma, "音声プレビュー", "ja-JP");
    const edition = work.languageEditions[0]!;
    const content = createInitialContentDocument();
    const point = content.scenes[1]!;
    if (point.kind !== "point") {
      throw new Error("expected a point scene");
    }
    point.lines = [
      {
        id: "line-audio",
        speakerId: null,
        captionText: "音声つき",
        speechText: "おんせいつき",
        selectedAudioTakeId: "take-audio",
      },
    ];
    content.audioTakes = [
      {
        id: "take-audio",
        narrationSegmentId: "line-audio",
        source: "manual",
        assetId: readyAudio.id,
        durationMs: readyAudio.durationMs,
      },
    ];
    content.audioCues = [
      { id: "bgm", role: "bgm", assetId: readyAudio.id, range: { kind: "work" }, gainDb: -18, loop: true },
    ];
    const saved = await scriptVersions.saveScriptVersion(prisma, edition.id, {
      sourceScriptVersionId: null,
      content,
    });
    const preview = await scriptVersions.getScriptVersionPreview(
      prisma,
      config.directories,
      saved.scriptVersion.id,
    );
    expect(preview.compositionHtml).toContain('id="kakeai-audio-take-line-audio"');
    expect(preview.compositionHtml).toContain("kakeai-audio-cue-bgm-");
    expect(preview.assets.map((asset) => asset.assetId)).toEqual([readyAudio.id]);
  });

  it("returns 404 for an unknown script version", async () => {
    try {
      await scriptVersions.getScriptVersionPreview(prisma, config.directories, "scr_missing");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("RESOURCE_NOT_FOUND");
    }
  });

  it("rejects processing and failed assets", async () => {
    if (!ffmpegReady) {
      return;
    }
    const image = await readyImage();
    const work = await works.createWork(prisma, "状態テスト", "ja-JP");
    const edition = work.languageEditions[0]!;
    const content = createInitialContentDocument();
    const intro = content.scenes[0]!;
    if (intro.kind !== "intro") {
      throw new Error("expected an intro scene");
    }
    intro.visualCues.push({
      id: "vc-intro-bg",
      template: { id: "media.full-bleed", version: 1 },
      range: { kind: "scene" },
      input: { assetId: image.id, fit: "cover" },
    });
    const saved = await scriptVersions.saveScriptVersion(prisma, edition.id, {
      sourceScriptVersionId: null,
      content,
    });

    await prisma.asset.update({ where: { id: image.id }, data: { status: "processing" } });
    await expect(
      scriptVersions.getScriptVersionPreview(prisma, config.directories, saved.scriptVersion.id),
    ).rejects.toMatchObject({ code: "ASSET_PROCESSING" });

    await prisma.asset.update({ where: { id: image.id }, data: { status: "failed" } });
    await expect(
      scriptVersions.getScriptVersionPreview(prisma, config.directories, saved.scriptVersion.id),
    ).rejects.toMatchObject({ code: "ASSET_UNAVAILABLE" });
  });

  it("rejects fixed scenes whose audio total exceeds the duration", async () => {
    if (!ffmpegReady) {
      return;
    }
    const audio = await upload("audio.wav", join(fixturesDir, "audio.wav"));
    await drainWorker();
    const readyAudio = await assets.getAsset(prisma, audio.asset.id);
    expect(readyAudio.status).toBe("ready");
    if (readyAudio.durationMs === null) {
      throw new Error("expected audio duration");
    }
    const work = await works.createWork(prisma, "尺テスト", "ja-JP");
    const edition = work.languageEditions[0]!;
    const content = createInitialContentDocument();
    const point = content.scenes[1]!;
    if (point.kind !== "point") {
      throw new Error("expected a point scene");
    }
    point.timing = { mode: "fixed", durationMs: 1000 };
    content.audioTakes.push({
      id: "take-overflow",
      narrationSegmentId: "line-overflow",
      source: "manual",
      assetId: readyAudio.id,
      durationMs: readyAudio.durationMs,
    });
    point.lines.push({
      id: "line-overflow",
      speakerId: null,
      captionText: "長い音声",
      speechText: "ながいおんせい",
      selectedAudioTakeId: "take-overflow",
    });
    const saved = await scriptVersions.saveScriptVersion(prisma, edition.id, {
      sourceScriptVersionId: null,
      content,
    });
    await expect(
      scriptVersions.getScriptVersionPreview(prisma, config.directories, saved.scriptVersion.id),
    ).rejects.toMatchObject({ code: "PREVIEW_INPUT_INVALID" });
  });
});
