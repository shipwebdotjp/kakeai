import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AppConfig } from "../config.ts";
import { loadConfig } from "../config.ts";
import { createPrismaClient } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { applySqlitePragmas } from "../db/pragmas.ts";
import { ApiError } from "../http/errors.ts";
import type {
  PreviewFrameRequest,
  PreviewRasterizer,
} from "../media/preview-rasterize.ts";
import { assetStorageKey, commitFile } from "../storage/asset-store.ts";
import { ensureDataDirectories } from "../storage/paths.ts";
import { deserializeContent } from "../domain/content-json.ts";
import { getAssetFrame } from "./preview-asset-frames.ts";
import { getScriptVersionFrame } from "./preview-script-frames.ts";
import * as works from "./works.ts";

const execFileAsync = promisify(execFile);

// A valid 1x1 PNG. The service only parses IHDR dimensions from it.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
  "base64",
);

let dataDir: string;
let fixturesDir: string;
let config: AppConfig;
let prisma: ReturnType<typeof createPrismaClient>;
let ffmpegReady = false;
let lastRequest: PreviewFrameRequest | undefined;

const fakeRasterizer: PreviewRasterizer = {
  renderFrame: async (request) => {
    lastRequest = request;
    return PNG_1X1;
  },
};

async function createAssetRow(input: {
  kind: "image" | "video" | "audio";
  mediaType: string;
  fileName: string;
  durationMs?: number | null;
  widthPx?: number | null;
  heightPx?: number | null;
  bytes?: Buffer;
}): Promise<string> {
  const bytes = input.bytes ?? Buffer.from([0x00]);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const storageKey = assetStorageKey(sha256);
  const temp = join(config.directories.tmp, `test-asset-${randomUUID()}`);
  await writeFile(temp, bytes);
  await commitFile(temp, storageKey, config.directories);
  const row = await prisma.asset.create({
    data: {
      kind: input.kind,
      origin: "uploaded",
      status: "ready",
      storageKey,
      originalFilename: input.fileName,
      mediaType: input.mediaType,
      byteSize: BigInt(bytes.length),
      sha256,
      durationMs: input.durationMs ?? null,
      widthPx: input.widthPx ?? null,
      heightPx: input.heightPx ?? null,
    },
  });
  return row.id;
}

