import { describe, expect, it } from "vitest";
import {
  createDefaultYouTubeVideoSettingsDocument,
  updateYouTubeVideoSettingsRequestSchema,
  youtubeVideoSettingsDocumentSchema,
} from "./settings";

describe("YouTubeVideoSettings contracts", () => {
  it("creates valid default document for a work and locale", () => {
    const doc = createDefaultYouTubeVideoSettingsDocument("My Cool Video Work", "ja-JP");
    expect(doc.title).toBe("My Cool Video Work");
    expect(doc.description).toBe("");
    expect(doc.tags).toEqual([]);
    expect(doc.category).toBeNull();
    expect(doc.language).toBe("ja");
    expect(doc.visibility).toBe("public");
    expect(doc.publishAt).toBeNull();
    expect(doc.premiere).toBe(false);
    expect(doc.declarations.audience).toBe("not_applicable");
    expect(doc.declarations.ageRestriction).toBe("not_applicable");
    expect(doc.declarations.paidPromotion).toBe("not_applicable");
    expect(doc.declarations.syntheticContent).toBe("not_applicable");

    const parsed = youtubeVideoSettingsDocumentSchema.safeParse(doc);
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown fields on update request schema", () => {
    const doc = createDefaultYouTubeVideoSettingsDocument("Test Title", "ja-JP");
    const withUnknown = {
      ...doc,
      unknownExtraField: "should be rejected",
    };
    const parsed = updateYouTubeVideoSettingsRequestSchema.safeParse(withUnknown);
    expect(parsed.success).toBe(false);
  });

  it("enforces title length <= 100 characters", () => {
    const validTitle = "a".repeat(100);
    const invalidTitle = "a".repeat(101);

    const docValid = createDefaultYouTubeVideoSettingsDocument(validTitle, "ja-JP");
    expect(youtubeVideoSettingsDocumentSchema.safeParse(docValid).success).toBe(true);

    const docInvalid = { ...docValid, title: invalidTitle };
    expect(youtubeVideoSettingsDocumentSchema.safeParse(docInvalid).success).toBe(false);
  });

  it("validates description by code points (max 5,000 code points)", () => {
    const validDesc = "😀".repeat(5000); // 5000 emojis (each 1 code point, multiple UTF-16 bytes)
    const invalidDesc = "😀".repeat(5001);

    const docValid = {
      ...createDefaultYouTubeVideoSettingsDocument("Title", "ja-JP"),
      description: validDesc,
    };
    expect(youtubeVideoSettingsDocumentSchema.safeParse(docValid).success).toBe(true);

    const docInvalid = { ...docValid, description: invalidDesc };
    expect(youtubeVideoSettingsDocumentSchema.safeParse(docInvalid).success).toBe(false);
  });

  it("rejects duplicate tags", () => {
    const docWithDuplicates = {
      ...createDefaultYouTubeVideoSettingsDocument("Title", "ja-JP"),
      tags: ["tag1", "tag2", "tag1"],
    };
    expect(youtubeVideoSettingsDocumentSchema.safeParse(docWithDuplicates).success).toBe(false);

    const docValidTags = {
      ...createDefaultYouTubeVideoSettingsDocument("Title", "ja-JP"),
      tags: ["tag1", "tag2", "tag3"],
    };
    expect(youtubeVideoSettingsDocumentSchema.safeParse(docValidTags).success).toBe(true);
  });

  it("rejects allow_all comments when video is made_for_kids", () => {
    const docKids = {
      ...createDefaultYouTubeVideoSettingsDocument("Title", "ja-JP"),
      declarations: {
        audience: "made_for_kids" as const,
        ageRestriction: "not_applicable" as const,
        paidPromotion: "not_applicable" as const,
        syntheticContent: "not_applicable" as const,
      },
      comments: { mode: "allow_all" as const },
    };
    expect(youtubeVideoSettingsDocumentSchema.safeParse(docKids).success).toBe(false);

    const docKidsDisabled = {
      ...docKids,
      comments: { mode: "disabled" as const },
    };
    expect(youtubeVideoSettingsDocumentSchema.safeParse(docKidsDisabled).success).toBe(true);
  });

  it("validates publishAt ISO datetime string format", () => {
    const docValidIso = {
      ...createDefaultYouTubeVideoSettingsDocument("Title", "ja-JP"),
      publishAt: "2026-12-31T12:00:00.000Z",
    };
    expect(youtubeVideoSettingsDocumentSchema.safeParse(docValidIso).success).toBe(true);

    const docInvalidIso = {
      ...createDefaultYouTubeVideoSettingsDocument("Title", "ja-JP"),
      publishAt: "invalid-datetime-string",
    };
    expect(youtubeVideoSettingsDocumentSchema.safeParse(docInvalidIso).success).toBe(false);
  });
});
