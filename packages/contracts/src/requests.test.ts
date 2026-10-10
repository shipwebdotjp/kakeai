import { describe, expect, it } from "vitest";
import {
  createWorkRequestSchema,
  saveScriptVersionRequestSchema,
  updateAssetRequestSchema,
} from "./requests";
import { assetTagsSchema, MAX_ASSET_TAG_LENGTH, MAX_ASSET_TAGS } from "./asset";
import { validContentDocument } from "./testing/fixtures";

describe("createWorkRequestSchema", () => {
  it("accepts a valid request", () => {
    expect(
      createWorkRequestSchema.safeParse({ title: "作品", originalLocale: "ja-JP" }).success,
    ).toBe(true);
  });

  it("rejects unknown fields", () => {
    expect(
      createWorkRequestSchema.safeParse({ title: "作品", originalLocale: "ja-JP", extra: 1 }).success,
    ).toBe(false);
  });

  it("rejects an unsupported locale", () => {
    expect(
      createWorkRequestSchema.safeParse({ title: "作品", originalLocale: "en-US" }).success,
    ).toBe(false);
  });
});

describe("saveScriptVersionRequestSchema", () => {
  it("defaults sourceScriptVersionId to null", () => {
    const result = saveScriptVersionRequestSchema.parse({ content: validContentDocument() });
    expect(result.sourceScriptVersionId).toBeNull();
  });

  it("rejects unknown fields", () => {
    const result = saveScriptVersionRequestSchema.safeParse({
      content: validContentDocument(),
      extra: true,
    });
    expect(result.success).toBe(false);
  });
});

describe("assetTagsSchema", () => {
  it("trims and de-duplicates tags", () => {
    expect(assetTagsSchema.parse([" 夏 ", "背景", "夏", ""])).toEqual(["夏", "背景"]);
  });

  it("rejects a tag longer than the limit", () => {
    expect(assetTagsSchema.safeParse(["あ".repeat(MAX_ASSET_TAG_LENGTH + 1)]).success).toBe(false);
  });

  it("rejects more tags than the limit", () => {
    const tags = Array.from({ length: MAX_ASSET_TAGS + 1 }, (_, index) => `tag-${index}`);
    expect(assetTagsSchema.safeParse(tags).success).toBe(false);
  });
});

describe("updateAssetRequestSchema", () => {
  it("accepts a tag list", () => {
    expect(updateAssetRequestSchema.parse({ tags: ["背景"] })).toEqual({ tags: ["背景"] });
  });

  it("rejects unknown fields", () => {
    expect(updateAssetRequestSchema.safeParse({ tags: [], extra: 1 }).success).toBe(false);
  });

  it("rejects a missing tags field", () => {
    expect(updateAssetRequestSchema.safeParse({}).success).toBe(false);
  });
});
