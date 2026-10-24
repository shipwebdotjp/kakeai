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
let lastRenderedHtml = "";

const fakeRasterizer: Rasterizer = {
  renderPng: async (html) => {
    lastRenderedHtml = html;
    return Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  },
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

function inputFor(backgroundAssetId: string, foregroundAssetId: string) {
  return {
    headline: "見出し",
    backgroundAssetId,
    foregroundAssetId,
  };
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
    const backgroundAssetId = await createImageAsset();
    const foregroundAssetId = await createImageAsset();
    expect(await thumbnails.listThumbnails(prisma, editionId)).toEqual([]);

    const first = await thumbnails.createThumbnail(prisma, editionId, {
      label: "候補1",
      template: { id: "thumbnail.cutout-hero", version: 1 },
      input: inputFor(backgroundAssetId, foregroundAssetId),
    });
    expect(first.isPrimary).toBe(true);
    expect(first.schemaVersion).toBe(2);
    expect(first.appearanceOverride).toBeNull();

    const second = await thumbnails.createThumbnail(prisma, editionId, {
      label: "候補2",
      template: { id: "thumbnail.cutout-hero", version: 1 },
      input: inputFor(backgroundAssetId, foregroundAssetId),
      appearanceOverride: { headline: { color: "#00FFFF" } },
    });
    expect(second.isPrimary).toBe(false);
    expect(second.appearanceOverride).toEqual({ headline: { color: "#00FFFF" } });

    const listed = await thumbnails.listThumbnails(prisma, editionId);
    expect(listed.map((entry) => entry.label)).toEqual(["候補1", "候補2"]);
    expect(listed.filter((entry) => entry.isPrimary)).toHaveLength(1);
  });

  it("rejects an unknown template and missing assets", async () => {
    const editionId = await createEdition();
    const backgroundAssetId = await createImageAsset();
    const foregroundAssetId = await createImageAsset();
    await expect(
      thumbnails.createThumbnail(prisma, editionId, {
        label: "不正",
        template: { id: "thumbnail.missing", version: 1 },
        input: inputFor(backgroundAssetId, foregroundAssetId),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await expect(
      thumbnails.createThumbnail(prisma, editionId, {
        label: "不正",
        template: { id: "thumbnail.cutout-hero", version: 1 },
        input: inputFor(backgroundAssetId, "ast_missing"),
      }),
    ).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });

    await expect(
      thumbnails.createThumbnail(prisma, editionId, {
        label: "不正",
        template: { id: "thumbnail.cutout-hero", version: 1 },
        input: { headline: "x", backgroundAssetId },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("accepts inline text marks", async () => {
    const editionId = await createEdition();
    const backgroundAssetId = await createImageAsset();
    const foregroundAssetId = await createImageAsset();
    const created = await thumbnails.createThumbnail(prisma, editionId, {
      label: "装飾",
      template: { id: "thumbnail.cutout-hero", version: 1 },
      input: {
        ...inputFor(backgroundAssetId, foregroundAssetId),
        headline: "**重要**と==色==と%%縁取り%%",
      },
    });
    expect(created.id).toBeTruthy();
  });

  it("saves, switches primary, and deletes with fallback", async () => {
    const editionId = await createEdition();
    const backgroundAssetId = await createImageAsset();
    const foregroundAssetId = await createImageAsset();
    const input = inputFor(backgroundAssetId, foregroundAssetId);
    const first = await thumbnails.createThumbnail(prisma, editionId, {
      label: "候補1",
      template: { id: "thumbnail.cutout-hero", version: 1 },
      input,
    });
    const second = await thumbnails.createThumbnail(prisma, editionId, {
      label: "候補2",
      template: { id: "thumbnail.cutout-hero", version: 1 },
      input,
    });

    const saved = await thumbnails.saveThumbnail(prisma, second.id, {
      label: "候補2 改",
      template: { id: "thumbnail.cutout-hero", version: 1 },
      input: { ...input, subline: "補足" },
      appearanceOverride: { accent: "#FF00FF" },
    });
    expect(saved.label).toBe("候補2 改");
    expect(saved.appearanceOverride).toEqual({ accent: "#FF00FF" });

    const primary = await thumbnails.setPrimaryThumbnail(prisma, editionId, second.id);
    expect(primary?.id).toBe(second.id);

    await thumbnails.deleteThumbnail(prisma, second.id);
    const remaining = await thumbnails.listThumbnails(prisma, editionId);
    expect(remaining.map((entry) => entry.id)).toEqual([first.id]);
    expect(remaining[0]!.isPrimary).toBe(true);
  });

  it("stores the language-edition appearance and previews an unsaved draft", async () => {
    const editionId = await createEdition();
    const backgroundAssetId = await createImageAsset();
    const foregroundAssetId = await createImageAsset();
    const input = inputFor(backgroundAssetId, foregroundAssetId);

    const initial = await thumbnails.getThumbnailAppearance(prisma, editionId);
    expect(initial.appearance).toBeNull();
    expect(initial.defaults.headline.color).toBe("#FFFFFF");
    expect(initial.resolved.headline.color).toBe("#FFFFFF");

    const saved = await thumbnails.saveThumbnailAppearance(prisma, editionId, {
      headline: {
        fontSize: 120,
        color: "#00FFFF",
        outline: { color: "#00FF00", width: 6 },
      },
      accent: "#FF00FF",
      scrim: { opacity: 0.2 },
    });
    expect(saved.appearance).toEqual({
      headline: {
        fontSize: 120,
        color: "#00FFFF",
        outline: { color: "#00FF00", width: 6 },
      },
      accent: "#FF00FF",
      scrim: { opacity: 0.2 },
    });
    expect(saved.resolved.headline.fontSize).toBe(120);

    const reloaded = await thumbnails.getThumbnailAppearance(prisma, editionId);
    expect(reloaded.appearance).toEqual(saved.appearance);

    const unsavedPreview = await thumbnails.createThumbnailPreview(prisma, editionId, {
      template: { id: "thumbnail.cutout-hero", version: 1 },
      input,
      appearance: { headline: { color: "#123456" } },
    });
    expect(unsavedPreview.html).toContain("color:#123456");

    const savedPreview = await thumbnails.createThumbnailPreview(prisma, editionId, {
      template: { id: "thumbnail.cutout-hero", version: 1 },
      input,
    });
    expect(savedPreview.html).toContain("color:#00FFFF");

    const ignoredPreview = await thumbnails.createThumbnailPreview(prisma, editionId, {
      template: { id: "thumbnail.cutout-hero", version: 1 },
      input,
      appearance: null,
    });
    expect(ignoredPreview.html).not.toContain("color:#00FFFF");

    const noAppearance = await thumbnails.saveThumbnailAppearance(prisma, editionId, null);
    expect(noAppearance.appearance).toBeNull();
  });

  it("falls back to the theme when the stored appearance JSON is corrupt", async () => {
    const editionId = await createEdition();
    await prisma.languageEdition.update({
      where: { id: editionId },
      data: { thumbnailAppearanceJson: "not-json" },
    });
    const corrupt = await thumbnails.getThumbnailAppearance(prisma, editionId);
    expect(corrupt.appearance).toBeNull();
    expect(corrupt.resolved.headline.color).toBe("#FFFFFF");

    await prisma.languageEdition.update({
      where: { id: editionId },
      data: { thumbnailAppearanceJson: JSON.stringify({ unknown: true }) },
    });
    const unknownKey = await thumbnails.getThumbnailAppearance(prisma, editionId);
    expect(unknownKey.appearance).toBeNull();
  });

  it("applies the saved appearance and both images when generating a PNG", async () => {
    const editionId = await createEdition();
    const backgroundAssetId = await createImageAsset();
    const foregroundAssetId = await createImageAsset();
    await thumbnails.saveThumbnailAppearance(prisma, editionId, {
      headline: { color: "#00FFFF" },
    });
    const created = await thumbnails.createThumbnail(prisma, editionId, {
      label: "出力",
      template: { id: "thumbnail.cutout-hero", version: 1 },
      input: inputFor(backgroundAssetId, foregroundAssetId),
    });
    lastRenderedHtml = "";
    const image = await thumbnails.generateThumbnailImage(
      prisma,
      directories,
      fakeRasterizer,
      created.id,
    );
    expect(image.filename).toBe("サムネ作品.png");
    expect(image.png.length).toBeGreaterThan(0);
    expect(lastRenderedHtml).toContain("color:#00FFFF");
    expect(lastRenderedHtml.match(/data:image\/png;base64,/g)?.length).toBe(2);
  });

  it("reads a v1 document without an appearance override", async () => {
    const editionId = await createEdition();
    const assetId = await createImageAsset();
    const row = await prisma.thumbnail.create({
      data: {
        languageEditionId: editionId,
        label: "v1",
        schemaVersion: 1,
        templateId: "thumbnail.cutout-hero",
        templateVersion: 1,
        inputJson: JSON.stringify({
          schemaVersion: 1,
          template: { id: "thumbnail.cutout-hero", version: 1 },
          input: inputFor(assetId, assetId),
        }),
      },
    });
    const dto = await thumbnails.getThumbnail(prisma, row.id);
    expect(dto.schemaVersion).toBe(1);
    expect(dto.appearanceOverride).toBeNull();
  });

  it("removes candidates when the work is deleted", async () => {
    const work = await works.createWork(prisma, "削除作品", "ja-JP");
    const editionId = work.languageEditions[0]!.id;
    const backgroundAssetId = await createImageAsset();
    const foregroundAssetId = await createImageAsset();
    await thumbnails.createThumbnail(prisma, editionId, {
      label: "候補",
      template: { id: "thumbnail.cutout-hero", version: 1 },
      input: inputFor(backgroundAssetId, foregroundAssetId),
    });
    await works.deleteWork(prisma, directories, work.id);
    expect(await prisma.thumbnail.count({ where: { languageEditionId: editionId } })).toBe(0);
  });
});
