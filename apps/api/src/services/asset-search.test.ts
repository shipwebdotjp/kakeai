import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assetListQuerySchema, type AssetKindName, type AssetListQuery } from "@kakeai/contracts";
import type { AppConfig } from "../config.ts";
import { loadConfig } from "../config.ts";
import { createPrismaClient } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { applySqlitePragmas } from "../db/pragmas.ts";
import { ensureDataDirectories } from "../storage/paths.ts";
import { searchAssets } from "./assets.ts";

let dataDir: string;
let prisma: ReturnType<typeof createPrismaClient>;

interface AssetSeed {
  id?: string;
  kind?: AssetKindName;
  status?: "processing" | "ready" | "failed";
  filename: string;
  tags?: string[];
  favorite?: boolean;
  archived?: boolean;
  createdAt?: Date;
}

function seed(overrides: AssetSeed) {
  return prisma.asset.create({
    data: {
      ...(overrides.id === undefined ? {} : { id: overrides.id }),
      kind: overrides.kind ?? "image",
      origin: "uploaded",
      status: overrides.status ?? "ready",
      storageKey: `assets/test-${randomUUID()}`,
      originalFilename: overrides.filename,
      mediaType: "image/png",
      byteSize: BigInt(10),
      sha256: `sha-${randomUUID()}`,
      tagsJson:
        overrides.tags === undefined || overrides.tags.length === 0
          ? null
          : JSON.stringify(overrides.tags),
      favoritedAt: overrides.favorite === true ? new Date("2026-01-02T00:00:00.000Z") : null,
      archivedAt: overrides.archived === true ? new Date("2026-01-03T00:00:00.000Z") : null,
      createdAt: overrides.createdAt ?? new Date("2026-01-01T00:00:00.000Z"),
    },
  });
}

