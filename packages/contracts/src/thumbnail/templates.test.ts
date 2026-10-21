import { describe, expect, it } from "vitest";
import {
  collectThumbnailAssetRefs,
  getThumbnailTemplate,
  listThumbnailTemplateCatalog,
  thumbnailHeadlinePhotoInputSchema,
  thumbnailLayeredInputSchema,
  thumbnailTextInputSchema,
} from "./templates";
import { thumbnailDocumentSchema } from "./document";

describe("thumbnail templates", () => {
  it("registers bundled templates with editable fields", () => {
    const catalog = listThumbnailTemplateCatalog();
    expect(catalog.length).toBeGreaterThanOrEqual(2);
    for (const entry of catalog) {
      const definition = getThumbnailTemplate(entry.id, entry.version);
      expect(definition?.inputFields?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("exposes a layout variant on the headline-photo template", () => {
    const definition = getThumbnailTemplate("thumbnail.headline-photo", 1);
    const layout = definition?.inputFields?.find((field) => field.key === "layout");
    expect(layout?.kind).toBe("select");
    if (layout?.kind === "select") {
      expect(layout.options.map((option) => option.value)).toEqual(["photo-left", "photo-right"]);
    }
  });

  it("returns undefined for an unknown template", () => {
    expect(getThumbnailTemplate("thumbnail.missing", 1)).toBeUndefined();
  });

  it("applies defaults when parsing input", () => {
    const parsed = thumbnailHeadlinePhotoInputSchema.parse({
      headline: "タイトル",
      assetId: "ast_1",
    });
    expect(parsed.layout).toBe("photo-left");
    expect(parsed.tone).toBe("accent");
  });

  it("collects image asset references", () => {
    const refs = collectThumbnailAssetRefs({
      schemaVersion: 1,
      template: { id: "thumbnail.headline-photo", version: 1 },
      input: { headline: "タイトル", assetId: "ast_1" },
    });
    expect(refs).toEqual([
      { assetId: "ast_1", allowedKinds: ["image"], path: ["input", "assetId"] },
    ]);
  });

  it("collects no references for the text-only template", () => {
    const refs = collectThumbnailAssetRefs({
      schemaVersion: 1,
      template: { id: "thumbnail.text", version: 1 },
      input: { headline: "タイトル" },
    });
    expect(refs).toEqual([]);
  });

  it("exposes the layered template with the stack and character position selects", () => {
    const definition = getThumbnailTemplate("thumbnail.layered", 1);
    expect(definition).toBeDefined();
    const stack = definition?.inputFields?.find((field) => field.key === "stack");
    expect(stack?.kind).toBe("select");
    if (stack?.kind === "select") {
      expect(stack.options.map((option) => option.value)).toEqual([
        "text-character-main",
        "character-text-main",
        "character-main-text",
        "main-character-text",
      ]);
    }
    const position = definition?.inputFields?.find((field) => field.key === "characterPosition");
    expect(position?.kind).toBe("select");
  });

  it("applies the layered defaults", () => {
    const parsed = thumbnailLayeredInputSchema.parse({ headline: "タイトル" });
    expect(parsed.stack).toBe("text-character-main");
    expect(parsed.characterPosition).toBe("right");
  });

  it("collects layered image references from provided slots only", () => {
    const refs = collectThumbnailAssetRefs({
      schemaVersion: 1,
      template: { id: "thumbnail.layered", version: 1 },
      input: { headline: "タイトル", mainAssetId: "ast_main", characterAssetId: "ast_char" },
    });
    expect(refs).toEqual([
      { assetId: "ast_main", allowedKinds: ["image"], path: ["input", "mainAssetId"] },
      { assetId: "ast_char", allowedKinds: ["image"], path: ["input", "characterAssetId"] },
    ]);
  });

  it("validates the thumbnail document shape and rejects unknown versions", () => {
    expect(
      thumbnailDocumentSchema.safeParse({
        schemaVersion: 1,
        template: { id: "thumbnail.text", version: 1 },
        input: { headline: "タイトル" },
      }).success,
    ).toBe(true);
    expect(getThumbnailTemplate("thumbnail.text", 2)).toBeUndefined();
    expect(thumbnailTextInputSchema.parse({ headline: "x" }).tone).toBe("accent");
  });

  it("declares rich text fields with the marks they accept", () => {
    const definition = getThumbnailTemplate("thumbnail.text", 1);
    const headline = definition?.inputFields?.find((field) => field.key === "headline");
    expect(headline?.kind).toBe("richText");
    if (headline?.kind === "richText") {
      expect(headline.marks).toEqual(["bold", "italic", "accent", "outline"]);
      expect(headline.optional).toBeUndefined();
    }
    const subline = definition?.inputFields?.find((field) => field.key === "subline");
    expect(subline?.kind === "richText" && subline.optional).toBe(true);
    const badge = definition?.inputFields?.find((field) => field.key === "badge");
    if (badge?.kind === "richText") {
      expect(badge.marks).not.toContain("accent");
      expect(badge.optional).toBe(true);
    }
  });

  it("accepts inline marks in text fields and rejects marks a field does not allow", () => {
    expect(thumbnailTextInputSchema.safeParse({ headline: "**見出し**と==色==" }).success).toBe(
      true,
    );
    expect(thumbnailTextInputSchema.safeParse({ headline: "**閉じない" }).success).toBe(true);
    expect(
      thumbnailHeadlinePhotoInputSchema.safeParse({
        headline: "見出し",
        assetId: "ast_1",
        badge: "==バッジ==",
      }).success,
    ).toBe(false);
  });
});
