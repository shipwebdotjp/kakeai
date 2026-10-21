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
  hasAudio?: boolean;
  durationMs?: number | null;
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
      durationMs: overrides.durationMs ?? null,
      hasAudio: overrides.hasAudio ?? false,
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
    expect(page.total).toBe(1);
  });

  it("excludes archived assets by default and supports include/only", async () => {
    await seed({ id: "archive-live", filename: "archive-live.png" });
    await seed({ id: "archive-hidden", filename: "archive-hidden.png", archived: true });

    const excluded = await searchAssets(prisma, query({ filename: "archive-" }));
    expect(excluded.assets.map((asset) => asset.originalFilename)).toEqual([
      "archive-live.png",
    ]);
    expect(excluded.total).toBe(1);

    const included = await searchAssets(
      prisma,
      query({ filename: "archive-", archived: "include" }),
    );
    expect(included.assets.map((asset) => asset.originalFilename)).toEqual([
      "archive-live.png",
      "archive-hidden.png",
    ]);
    expect(included.total).toBe(2);

    const only = await searchAssets(
      prisma,
      query({ filename: "archive-", archived: "only" }),
    );
    expect(only.assets.map((asset) => asset.originalFilename)).toEqual([
      "archive-hidden.png",
    ]);
    expect(only.total).toBe(1);
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
    expect(both.total).toBe(1);

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
    expect(either.total).toBe(3);
  });

  it("matches ASCII tags case-insensitively and non-ASCII tags exactly", async () => {
    await seed({ id: "case-upper", filename: "case-upper.png", tags: ["Summer"] });
    await seed({ id: "case-lower", filename: "case-lower.png", tags: ["summer"] });
    await seed({ id: "case-jp", filename: "case-jp.png", tags: ["背景"] });
    await seed({ id: "case-prefix", filename: "case-prefix.png", tags: ["summer-loop"] });

    const upper = await searchAssets(
      prisma,
      query({ filename: "case-", tags: ["SUMMER"] }),
    );
    expect(upper.assets.map((asset) => asset.id)).toEqual(["case-upper", "case-lower"]);
    expect(upper.total).toBe(2);

    const lower = await searchAssets(
      prisma,
      query({ filename: "case-", tags: ["summer"] }),
    );
    expect(lower.assets.map((asset) => asset.id)).toEqual(["case-upper", "case-lower"]);

    // A tag matches a complete element only: `summer` is not part of
    // `summer-loop`.
    const japanese = await searchAssets(
      prisma,
      query({ filename: "case-", tags: ["背景"] }),
    );
    expect(japanese.assets.map((asset) => asset.id)).toEqual(["case-jp"]);
    expect(japanese.total).toBe(1);

    const partial = await searchAssets(
      prisma,
      query({ filename: "case-", tags: ["背"] }),
    );
    expect(partial.assets).toHaveLength(0);
    expect(partial.total).toBe(0);
  });

  it("reads LIKE wildcards inside a tag as wildcards", async () => {
    // The tag comparison goes through SQLite's LIKE, which has no escape
    // clause in the Prisma query API. `_` matches any single character and
    // `%` matches any sequence, so a tag that contains them also matches
    // other tags. This is the documented behaviour of the contract.
    await seed({ id: "wild-underscore", filename: "wild-underscore.png", tags: ["a_b"] });
    await seed({ id: "wild-other", filename: "wild-other.png", tags: ["axb"] });
    await seed({ id: "wild-percent", filename: "wild-percent.png", tags: ["c%d"] });
    await seed({ id: "wild-percent-other", filename: "wild-percent-other.png", tags: ["cXXd"] });

    const underscore = await searchAssets(
      prisma,
      query({ filename: "wild-", tags: ["a_b"] }),
    );
    expect(underscore.assets.map((asset) => asset.id)).toEqual([
      "wild-underscore",
      "wild-other",
    ]);

    const percent = await searchAssets(prisma, query({ filename: "wild-", tags: ["c%d"] }));
    expect(percent.assets.map((asset) => asset.id)).toEqual([
      "wild-percent-other",
      "wild-percent",
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

  it("filters on the audio track and the duration range", async () => {
    await seed({ id: "meta-silent", filename: "meta-silent.png", durationMs: 1_000 });
    await seed({
      id: "meta-sound",
      filename: "meta-sound.mp4",
      kind: "video",
      hasAudio: true,
      durationMs: 5_000,
    });
    await seed({ id: "meta-unknown", filename: "meta-unknown.mp4", kind: "video" });

    const withAudio = await searchAssets(
      prisma,
      query({ filename: "meta-", hasAudio: true }),
    );
    expect(withAudio.assets.map((asset) => asset.id)).toEqual(["meta-sound"]);
    expect(withAudio.total).toBe(1);

    const withoutAudio = await searchAssets(
      prisma,
      query({ filename: "meta-", hasAudio: false }),
    );
    expect(withoutAudio.assets.map((asset) => asset.id)).toEqual([
      "meta-unknown",
      "meta-silent",
    ]);

    const range = await searchAssets(
      prisma,
      query({ filename: "meta-", durationMinMs: 2_000, durationMaxMs: 9_000 }),
    );
    expect(range.assets.map((asset) => asset.id)).toEqual(["meta-sound"]);
    expect(range.total).toBe(1);
  });

  it("counts the rows that match the same compound filter set", async () => {
    await seed({ id: "count-a", filename: "count-a.png", tags: ["count"], favorite: true });
    await seed({ id: "count-b", filename: "count-b.png", tags: ["count"] });
    await seed({ id: "count-c", filename: "count-c.png", tags: ["other"] });
    await seed({ id: "count-d", filename: "count-d.png", tags: ["count"], archived: true });

    const page = await searchAssets(
      prisma,
      query({ filename: "count-", tags: ["count"], favorite: true, limit: 1 }),
    );
    expect(page.assets.map((asset) => asset.id)).toEqual(["count-a"]);
    expect(page.total).toBe(1);
    expect(page.nextCursor).toBeNull();

    const all = await searchAssets(prisma, query({ filename: "count-", tags: ["count"] }));
    expect(all.assets.map((asset) => asset.id)).toEqual(["count-b", "count-a"]);
    expect(all.total).toBe(2);

    const paged = await searchAssets(
      prisma,
      query({ filename: "count-", tags: ["count"], limit: 1 }),
    );
    expect(paged.total).toBe(2);
    expect(paged.nextCursor).not.toBeNull();
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

  it("orders by createdAt asc and id asc", async () => {
    const createdAt = new Date("2026-02-10T00:00:00.000Z");
    await seed({ id: "asc-a", filename: "asc-a.png", createdAt });
    await seed({ id: "asc-b", filename: "asc-b.png", createdAt });
    await seed({
      id: "asc-c",
      filename: "asc-c.png",
      createdAt: new Date("2026-02-09T00:00:00.000Z"),
    });

    const page = await searchAssets(prisma, query({ filename: "asc-", sort: "createdAt_asc" }));
    expect(page.assets.map((asset) => asset.id)).toEqual(["asc-c", "asc-a", "asc-b"]);
  });

  it("orders by filename asc and id asc", async () => {
    await seed({ id: "name-a", filename: "name-a.png" });
    await seed({ id: "name-b", filename: "name-b.png" });
    await seed({ id: "name-a2", filename: "name-a.png" });

    const page = await searchAssets(prisma, query({ filename: "name-", sort: "filename_asc" }));
    expect(page.assets.map((asset) => asset.id)).toEqual(["name-a", "name-a2", "name-b"]);
  });

  it("orders by duration asc and puts rows without a duration last", async () => {
    await seed({ id: "dur-500", filename: "dur-500.mp4", kind: "video", durationMs: 500 });
    await seed({ id: "dur-100", filename: "dur-100.mp4", kind: "video", durationMs: 100 });
    await seed({ id: "dur-none", filename: "dur-none.mp4", kind: "video" });
    await seed({ id: "dur-300", filename: "dur-300.mp4", kind: "video", durationMs: 300 });

    const page = await searchAssets(
      prisma,
      query({ filename: "dur-", sort: "duration_asc" }),
    );
    expect(page.assets.map((asset) => asset.id)).toEqual([
      "dur-100",
      "dur-300",
      "dur-500",
      "dur-none",
    ]);
    expect(page.total).toBe(4);
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

  it("pages through rows that share a sort key of every sort", async () => {
    const createdAt = new Date("2026-03-05T00:00:00.000Z");
    for (const id of ["same-a", "same-b", "same-c", "same-d", "same-e"]) {
      await seed({ id, filename: "same-file.png", createdAt, durationMs: 1_000 });
    }

    for (const sort of ["createdAt_desc", "createdAt_asc", "filename_asc", "duration_asc"] as const) {
      const collected: string[] = [];
      let cursor: string | null = null;
      for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
        const page = await searchAssets(
          prisma,
          query({ filename: "same-file", sort, limit: 2, ...(cursor === null ? {} : { cursor }) }),
        );
        collected.push(...page.assets.map((asset) => asset.id));
        if (page.nextCursor === null) {
          break;
        }
        cursor = page.nextCursor;
      }
      // `createdAt_desc` also sorts the tie breaker downwards, the other sorts
      // sort it upwards.
      const expected =
        sort === "createdAt_desc"
          ? ["same-e", "same-d", "same-c", "same-b", "same-a"]
          : ["same-a", "same-b", "same-c", "same-d", "same-e"];
      expect(collected, sort).toEqual(expected);
    }
  });

  it("pages through rows with distinct durations and a row without a duration", async () => {
    const createdAt = new Date("2026-03-08T00:00:00.000Z");
    await seed({ id: "durpage-100", filename: "durpage-100.mp4", kind: "video", durationMs: 100, createdAt });
    await seed({ id: "durpage-300", filename: "durpage-300.mp4", kind: "video", durationMs: 300, createdAt });
    await seed({ id: "durpage-900", filename: "durpage-900.mp4", kind: "video", durationMs: 900, createdAt });
    await seed({ id: "durpage-none", filename: "durpage-none.mp4", kind: "video", createdAt });

    const collected: string[] = [];
    let cursor: string | null = null;
    for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
      const page = await searchAssets(
        prisma,
        query({
          filename: "durpage-",
          sort: "duration_asc",
          limit: 1,
          ...(cursor === null ? {} : { cursor }),
        }),
      );
      collected.push(...page.assets.map((asset) => asset.id));
      if (page.nextCursor === null) {
        break;
      }
      cursor = page.nextCursor;
    }

    expect(collected).toEqual(["durpage-100", "durpage-300", "durpage-900", "durpage-none"]);
  });

  it("pages through rows with distinct sort keys", async () => {
    const rows = [
      { id: "distinct-c", filename: "distinct-c.png", createdAt: new Date("2026-03-20T00:00:00.000Z") },
      { id: "distinct-a", filename: "distinct-a.png", createdAt: new Date("2026-03-18T00:00:00.000Z") },
      { id: "distinct-b", filename: "distinct-b.png", createdAt: new Date("2026-03-19T00:00:00.000Z") },
    ];
    for (const row of rows) {
      await seed(row);
    }

    for (const sort of ["createdAt_asc", "filename_asc"] as const) {
      const collected: string[] = [];
      let cursor: string | null = null;
      for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
        const page = await searchAssets(
          prisma,
          query({ filename: "distinct-", sort, limit: 1, ...(cursor === null ? {} : { cursor }) }),
        );
        collected.push(...page.assets.map((asset) => asset.id));
        if (page.nextCursor === null) {
          break;
        }
        cursor = page.nextCursor;
      }
      expect(collected, sort).toEqual(["distinct-a", "distinct-b", "distinct-c"]);
    }
  });

  it("rejects a cursor that was produced for another sort", async () => {
    const createdAt = new Date("2026-03-10T00:00:00.000Z");
    for (const id of ["mixed-a", "mixed-b", "mixed-c"]) {
      await seed({ id, filename: `${id}.png`, createdAt });
    }

    const first = await searchAssets(
      prisma,
      query({ filename: "mixed-", sort: "createdAt_desc", limit: 1 }),
    );
    expect(first.nextCursor).not.toBeNull();

    await expect(
      searchAssets(
        prisma,
        query({
          filename: "mixed-",
          sort: "filename_asc",
          limit: 1,
          cursor: first.nextCursor ?? "",
        }),
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: { issues: [{ path: ["cursor"] }] },
    });
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
      sort: "createdAt_desc",
      limit: 500,
    });
    expect(page.assets).toHaveLength(100);
    expect(page.nextCursor).not.toBeNull();
    expect(page.total).toBe(101);
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
