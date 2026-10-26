import { describe, expect, it } from "vitest";
import {
  cloneWorkRequestSchema,
  createLanguageEditionRequestSchema,
  createWorkRequestSchema,
  draftPreviewRequestSchema,
  previewThemeDraftRequestSchema,
  saveScriptVersionRequestSchema,
  updateAssetRequestSchema,
} from "./requests";
import { getVisualTheme } from "./content/theme";
import { draftPreviewSchema } from "./dto";
import { assetTagsSchema, MAX_ASSET_TAG_LENGTH, MAX_ASSET_TAGS } from "./asset";
import { validContentDocument } from "./testing/fixtures";

describe("cloneWorkRequestSchema", () => {
  it("accepts a valid request", () => {
    expect(cloneWorkRequestSchema.safeParse({ title: "作品のコピー" }).success).toBe(true);
  });

  it("rejects unknown fields", () => {
    expect(
      cloneWorkRequestSchema.safeParse({ title: "作品のコピー", extra: "bar" }).success,
    ).toBe(false);
  });

  it("rejects blank title", () => {
    expect(cloneWorkRequestSchema.safeParse({ title: "   " }).success).toBe(false);
  });
});

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

  it("accepts a supported non-default locale", () => {
    expect(
      createWorkRequestSchema.safeParse({ title: "作品", originalLocale: "en-US" }).success,
    ).toBe(true);
  });

  it("rejects an unsupported locale", () => {
    expect(
      createWorkRequestSchema.safeParse({ title: "作品", originalLocale: "fr-FR" }).success,
    ).toBe(false);
  });
});

describe("createLanguageEditionRequestSchema", () => {
  it("accepts a locale and source edition", () => {
    expect(
      createLanguageEditionRequestSchema.safeParse({
        locale: "en-US",
        sourceEditionId: "edition-1",
      }).success,
    ).toBe(true);
  });

  it("rejects an unsupported locale", () => {
    expect(
      createLanguageEditionRequestSchema.safeParse({
        locale: "fr-FR",
        sourceEditionId: "edition-1",
      }).success,
    ).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(
      createLanguageEditionRequestSchema.safeParse({
        locale: "en-US",
        sourceEditionId: "edition-1",
        extra: 1,
      }).success,
    ).toBe(false);
  });
});

describe("previewThemeDraftRequestSchema", () => {
  const definition = getVisualTheme("soft-editorial", 1)!;

  it("defaults the preview locale to ja-JP", () => {
    const parsed = previewThemeDraftRequestSchema.parse({ definition });
    expect(parsed.locale).toBe("ja-JP");
  });

  it("accepts supported locales and rejects unsupported ones", () => {
    expect(
      previewThemeDraftRequestSchema.safeParse({ definition, locale: "zh-Hant" }).success,
    ).toBe(true);
    expect(
      previewThemeDraftRequestSchema.safeParse({ definition, locale: "fr-FR" }).success,
    ).toBe(false);
    expect(
      previewThemeDraftRequestSchema.safeParse({ definition, extra: true }).success,
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

describe("draftPreviewRequestSchema", () => {
  it("accepts a content document and rejects unknown fields", () => {
    expect(
      draftPreviewRequestSchema.safeParse({ content: validContentDocument() }).success,
    ).toBe(true);
    expect(
      draftPreviewRequestSchema.safeParse({ content: validContentDocument(), extra: 1 }).success,
    ).toBe(false);
  });
});

describe("draftPreviewSchema", () => {
  it("requires the draft source and the saved preview shape", () => {
    const base = {
      compositionHtml: "<!doctype html><html></html>",
      assets: [],
      compositions: [],
      renderer: { engine: "hyperframes", compilerVersion: "app-1", playerVersion: "0.8.141" },
      timeline: { totalDurationMs: 0, fps: 30, scenes: [] },
    };
    expect(
      draftPreviewSchema.safeParse({ ...base, source: { kind: "draft" } }).success,
    ).toBe(true);
    expect(draftPreviewSchema.safeParse({ ...base }).success).toBe(false);
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

  it("accepts favorite and archive flags", () => {
    expect(updateAssetRequestSchema.parse({ favorited: true })).toEqual({ favorited: true });
    expect(updateAssetRequestSchema.parse({ archived: false })).toEqual({ archived: false });
  });

  it("rejects unknown fields", () => {
    expect(updateAssetRequestSchema.safeParse({ tags: [], extra: 1 }).success).toBe(false);
  });

  it("rejects an empty patch", () => {
    expect(updateAssetRequestSchema.safeParse({}).success).toBe(false);
  });
});
