import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createInitialContentDocument } from "@kakeai/contracts";
import type { AppConfig } from "../config.ts";
import { loadConfig } from "../config.ts";
import { createPrismaClient } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { applySqlitePragmas } from "../db/pragmas.ts";
import { ensureDataDirectories } from "../storage/paths.ts";
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
  await execFileAsync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30", "-t", "2", "-c:v", "mpeg4", "-q:v", "5", join(fixturesDir, "video.mp4")]);
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

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-asset-"));
  process.env.KAKEAI_DATA_DIR = dataDir;
  config = loadConfig();
  await ensureDataDirectories(config.directories);
  await runMigrations();
  prisma = createPrismaClient(config.databaseUrl);
  await applySqlitePragmas(prisma);
  worker = createWorker({ prisma, config });

  fixturesDir = await mkdtemp(join(tmpdir(), "kakeai-fixtures-"));
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

describe("asset ingest flow", () => {
  it("ingests an image to ready with dimensions and no duration", async () => {
    if (!ffmpegReady) {
      return;
    }
    const outcome = await upload("image.png", join(fixturesDir, "image.png"));
    expect(outcome.httpStatus).toBe(202);
    expect(outcome.deduplicated).toBe(false);
    expect(outcome.asset.status).toBe("processing");

    await drainWorker();
    const ready = await assets.getAsset(prisma, outcome.asset.id);
    expect(ready.status).toBe("ready");
    expect(ready.kind).toBe("image");
    expect(ready.widthPx).toBe(320);
    expect(ready.heightPx).toBe(240);
    expect(ready.durationMs).toBeNull();
    expect(ready.contentUrl).toBe(`/api/v1/assets/${ready.id}/content`);

    const deduplicated = await upload("image.png", join(fixturesDir, "image.png"));
    expect(deduplicated.deduplicated).toBe(true);
    expect(deduplicated.httpStatus).toBe(200);
    expect(deduplicated.asset.id).toBe(ready.id);

    await assets.deleteAsset(prisma, config.directories, ready.id);
    await expect(assets.getAsset(prisma, ready.id)).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
    });
  });

  it("normalizes a non-H.264 video into a render rendition", async () => {
    if (!ffmpegReady) {
      return;
    }
    const outcome = await upload("video.mp4", join(fixturesDir, "video.mp4"));
    expect(outcome.asset.status).toBe("processing");
    await drainWorker();

    const ready = await assets.getAsset(prisma, outcome.asset.id);
    expect(ready.status).toBe("ready");
    expect(ready.kind).toBe("video");

    const rendition = await prisma.assetRendition.findFirst({
      where: { assetId: ready.id, purpose: "render" },
    });
    expect(rendition?.mediaType).toBe("video/mp4");

    const content = await assets.resolveAssetContent(prisma, config.directories, ready.id, true);
    expect(content.mediaType).toBe("video/mp4");
    expect(content.sha256).toBe(rendition?.sha256);
  });

  it("uses WAV audio directly without a rendition", async () => {
    if (!ffmpegReady) {
      return;
    }
    const outcome = await upload("audio.wav", join(fixturesDir, "audio.wav"));
    await drainWorker();
    const ready = await assets.getAsset(prisma, outcome.asset.id);
    expect(ready.status).toBe("ready");
    expect(ready.kind).toBe("audio");
    expect(ready.widthPx).toBeNull();
    expect(ready.heightPx).toBeNull();
    expect(ready.durationMs).toBeGreaterThan(1900);
    const renditions = await prisma.assetRendition.count({ where: { assetId: ready.id } });
    expect(renditions).toBe(0);
  });

  it("rejects deleting an asset referenced by a script version", async () => {
    if (!ffmpegReady) {
      return;
    }
    const outcome = await upload("video.mp4", join(fixturesDir, "video.mp4"));
    await drainWorker();
    const ready = await assets.getAsset(prisma, outcome.asset.id);

    const work = await works.createWork(prisma, "参照テスト", "ja-JP");
    const edition = work.languageEditions[0]!;
    const content = createInitialContentDocument();
    content.scenes[0]!.visualCues = [
      {
        id: "vc-1",
        template: { id: "media.full-bleed", version: 1 },
        range: { kind: "scene" },
        layer: "background",
        order: 0,
        transition: {
          enter: { preset: "none", durationMs: 0 },
          exit: { preset: "none", durationMs: 0 },
        },
        input: { assetId: ready.id, fit: "cover" },
      },
    ];
    await scriptVersions.saveScriptVersion(prisma, edition.id, {
      sourceScriptVersionId: null,
      content,
    });

    await expect(assets.deleteAsset(prisma, config.directories, ready.id)).rejects.toMatchObject({
      code: "ASSET_IN_USE",
    });
  });
});
