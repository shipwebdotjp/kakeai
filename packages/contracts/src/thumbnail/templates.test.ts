import { describe, expect, it } from "vitest";
import {
  collectThumbnailAssetRefs,
  getThumbnailTemplate,
  listThumbnailTemplateCatalog,
  thumbnailCutoutHeroInputSchema,
} from "./templates";
import { thumbnailDocumentSchema } from "./document";

const VALID_INPUT = {
  headline: "見出し",
  backgroundAssetId: "ast_bg",
  foregroundAssetId: "ast_fg",
};

describe("thumbnail templates", () => {
  it("registers only the cutout-hero template with editable fields", () => {
    const catalog = listThumbnailTemplateCatalog();
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({ id: "thumbnail.cutout-hero", version: 1 });
    const definition = getThumbnailTemplate(catalog[0]!.id, catalog[0]!.version);
    expect(definition?.inputFields?.length ?? 0).toBeGreaterThan(0);
  });

  it("exposes the subject side select with right as the first option", () => {
    const definition = getThumbnailTemplate("thumbnail.cutout-hero", 1);
    const side = definition?.inputFields?.find((field) => field.key === "subjectSide");
    expect(side?.kind).toBe("select");
    if (side?.kind === "select") {
      expect(side.options.map((option) => option.value)).toEqual(["right", "left"]);
    }
  });

  it("returns undefined for an unknown template", () => {
    expect(getThumbnailTemplate("thumbnail.missing", 1)).toBeUndefined();
    expect(getThumbnailTemplate("thumbnail.cutout-hero", 2)).toBeUndefined();
  });

  it("applies the cutout defaults when parsing input", () => {
    const parsed = thumbnailCutoutHeroInputSchema.parse(VALID_INPUT);
    expect(parsed.subjectSide).toBe("right");
    expect(parsed.flipForeground).toBe(false);
    expect(parsed.subjectAnchor).toBe("bottom-center");
    expect(parsed.subjectScale).toBe(1);
    expect(parsed.textWidth).toBe(50);
    expect(parsed.wrapText).toBe(true);
  });

  it("keeps the template UI defaults aligned with the schema defaults", () => {
    const definition = getThumbnailTemplate("thumbnail.cutout-hero", 1);
    const parsed = thumbnailCutoutHeroInputSchema.parse(VALID_INPUT);
    expect(definition?.uiDefaults).toEqual({
      subjectSide: parsed.subjectSide,
      flipForeground: parsed.flipForeground,
      subjectAnchor: parsed.subjectAnchor,
      subjectScale: parsed.subjectScale,
      textWidth: parsed.textWidth,
      wrapText: parsed.wrapText,
    });
    const fieldKeys = new Set(definition?.inputFields?.map((field) => field.key));
    for (const key of Object.keys(definition?.uiDefaults ?? {})) {
      expect(fieldKeys.has(key)).toBe(true);
    }
  });

  it("validates the new scale, text width, and anchor ranges", () => {
    expect(
      thumbnailCutoutHeroInputSchema.safeParse({
        ...VALID_INPUT,
        subjectScale: 1.8,
        textWidth: 100,
        subjectAnchor: "top-left",
        wrapText: false,
      }).success,
    ).toBe(true);
    expect(
      thumbnailCutoutHeroInputSchema.safeParse({ ...VALID_INPUT, subjectScale: 1.81 }).success,
    ).toBe(false);
    expect(
      thumbnailCutoutHeroInputSchema.safeParse({ ...VALID_INPUT, textWidth: 29 }).success,
    ).toBe(false);
    expect(
      thumbnailCutoutHeroInputSchema.safeParse({ ...VALID_INPUT, subjectAnchor: "middle" }).success,
    ).toBe(false);
  });

  it("requires both background and foreground images", () => {
    expect(
      thumbnailCutoutHeroInputSchema.safeParse({ ...VALID_INPUT, foregroundAssetId: undefined })
        .success,
    ).toBe(false);
    expect(
      thumbnailCutoutHeroInputSchema.safeParse({ ...VALID_INPUT, backgroundAssetId: undefined })
        .success,
    ).toBe(false);
  });

  it("collects both image asset references", () => {
    const refs = collectThumbnailAssetRefs({
      schemaVersion: 3,
      template: { id: "thumbnail.cutout-hero", version: 1 },
      input: VALID_INPUT,
    });
    expect(refs).toEqual([
      { assetId: "ast_bg", allowedKinds: ["image"], path: ["input", "backgroundAssetId"] },
      { assetId: "ast_fg", allowedKinds: ["image"], path: ["input", "foregroundAssetId"] },
    ]);
  });

  it("parses v3 documents and rejects old or unknown versions", () => {
    const template = { id: "thumbnail.cutout-hero", version: 1 };
    expect(
      thumbnailDocumentSchema.safeParse({
        schemaVersion: 3,
        template,
        input: VALID_INPUT,
        appearanceOverride: { headline: { color: "#FFFFFF" } },
      }).success,
    ).toBe(true);
    expect(
      thumbnailDocumentSchema.safeParse({ schemaVersion: 2, template, input: VALID_INPUT }).success,
    ).toBe(false);
    expect(
      thumbnailDocumentSchema.safeParse({ schemaVersion: 1, template, input: VALID_INPUT }).success,
    ).toBe(false);
    expect(
      thumbnailDocumentSchema.safeParse({
        schemaVersion: 3,
        template,
        input: VALID_INPUT,
        unknown: true,
      }).success,
    ).toBe(false);
  });

  it("declares rich text fields with all supported marks", () => {
    const definition = getThumbnailTemplate("thumbnail.cutout-hero", 1);
    const headline = definition?.inputFields?.find((field) => field.key === "headline");
    expect(headline?.kind).toBe("richText");
    if (headline?.kind === "richText") {
      expect(headline.marks).toEqual(["bold", "italic", "accent", "outline"]);
      expect(headline.optional).toBeUndefined();
    }
    const subline = definition?.inputFields?.find((field) => field.key === "subline");
    expect(subline?.kind === "richText" && subline.optional).toBe(true);
  });
});
