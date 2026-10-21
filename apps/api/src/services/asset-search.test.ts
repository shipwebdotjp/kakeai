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

    // AND needs every tag, so one missing tag empties the result.
    const andMissing = await searchAssets(
      prisma,
      query({ filename: "tags-", tags: ["filter-x", "filter-missing"] }),
    );
    expect(andMissing.assets).toHaveLength(0);
    expect(andMissing.total).toBe(0);

    // OR needs one tag, so a missing tag does not change the result.
    const orMissing = await searchAssets(
      prisma,
      query({
        filename: "tags-",
        tags: ["filter-x", "filter-missing"],
        tagMode: "or",
      }),
    );
    expect(orMissing.assets.map((asset) => asset.id).sort()).toEqual(["tag-a", "tag-b"]);
    expect(orMissing.total).toBe(2);
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

  it("matches a tag as a whole element and never as a substring", async () => {
    await seed({ id: "exact-loop", filename: "exact-loop.png", tags: ["bgm_loop"] });
    await seed({ id: "exact-noloop", filename: "exact-noloop.png", tags: ["bgmxloop"] });
    await seed({ id: "exact-plain", filename: "exact-plain.png", tags: ["bgm"] });

    const loop = await searchAssets(
      prisma,
      query({ filename: "exact-", tags: ["bgm_loop"] }),
    );
    expect(loop.assets.map((asset) => asset.id)).toEqual(["exact-loop"]);
    expect(loop.total).toBe(1);

    // `bgm` is a prefix of `bgm_loop`, but a prefix is not an element.
    const plain = await searchAssets(prisma, query({ filename: "exact-", tags: ["bgm"] }));
    expect(plain.assets.map((asset) => asset.id)).toEqual(["exact-plain"]);
    expect(plain.total).toBe(1);
  });

  it("treats % and _ inside a tag as literal characters", async () => {
    await seed({ id: "literal-underscore", filename: "literal-underscore.png", tags: ["a_b"] });
    await seed({ id: "literal-other", filename: "literal-other.png", tags: ["axb"] });
    await seed({ id: "literal-percent", filename: "literal-percent.png", tags: ["c%d"] });
    await seed({ id: "literal-percent-other", filename: "literal-percent-other.png", tags: ["cXXd"] });
    await seed({ id: "literal-only-percent", filename: "literal-only-percent.png", tags: ["%"] });
    await seed({ id: "literal-unrelated", filename: "literal-unrelated.png", tags: ["unrelated"] });

    const underscore = await searchAssets(
      prisma,
      query({ filename: "literal-", tags: ["a_b"] }),
    );
    expect(underscore.assets.map((asset) => asset.id)).toEqual(["literal-underscore"]);
    expect(underscore.total).toBe(1);

    const percent = await searchAssets(prisma, query({ filename: "literal-", tags: ["c%d"] }));
    expect(percent.assets.map((asset) => asset.id)).toEqual(["literal-percent"]);
    expect(percent.total).toBe(1);

    // `%` is an ordinary character, so it only matches the tag `%` and never
    // every asset that carries any tag.
    const onlyPercent = await searchAssets(
      prisma,
      query({ filename: "literal-", tags: ["%"] }),
    );
    expect(onlyPercent.assets.map((asset) => asset.id)).toEqual(["literal-only-percent"]);
    expect(onlyPercent.total).toBe(1);
  });

  it("matches a tag that contains a quote or a backslash exactly", async () => {
    await seed({ id: "quoted-tag", filename: "quoted-tag.png", tags: ['x"ab'] });
    await seed({ id: "quoted-other", filename: "quoted-other.png", tags: ["ab"] });
    await seed({ id: "escaped-tag", filename: "escaped-tag.png", tags: ["a\\b"] });

    const quoted = await searchAssets(prisma, query({ filename: "quoted-", tags: ["ab"] }));
    expect(quoted.assets.map((asset) => asset.id)).toEqual(["quoted-other"]);
    expect(quoted.total).toBe(1);

    const escaped = await searchAssets(
      prisma,
      query({ filename: "escaped-", tags: ["a\\b"] }),
    );
    expect(escaped.assets.map((asset) => asset.id)).toEqual(["escaped-tag"]);
    expect(escaped.total).toBe(1);
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

  it("keeps the page order of every sort for a tag filter", async () => {
    // The tag filter reads its ids in the order of the sort, so the order of
    // a tag filtered page has to be the same as the order without the tag.
    const createdAt = new Date("2026-06-01T00:00:00.000Z");
    const later = new Date("2026-06-02T00:00:00.000Z");
    const rows: AssetSeed[] = [
      { id: "sorttag-a", filename: "sorttag-b.png", durationMs: 300, createdAt },
      { id: "sorttag-b", filename: "sorttag-a.png", durationMs: null, createdAt },
      { id: "sorttag-c", filename: "sorttag-d.png", durationMs: 100, createdAt },
      { id: "sorttag-d", filename: "sorttag-c.png", durationMs: 200, createdAt },
      { id: "sorttag-e", filename: "sorttag-f.png", durationMs: null, createdAt: later },
      { id: "sorttag-f", filename: "sorttag-e.png", durationMs: 50, createdAt: later },
    ];
    for (const row of rows) {
      await seed({ ...row, tags: ["sorttag"] });
    }

    const collectPages = async (input: Record<string, unknown>): Promise<string[]> => {
      const collected: string[] = [];
      let cursor: string | null = null;
      for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
        const page = await searchAssets(
          prisma,
          query({ ...input, limit: 2, ...(cursor === null ? {} : { cursor }) }),
        );
        collected.push(...page.assets.map((asset) => asset.id));
        if (page.nextCursor === null) {
          break;
        }
        cursor = page.nextCursor;
      }
      return collected;
    };

    for (const sort of ["createdAt_desc", "createdAt_asc", "filename_asc", "duration_asc"] as const) {
      const withTag = await collectPages({ filename: "sorttag-", sort, tags: ["sorttag"] });
      const withoutTag = await collectPages({ filename: "sorttag-", sort });
      expect(withTag, sort).toEqual(withoutTag);
      expect(withTag, sort).toHaveLength(6);
    }
  });

  it("applies the other filters to the tag id list as well", async () => {
    // Every seeded asset carries the tag, so a tag filtered search has to
    // return the same rows as the same search without the tag.
    await seed({
      id: "filter-a",
      filename: "filter-a.png",
      kind: "image",
      status: "ready",
      tags: ["filters"],
      favorite: true,
      hasAudio: true,
      durationMs: 1_000,
    });
    await seed({
      id: "filter-b",
      filename: "filter-b.mp4",
      kind: "video",
      status: "ready",
      tags: ["filters"],
      durationMs: 5_000,
    });
    await seed({
      id: "filter-c",
      filename: "filter-c.png",
      kind: "image",
      status: "failed",
      tags: ["filters"],
      archived: true,
    });
    await seed({
      id: "filter-d",
      filename: "FILTER-d.PNG",
      kind: "image",
      status: "ready",
      tags: ["filters"],
      hasAudio: true,
      durationMs: 2_000,
    });

    const filters: Record<string, unknown>[] = [
      { filename: "filter-" },
      { filename: "filter-", kind: "image" },
      { filename: "filter-", status: "ready" },
      { filename: "filter-d" },
      { filename: "filter-", favorite: true },
      { filename: "filter-", favorite: false },
      { filename: "filter-", archived: "exclude" },
      { filename: "filter-", archived: "include" },
      { filename: "filter-", archived: "only" },
      { filename: "filter-", hasAudio: true },
      { filename: "filter-", hasAudio: false },
      { filename: "filter-", durationMinMs: 1_500 },
      { filename: "filter-", durationMaxMs: 2_500 },
      { filename: "filter-", durationMinMs: 1_000, durationMaxMs: 5_000 },
    ];

    for (const filter of filters) {
      const label = JSON.stringify(filter);
      const withTag = await searchAssets(prisma, query({ ...filter, tags: ["filters"] }));
      const withoutTag = await searchAssets(prisma, query(filter));
      expect(withTag.assets.map((asset) => asset.id), label).toEqual(
        withoutTag.assets.map((asset) => asset.id),
      );
      expect(withTag.total, label).toBe(withoutTag.total);
    }

    // Several tags in the `or` mode share the group: the other filters have to
    // hold for every one of them.
    await seed({
      id: "filter-e",
      filename: "filter-e.png",
      kind: "image",
      status: "ready",
      tags: ["other"],
      archived: true,
    });
    const either = await searchAssets(
      prisma,
      query({ filename: "filter-", tags: ["filters", "other"], tagMode: "or" }),
    );
    const single = await searchAssets(prisma, query({ filename: "filter-", tags: ["filters"] }));
    expect(either.assets.map((asset) => asset.id)).toEqual(
      single.assets.map((asset) => asset.id),
    );
    expect(either.assets.map((asset) => asset.id)).not.toContain("filter-e");
    expect(either.total).toBe(single.total);
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

  it("counts the rows that match the same compound filter set with several tags", async () => {
    await seed({ id: "compound-a", filename: "compound-a.png", tags: ["c", "d"], favorite: true });
    await seed({ id: "compound-b", filename: "compound-b.png", tags: ["c", "d"] });
    await seed({ id: "compound-c", filename: "compound-c.png", tags: ["c"] });
    await seed({ id: "compound-d", filename: "compound-d.png", tags: ["c", "d"], archived: true });

    const page = await searchAssets(
      prisma,
      query({ filename: "compound-", tags: ["c", "d"], favorite: true, limit: 1 }),
    );
    expect(page.assets.map((asset) => asset.id)).toEqual(["compound-a"]);
    expect(page.total).toBe(1);

    const either = await searchAssets(
      prisma,
      query({
        filename: "compound-",
        tags: ["c", "d"],
        tagMode: "or",
      }),
    );
    expect(either.assets.map((asset) => asset.id)).toEqual([
      "compound-c",
      "compound-b",
      "compound-a",
    ]);
    expect(either.total).toBe(3);
  });

  it("pages through the rows of a tag filter without duplicates or gaps", async () => {
    const createdAt = new Date("2026-03-02T00:00:00.000Z");
    for (const id of ["tagpage-a", "tagpage-b", "tagpage-c", "tagpage-d", "tagpage-e"]) {
      await seed({ id, filename: `${id}.png`, tags: ["tagpage"], createdAt });
    }
    await seed({ id: "tagpage-other", filename: "tagpage-other.png", tags: ["elsewhere"] });

    const collected: string[] = [];
    const totals: number[] = [];
    let cursor: string | null = null;
    for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
      const page = await searchAssets(
        prisma,
        query({
          filename: "tagpage-",
          tags: ["tagpage"],
          limit: 2,
          ...(cursor === null ? {} : { cursor }),
        }),
      );
      collected.push(...page.assets.map((asset) => asset.id));
      totals.push(page.total);
      if (page.nextCursor === null) {
        break;
      }
      cursor = page.nextCursor;
    }

    expect(collected).toEqual([
      "tagpage-e",
      "tagpage-d",
      "tagpage-c",
      "tagpage-b",
      "tagpage-a",
    ]);
    expect(totals).toEqual([5, 5, 5]);
  });

  it("searches a tag that matches more assets than one statement can carry", async () => {
    // SQLite accepts at most 999 bind parameters per statement, so a tag that
    // matches more than that many assets is read in chunks.
    const createdAt = new Date("2026-05-01T00:00:00.000Z");
    const total = 1200;
    await prisma.asset.createMany({
      data: Array.from({ length: total }, (_value, index) => ({
        id: `bulk-${String(index).padStart(4, "0")}`,
        kind: "image",
        origin: "uploaded",
        status: "ready",
        storageKey: `assets/bulk-${index}`,
        originalFilename: `bulk-${String(index).padStart(4, "0")}.png`,
        mediaType: "image/png",
        byteSize: BigInt(1),
        sha256: `sha-bulk-${index}`,
        tagsJson: JSON.stringify(["bulk"]),
        createdAt,
      })),
    });

    const first = await searchAssets(prisma, query({ tags: ["bulk"], limit: 100 }));
    expect(first.assets).toHaveLength(100);
    expect(first.assets[0]?.id).toBe("bulk-1199");
    expect(first.total).toBe(total);
    expect(first.nextCursor).not.toBeNull();

    const collected: string[] = [];
    const totals: number[] = [];
    let cursor: string | null = null;
    for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
      const page = await searchAssets(
        prisma,
        query({ tags: ["bulk"], limit: 100, ...(cursor === null ? {} : { cursor }) }),
      );
      collected.push(...page.assets.map((asset) => asset.id));
      totals.push(page.total);
      if (page.nextCursor === null) {
        break;
      }
      cursor = page.nextCursor;
    }

    expect(collected).toHaveLength(total);
    expect(new Set(collected).size).toBe(total);
    expect(collected[0]).toBe("bulk-1199");
    expect(collected.at(-1)).toBe("bulk-0000");
    expect(totals.every((value) => value === total)).toBe(true);
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