async function createVideoBytes(): Promise<Buffer | undefined> {
  const path = join(fixturesDir, `video-${randomUUID()}.mp4`);
  try {
    await execFileAsync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=320x240:rate=30",
      "-frames:v",
      "30",
      "-pix_fmt",
      "yuv420p",
      path,
    ]);
    return await readFile(path);
  } catch {
    return undefined;
  }
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-preview-frame-"));
  fixturesDir = await mkdtemp(join(tmpdir(), "kakeai-preview-frame-fixtures-"));
  process.env.KAKEAI_DATA_DIR = dataDir;
  config = loadConfig();
  await ensureDataDirectories(config.directories);
  await runMigrations();
  prisma = createPrismaClient(config.databaseUrl);
  await applySqlitePragmas(prisma);
  try {
    await execFileAsync("ffmpeg", ["-version"]);
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

describe("preview.scriptFrame", () => {
  it("rasterizes a saved version without writing a version or artifact", async () => {
    const work = await works.createWork(prisma, "プレビュー作品", "ja-JP");
    const edition = work.languageEditions[0]!;
    const scriptVersionId = edition.currentScriptVersion.id;
    const before = {
      versions: await prisma.scriptVersion.count(),
      jobs: await prisma.job.count(),
      artifacts: await prisma.artifact.count(),
    };

    const frame = await getScriptVersionFrame(
      prisma,
      config.directories,
      fakeRasterizer,
      "http://127.0.0.1:4317",
      { scriptVersionId, timeMs: 1000 },
    );

    expect(frame.scriptVersionId).toBe(scriptVersionId);
    expect(frame.requestedTimeMs).toBe(1000);
    expect(frame.durationMs).toBeGreaterThan(0);
    expect(frame.width).toBe(1);
    expect(frame.height).toBe(1);
    expect(frame.mimeType).toBe("image/png");
    expect(Buffer.from(frame.imageBase64, "base64")).toEqual(PNG_1X1);
    expect(lastRequest).toMatchObject({
      width: 1920,
      height: 1080,
      timeMs: 1000,
      origin: "http://127.0.0.1:4317",
    });
    expect(lastRequest?.html).toContain("kakeai-main");
    expect({
      versions: await prisma.scriptVersion.count(),
      jobs: await prisma.job.count(),
      artifacts: await prisma.artifact.count(),
    }).toEqual(before);
  });

  it("rejects a time beyond the resolved duration", async () => {
    const work = await works.createWork(prisma, "範囲外プレビュー", "ja-JP");
    const edition = work.languageEditions[0]!;
    const scriptVersionId = edition.currentScriptVersion.id;

    await expect(
      getScriptVersionFrame(prisma, config.directories, fakeRasterizer, "http://127.0.0.1:4317", {
        scriptVersionId,
        timeMs: 24 * 60 * 60 * 1000,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("returns not found for an unknown script version", async () => {
    await expect(
      getScriptVersionFrame(prisma, config.directories, fakeRasterizer, "http://127.0.0.1:4317", {
        scriptVersionId: "scr_missing",
        timeMs: 0,
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("rasterizes an unsaved ContentDocument without writing a version or artifact", async () => {
    const work = await works.createWork(prisma, "下書きプレビュー作品", "ja-JP");
    const edition = work.languageEditions[0]!;
    const versionRow = await prisma.scriptVersion.findUniqueOrThrow({
      where: { id: edition.currentScriptVersion.id },
    });
    const content = deserializeContent(versionRow.contentJson);
    const before = {
      versions: await prisma.scriptVersion.count(),
      jobs: await prisma.job.count(),
      artifacts: await prisma.artifact.count(),
    };

    const frame = await getScriptVersionFrame(
      prisma,
      config.directories,
      fakeRasterizer,
      "http://127.0.0.1:4317",
      { content, timeMs: 500 },
    );

    expect(frame.scriptVersionId).toBeNull();
    expect(frame.requestedTimeMs).toBe(500);
    expect(frame.durationMs).toBeGreaterThan(0);
    expect(frame.width).toBe(1);
    expect(frame.height).toBe(1);
    expect(frame.mimeType).toBe("image/png");
    expect(Buffer.from(frame.imageBase64, "base64")).toEqual(PNG_1X1);

    expect({
      versions: await prisma.scriptVersion.count(),
      jobs: await prisma.job.count(),
      artifacts: await prisma.artifact.count(),
    }).toEqual(before);
  });

  it("validates languageEditionId and locale for unsaved content documents", async () => {
    const work = await works.createWork(prisma, "言語版検証作品", "ja-JP");
    const edition = work.languageEditions[0]!;
    const versionRow = await prisma.scriptVersion.findUniqueOrThrow({
      where: { id: edition.currentScriptVersion.id },
    });
    const content = deserializeContent(versionRow.contentJson);

    // Matching edition and locale
    const frame = await getScriptVersionFrame(
      prisma,
      config.directories,
      fakeRasterizer,
      "http://127.0.0.1:4317",
      { content, languageEditionId: edition.id, timeMs: 0 },
    );
    expect(frame.scriptVersionId).toBeNull();

    // Locale mismatch
    const mismatchedContent = { ...content, locale: "en-US" as const };
    await expect(
      getScriptVersionFrame(
        prisma,
        config.directories,
        fakeRasterizer,
        "http://127.0.0.1:4317",
        { content: mismatchedContent, languageEditionId: edition.id, timeMs: 0 },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    // Non-existent edition
    await expect(
      getScriptVersionFrame(
        prisma,
        config.directories,
        fakeRasterizer,
        "http://127.0.0.1:4317",
        { content, languageEditionId: "led_missing", timeMs: 0 },
      ),
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });

  it("rejects unsaved content with invalid visual theme or out-of-bounds timeMs", async () => {
    const work = await works.createWork(prisma, "下書きエラー作品", "ja-JP");
    const edition = work.languageEditions[0]!;
    const versionRow = await prisma.scriptVersion.findUniqueOrThrow({
      where: { id: edition.currentScriptVersion.id },
    });
    const content = deserializeContent(versionRow.contentJson);

    // Invalid theme ID -> PREVIEW_INPUT_INVALID
    const invalidThemeContent = {
      ...content,
      visualTheme: { ...content.visualTheme, id: "missing-theme" },
    };
    await expect(
      getScriptVersionFrame(
        prisma,
        config.directories,
        fakeRasterizer,
        "http://127.0.0.1:4317",
        { content: invalidThemeContent, timeMs: 0 },
      ),
    ).rejects.toMatchObject({ code: "PREVIEW_INPUT_INVALID" });

    // timeMs beyond total duration -> VALIDATION_ERROR
    await expect(
      getScriptVersionFrame(
        prisma,
        config.directories,
        fakeRasterizer,
        "http://127.0.0.1:4317",
        { content, timeMs: 24 * 60 * 60 * 1000 },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("preview.assetFrame", () => {
  it("returns image bytes and dimensions", async () => {
    const assetId = await createAssetRow({
      kind: "image",
      mediaType: "image/png",
      fileName: "image.png",
      widthPx: 1,
      heightPx: 1,
      bytes: PNG_1X1,
    });

    const frame = await getAssetFrame(prisma, config.directories, { assetId });
    expect(frame).toMatchObject({
      assetId,
      kind: "image",
      requestedTimeMs: null,
      resolvedTimeMs: null,
      width: 1,
      height: 1,
      mimeType: "image/png",
    });
    expect(Buffer.from(frame.imageBase64, "base64")).toEqual(PNG_1X1);

    await expect(
      getAssetFrame(prisma, config.directories, { assetId, timeMs: 0 }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("extracts a still frame from a video", async () => {
    if (!ffmpegReady) {
      return;
    }
    const bytes = await createVideoBytes();
    if (bytes === undefined) {
      return;
    }
    const assetId = await createAssetRow({
      kind: "video",
      mediaType: "video/mp4",
      fileName: "video.mp4",
      durationMs: 1000,
      widthPx: 320,
      heightPx: 240,
      bytes,
    });

    const frame = await getAssetFrame(prisma, config.directories, {
      assetId,
      timeMs: 500,
    });
    expect(frame).toMatchObject({
      assetId,
      kind: "video",
      requestedTimeMs: 500,
      width: 320,
      height: 240,
      mimeType: "image/png",
    });
    expect(frame.resolvedTimeMs).toBeLessThanOrEqual(500);
    expect(Buffer.from(frame.imageBase64, "base64").subarray(1, 4).toString("ascii")).toBe(
      "PNG",
    );
  });

  it("rejects audio assets and unknown ids", async () => {
    const audioId = await createAssetRow({
      kind: "audio",
      mediaType: "audio/wav",
      fileName: "audio.wav",
      durationMs: 1000,
    });
    await expect(
      getAssetFrame(prisma, config.directories, { assetId: audioId }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await expect(
      getAssetFrame(prisma, config.directories, { assetId: "ast_missing" }),
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });
});