function query(input: Record<string, unknown>): AssetListQuery {
  return assetListQuerySchema.parse(input);
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-asset-search-"));
  process.env.KAKEAI_DATA_DIR = dataDir;
  const config: AppConfig = loadConfig();
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

describe("searchAssets", () => {
  it("combines kind, status, filename, tags and favorite filters", async () => {
    await seed({
      filename: "combine-Summer.PNG",
      tags: ["背景", "夏"],
      favorite: true,
    });
    await seed({
      filename: "combine-summer-other.png",
      tags: ["背景"],
    });
    await seed({
      filename: "combine-summer.mp4",
      kind: "video",
      tags: ["背景", "夏"],
      favorite: true,
    });
    await seed({
      filename: "combine-summer-waiting.png",
      status: "processing",
      tags: ["背景", "夏"],
      favorite: true,
    });

    const page = await searchAssets(
      prisma,
      query({
        kind: "image",
        status: "ready",
        filename: "SUMMER",
        tags: ["背景", "夏"],
        favorite: true,
        limit: 10,
      }),
    );

    expect(page.assets.map((asset) => asset.originalFilename)).toEqual([
      "combine-Summer.PNG",
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it("excludes archived assets by default and supports include/only", async () => {
    await seed({ id: "archive-live", filename: "archive-live.png" });
    await seed({ id: "archive-hidden", filename: "archive-hidden.png", archived: true });

    const excluded = await searchAssets(prisma, query({ filename: "archive-" }));
    expect(excluded.assets.map((asset) => asset.originalFilename)).toEqual([
      "archive-live.png",
    ]);

    const included = await searchAssets(
      prisma,
      query({ filename: "archive-", archived: "include" }),
    );
    expect(included.assets.map((asset) => asset.originalFilename)).toEqual([
      "archive-live.png",
      "archive-hidden.png",
    ]);

    const only = await searchAssets(
      prisma,
      query({ filename: "archive-", archived: "only" }),
    );
    expect(only.assets.map((asset) => asset.originalFilename)).toEqual([
      "archive-hidden.png",
    ]);
  });

  it("matches tags exactly and supports AND vs OR", async () => {
    await seed({ id: "tag-a", filename: "tags-a.png", tags: ["filter-x"] });
    await seed({ id: "tag-b", filename: "tags-b.png", tags: ["filter-x", "filter-y"] });
    await seed({ id: "tag-c", filename: "tags-c.png", tags: ["filter-y", "filter-z"] });
    await seed({ id: "tag-long", filename: "tags-long.png", tags: ["filter-x2"] });

    const both = await searchAssets(
      prisma,
      query({ filename: "tags-", tags: ["filter-x", "filter-y"] }),
    );
    expect(both.assets.map((asset) => asset.originalFilename)).toEqual(["tags-b.png"]);

    const either = await searchAssets(
      prisma,
      query({
        filename: "tags-",
        tags: ["filter-x", "filter-z"],
        tagMode: "or",
      }),
    );
    expect(either.assets.map((asset) => asset.originalFilename)).toEqual([
      "tags-c.png",
      "tags-b.png",
      "tags-a.png",
    ]);
  });

  it("matches a case-insensitive filename substring, including Japanese", async () => {
    await seed({ filename: "BGM_テーマ.PNG" });
    await seed({ filename: "bgm-other.png" });

    const upper = await searchAssets(prisma, query({ filename: "bgm_テーマ" }));
    expect(upper.assets.map((asset) => asset.originalFilename)).toEqual([
      "BGM_テーマ.PNG",
    ]);

    const japanese = await searchAssets(prisma, query({ filename: "テーマ" }));
    expect(japanese.assets.map((asset) => asset.originalFilename)).toEqual([
      "BGM_テーマ.PNG",
    ]);

    const ascii = await searchAssets(prisma, query({ filename: "BGM" }));
    expect(ascii.assets).toHaveLength(2);
  });

  it("filters favorite=false and by kind/status", async () => {
    await seed({ filename: "flag-fav.png", favorite: true });
    await seed({ filename: "flag-plain.png", favorite: false });
    await seed({ filename: "flag-audio.wav", kind: "audio", favorite: true });
    await seed({ filename: "flag-failed.png", status: "failed", favorite: true });

    const notFavorite = await searchAssets(
      prisma,
      query({ filename: "flag-", favorite: false }),
    );
    expect(notFavorite.assets.map((asset) => asset.originalFilename)).toEqual([
      "flag-plain.png",
    ]);

    const audioReady = await searchAssets(
      prisma,
      query({ filename: "flag-", kind: "audio", status: "ready", favorite: true }),
    );
    expect(audioReady.assets.map((asset) => asset.originalFilename)).toEqual([
      "flag-audio.wav",
    ]);
  });

  it("orders by createdAt desc and id desc", async () => {
    const createdAt = new Date("2026-02-01T00:00:00.000Z");
    await seed({ id: "order-a", filename: "order-a.png", createdAt });
    await seed({ id: "order-b", filename: "order-b.png", createdAt });
    await seed({
      id: "order-c",
      filename: "order-c.png",
      createdAt: new Date("2026-02-02T00:00:00.000Z"),
    });

    const page = await searchAssets(prisma, query({ filename: "order-" }));
    expect(page.assets.map((asset) => asset.id)).toEqual(["order-c", "order-b", "order-a"]);
  });

  it("pages through rows that share createdAt without duplicates or skips", async () => {
    const createdAt = new Date("2026-03-01T00:00:00.000Z");
    for (const id of ["tie-a", "tie-b", "tie-c", "tie-d", "tie-e"]) {
      await seed({ id, filename: `${id}.png`, createdAt });
    }

    const collected: string[] = [];
    let cursor: string | null = null;
    for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
      const page: Awaited<ReturnType<typeof searchAssets>> = await searchAssets(
        prisma,
        query({ filename: "tie-", limit: 2, ...(cursor === null ? {} : { cursor }) }),
      );
      collected.push(...page.assets.map((asset) => asset.id));
      if (page.nextCursor === null) {
        break;
      }
      cursor = page.nextCursor;
    }

    expect(collected).toEqual(["tie-e", "tie-d", "tie-c", "tie-b", "tie-a"]);
  });

  it("caps the page size at the contract maximum", async () => {
    const createdAt = new Date("2026-04-01T00:00:00.000Z");
    await prisma.asset.createMany({
      data: Array.from({ length: 101 }, (_value, index) => ({
        id: `cap-${String(index).padStart(3, "0")}`,
        kind: "image",
        origin: "uploaded",
        status: "ready",
        storageKey: `assets/cap-${index}`,
        originalFilename: `cap-${index}.png`,
        mediaType: "image/png",
        byteSize: BigInt(1),
        sha256: `sha-cap-${index}`,
        createdAt,
      })),
    });

    const page = await searchAssets(prisma, {
      filename: "cap-",
      tagMode: "and",
      archived: "exclude",
      limit: 500,
    });
    expect(page.assets).toHaveLength(100);
    expect(page.nextCursor).not.toBeNull();
  });

  it("rejects a malformed cursor with a validation issue", async () => {
    await expect(
      searchAssets(prisma, query({ filename: "anything", cursor: "not-a-cursor" })),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: { issues: [{ path: ["cursor"] }] },
    });
  });
});
