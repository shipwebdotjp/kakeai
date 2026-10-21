import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config.ts";
import { createPrismaClient } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { applySqlitePragmas } from "../db/pragmas.ts";
import { assetStorageKey, commitFile } from "../storage/asset-store.ts";
import { ensureDataDirectories, type DataDirectories } from "../storage/paths.ts";
import type { Rasterizer } from "../media/rasterize.ts";
import * as thumbnails from "./thumbnails.ts";
import * as works from "./works.ts";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

let dataDir: string;
let directories: DataDirectories;
let prisma: ReturnType<typeof createPrismaClient>;

const fakeRasterizer: Rasterizer = {
  renderPng: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]),
};

async function createImageAsset(): Promise<string> {
  const png = Buffer.concat([Buffer.from(PNG_BASE64, "base64"), Buffer.from(randomUUID())]);
  const sha256 = createHash("sha256").update(png).digest("hex");
  const storageKey = assetStorageKey(sha256);
  const temp = join(directories.tmp, `asset-${sha256}`);
  await writeFile(temp, png);
  await commitFile(temp, storageKey, directories);
  const row = await prisma.asset.create({
    data: {
      kind: "image",
      origin: "uploaded",
      status: "ready",
      storageKey,
      originalFilename: "photo.png",
      mediaType: "image/png",
      byteSize: BigInt(png.length),
      sha256,
      widthPx: 1,
      heightPx: 1,
    },
  });
  return row.id;
}

async function createEdition(): Promise<string> {
  const work = await works.createWork(prisma, "サムネ作品", "ja-JP");
  return work.languageEditions[0]!.id;
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-thumb-"));
  process.env.KAKEAI_DATA_DIR = dataDir;
  const config = loadConfig();
  directories = config.directories;
  await ensureDataDirectories(config.directories);
  await runMigrations();
  prisma = createPrismaClient(config.databaseUrl);
  await applySqlitePragmas(prisma);
}, 30000);

afterAll(async () => {
  await prisma.$disconnect();
  delete process.env.KAKEAI_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe("thumbnail flow", () => {
  it("creates candidates and makes the first one primary", async () => {
    const editionId = await createEdition();
    expect(await thumbnails.listThumbnails(prisma, editionId)).toEqual([]);

    const first = await thumbnails.createThumbnail(prisma, editionId, {
      label: "候補1",
      template: { id: "thumbnail.text", version: 1 },
      input: { headline: "見出し" },
    });
    expect(first.isPrimary).toBe(true);

    const assetId = await createImageAsset();
    const second = await thumbnails.createThumbnail(prisma, editionId, {
      label: "候補2",
      template: { id: "thumbnail.headline-photo", version: 1 },
      input: { headline: "写真つき", assetId },
    });
    expect(second.isPrimary).toBe(false);

    const listed = await thumbnails.listThumbnails(prisma, editionId);
    expect(listed.map((entry) => entry.label)).toEqual(["候補1", "候補2"]);
    expect(listed.filter((entry) => entry.isPrimary)).toHaveLength(1);
  });

  it("rejects an unknown template and a non-image asset", async () => {
    const editionId = await createEdition();
    await expect(
      thumbnails.createThumbnail(prisma, editionId, {
        label: "不正",
        template: { id: "thumbnail.missing", version: 1 },
        input: {},
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await expect(
      thumbnails.createThumbnail(prisma, editionId, {
        label: "不正",
        template: { id: "thumbnail.headline-photo", version: 1 },
        input: { headline: "x", assetId: "ast_missing" },
      }),
    ).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });
  });

  it("accepts inline text marks and rejects marks a field does not allow", async () => {
    const editionId = await createEdition();
    const created = await thumbnails.createThumbnail(prisma, editionId, {
      label: "装飾",
      template: { id: "thumbnail.text", version: 1 },
      input: { headline: "**重要**と==色==" },
    });
    expect(created.id).toBeTruthy();

    await expect(
      thumbnails.createThumbnail(prisma, editionId, {
        label: "不正",
        template: { id: "thumbnail.text", version: 1 },
        input: { headline: "見出し", badge: "==バッジ==" },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("saves, switches primary, and deletes with fallback", async () => {
    const editionId = await createEdition();
    const first = await thumbnails.createThumbnail(prisma, editionId, {
      label: "候補1",
      template: { id: "thumbnail.text", version: 1 },
      input: { headline: "A" },
    });
    const second = await thumbnails.createThumbnail(prisma, editionId, {
      label: "候補2",
      template: { id: "thumbnail.text", version: 1 },
      input: { headline: "B" },
    });

    const saved = await thumbnails.saveThumbnail(prisma, second.id, {
      label: "候補2 改",
      template: { id: "thumbnail.text", version: 1 },
      input: { headline: "B2", tone: "canvas" },
    });
    expect(saved.label).toBe("候補2 改");

    const primary = await thumbnails.setPrimaryThumbnail(prisma, editionId, second.id);
    expect(primary?.id).toBe(second.id);

    await thumbnails.deleteThumbnail(prisma, second.id);
    const remaining = await thumbnails.listThumbnails(prisma, editionId);
    expect(remaining.map((entry) => entry.id)).toEqual([first.id]);
    expect(remaining[0]!.isPrimary).toBe(true);
  });

  it("previews unsaved input and generates a PNG on demand", async () => {
    const editionId = await createEdition();
    const assetId = await createImageAsset();
    const preview = await thumbnails.createThumbnailPreview(prisma, editionId, {
      template: { id: "thumbnail.headline-photo", version: 1 },
      input: { headline: "プレビュー", assetId },
    });
    expect(preview.width).toBe(1280);
    expect(preview.height).toBe(720);
    expect(preview.html).toContain("プレビュー");

    const created = await thumbnails.createThumbnail(prisma, editionId, {
      label: "出力",
      template: { id: "thumbnail.headline-photo", version: 1 },
      input: { headline: "出力", assetId },
    });
    const image = await thumbnails.generateThumbnailImage(
      prisma,
      directories,
      fakeRasterizer,
      created.id,
    );
    expect(image.filename).toBe("サムネ作品.png");
    expect(image.png.length).toBeGreaterThan(0);
  });

  it("removes candidates when the work is deleted", async () => {
    const work = await works.createWork(prisma, "削除作品", "ja-JP");
    const editionId = work.languageEditions[0]!.id;
    await thumbnails.createThumbnail(prisma, editionId, {
      label: "候補",
      template: { id: "thumbnail.text", version: 1 },
      input: { headline: "x" },
    });
    await works.deleteWork(prisma, directories, work.id);
    expect(await prisma.thumbnail.count({ where: { languageEditionId: editionId } })).toBe(0);
  });
});
