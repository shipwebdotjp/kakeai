import { describe, expect, it } from "vitest";
import {
  ASSET_LIST_DEFAULT_LIMIT,
  ASSET_LIST_MAX_LIMIT,
  assetListPageSchema,
  assetListQuerySchema,
} from "./asset-list";

describe("assetListQuerySchema", () => {
  it("applies the documented defaults", () => {
    expect(assetListQuerySchema.parse({})).toEqual({
      tagMode: "and",
      archived: "exclude",
      sort: "createdAt_desc",
      limit: ASSET_LIST_DEFAULT_LIMIT,
    });
    expect(ASSET_LIST_DEFAULT_LIMIT).toBe(50);
    expect(ASSET_LIST_MAX_LIMIT).toBe(100);
  });

  it("trims the filename filter and accepts combined filters", () => {
    expect(
      assetListQuerySchema.parse({
        kind: "audio",
        status: "ready",
        filename: "  bgm ",
        tags: ["intro", "bgm"],
        tagMode: "or",
        favorite: true,
        archived: "include",
        hasAudio: true,
        durationMinMs: 0,
        durationMaxMs: 120_000,
        widthPx: 1920,
        heightMinPx: 1080,
        heightMaxPx: 2160,
        sort: "duration_asc",
        cursor: "cursor-1",
        limit: 10,
      }),
    ).toEqual({
      kind: "audio",
      status: "ready",
      filename: "bgm",
      tags: ["intro", "bgm"],
      tagMode: "or",
      favorite: true,
      archived: "include",
      hasAudio: true,
      durationMinMs: 0,
      durationMaxMs: 120_000,
      widthPx: 1920,
      heightMinPx: 1080,
      heightMaxPx: 2160,
      sort: "duration_asc",
      cursor: "cursor-1",
      limit: 10,
    });
  });

  it("rejects unknown fields and out-of-range values", () => {
    expect(assetListQuerySchema.safeParse({ extra: true }).success).toBe(false);
    expect(assetListQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(
      assetListQuerySchema.safeParse({ limit: ASSET_LIST_MAX_LIMIT + 1 }).success,
    ).toBe(false);
    expect(assetListQuerySchema.safeParse({ limit: 1.5 }).success).toBe(false);
    expect(assetListQuerySchema.safeParse({ tagMode: "xor" }).success).toBe(false);
    expect(assetListQuerySchema.safeParse({ archived: "all" }).success).toBe(false);
    expect(assetListQuerySchema.safeParse({ status: "unknown" }).success).toBe(false);
    expect(assetListQuerySchema.safeParse({ filename: "   " }).success).toBe(false);
    expect(assetListQuerySchema.safeParse({ tags: [""] }).success).toBe(false);
  });

  it("accepts every documented sort and rejects unknown ones", () => {
    for (const sort of ["createdAt_desc", "createdAt_asc", "filename_asc", "duration_asc"]) {
      expect(assetListQuerySchema.safeParse({ sort }).success).toBe(true);
    }
    expect(assetListQuerySchema.safeParse({ sort: "createdAt" }).success).toBe(false);
    expect(assetListQuerySchema.safeParse({ sort: "" }).success).toBe(false);
  });

  it("accepts the metadata filters and rejects invalid durations", () => {
    expect(assetListQuerySchema.safeParse({ hasAudio: false }).success).toBe(true);
    expect(assetListQuerySchema.safeParse({ durationMinMs: 0 }).success).toBe(true);
    expect(assetListQuerySchema.safeParse({ durationMaxMs: 10 }).success).toBe(true);
    expect(assetListQuerySchema.safeParse({ durationMinMs: -1 }).success).toBe(false);
    expect(assetListQuerySchema.safeParse({ durationMaxMs: -1 }).success).toBe(false);
    expect(assetListQuerySchema.safeParse({ durationMinMs: 1.5 }).success).toBe(false);
  });

  it("rejects an inverted duration range", () => {
    const inverted = assetListQuerySchema.safeParse({
      durationMinMs: 9_000,
      durationMaxMs: 1_000,
    });
    expect(inverted.success).toBe(false);
    expect(assetListQuerySchema.safeParse({ durationMinMs: 1_000, durationMaxMs: 1_000 }).success).toBe(
      true,
    );
  });

  it("accepts exact dimension filters and inclusive dimension ranges", () => {
    expect(assetListQuerySchema.safeParse({ widthPx: 1024, heightPx: 576 }).success).toBe(true);
    expect(
      assetListQuerySchema.safeParse({
        widthMinPx: 512,
        widthMaxPx: 2048,
        heightMinPx: 512,
        heightMaxPx: 2048,
      }).success,
    ).toBe(true);
    expect(
      assetListQuerySchema.safeParse({
        widthPx: 1024,
        widthMinPx: 1024,
        widthMaxPx: 1024,
      }).success,
    ).toBe(true);
    for (const value of [0, -1, 1.5]) {
      expect(assetListQuerySchema.safeParse({ widthPx: value }).success).toBe(false);
      expect(assetListQuerySchema.safeParse({ heightMaxPx: value }).success).toBe(false);
    }
  });

  it("rejects contradictory dimension filters", () => {
    const invertedWidth = assetListQuerySchema.safeParse({
      widthMinPx: 2_000,
      widthMaxPx: 1_000,
    });
    expect(invertedWidth.success).toBe(false);
    expect(invertedWidth.error?.issues[0]?.path).toEqual(["widthMaxPx"]);

    const invertedHeight = assetListQuerySchema.safeParse({
      heightMinPx: 2_000,
      heightMaxPx: 1_000,
    });
    expect(invertedHeight.success).toBe(false);
    expect(invertedHeight.error?.issues[0]?.path).toEqual(["heightMaxPx"]);

    expect(
      assetListQuerySchema.safeParse({ widthPx: 100, widthMinPx: 200 }).success,
    ).toBe(false);
    expect(
      assetListQuerySchema.safeParse({ heightPx: 100, heightMaxPx: 50 }).success,
    ).toBe(false);
    expect(
      assetListQuerySchema.safeParse({ widthMinPx: 1_000, widthMaxPx: 1_000 }).success,
    ).toBe(true);
  });
});

describe("assetListPageSchema", () => {
  it("requires an explicit next cursor and the total count", () => {
    expect(assetListPageSchema.parse({ assets: [], nextCursor: null, total: 0 })).toEqual({
      assets: [],
      nextCursor: null,
      total: 0,
    });
    expect(
      assetListPageSchema.safeParse({ assets: [], nextCursor: "cursor-2", total: 3 }).success,
    ).toBe(true);
    expect(assetListPageSchema.safeParse({ assets: [], nextCursor: null }).success).toBe(false);
    expect(
      assetListPageSchema.safeParse({ assets: [], nextCursor: null, total: -1 }).success,
    ).toBe(false);
    expect(
      assetListPageSchema.safeParse({ assets: [], nextCursor: null, total: 1.5 }).success,
    ).toBe(false);
  });
});
