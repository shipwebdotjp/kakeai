import { describe, expect, it } from "vitest";
import {
  collectThumbnailAssetRefs,
  getThumbnailTemplate,
  listThumbnailTemplateCatalog,
  thumbnailHeadlinePhotoInputSchema,
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
});
