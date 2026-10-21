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
});

describe("assetListPageSchema", () => {
  it("requires an explicit next cursor", () => {
    expect(assetListPageSchema.parse({ assets: [], nextCursor: null })).toEqual({
      assets: [],
      nextCursor: null,
    });
    expect(
      assetListPageSchema.safeParse({ assets: [], nextCursor: "cursor-2" }).success,
    ).toBe(true);
    expect(assetListPageSchema.safeParse({ assets: [] }).success).toBe(false);
    expect(
      assetListPageSchema.safeParse({ assets: [], nextCursor: null, total: 0 }).success,
    ).toBe(false);
  });
});
