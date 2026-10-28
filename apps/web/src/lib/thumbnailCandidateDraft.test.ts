import { describe, expect, it } from "vitest";
import type { Thumbnail } from "@kakeai/contracts";
import { editionLocaleLabel } from "./localeLabels";
import {
  blankThumbnailCandidateDraft,
  importedThumbnailCandidateDraft,
  thumbnailDraftSubmitBody,
  withThumbnailDraftValue,
} from "./thumbnailCandidateDraft";

const TEMPLATE = { id: "thumbnail.cutout-hero", version: 1 } as const;

function sourceCandidate(overrides: Partial<Thumbnail> = {}): Thumbnail {
  return {
    id: "thm_source",
    languageEditionId: "led_source",
    label: "既存候補",
    schemaVersion: 3,
    template: TEMPLATE,
    input: {
      headline: "元の見出し",
      subline: "元の補足",
      backgroundAssetId: "ast_bg",
      foregroundAssetId: "ast_fg",
      subjectScale: 1.4,
      textWidth: 70,
      wrapText: false,
    },
    appearanceOverride: { headline: { color: "#00FFFF" } },
    isPrimary: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("thumbnail candidate import draft", () => {
  it("shows the current Edition locale", () => {
    expect(editionLocaleLabel("ja-JP")).toBe("日本語 (ja-JP)");
    expect(editionLocaleLabel("zh-Hant")).toBe("繁體中文 (zh-Hant)");
  });

  it("copies name, text, template, assets and placement but not the override", () => {
    const source = sourceCandidate();
    const draft = importedThumbnailCandidateDraft(source, "led_other");
    expect(draft.label).toBe(source.label);
    expect(draft.template).toEqual(source.template);
    expect(draft.input).toMatchObject({
      headline: "元の見出し",
      subline: "元の補足",
      backgroundAssetId: "ast_bg",
      foregroundAssetId: "ast_fg",
      subjectScale: 1.4,
      textWidth: 70,
      wrapText: false,
    });
    expect(draft.appearanceOverride).toBeNull();
    expect(draft.importedFrom).toEqual({
      editionId: "led_other",
      thumbnailId: source.id,
      label: source.label,
    });
  });

  it("edits the imported text in the draft without changing the source", () => {
    const source = sourceCandidate();
    const draft = importedThumbnailCandidateDraft(source, "led_other");
    const edited = withThumbnailDraftValue(draft, "headline", "編集後の見出し");
    const body = thumbnailDraftSubmitBody(edited);
    expect(body.input.headline).toBe("編集後の見出し");
    expect(body.label).toBe("既存候補");
    expect((source.input as Record<string, unknown>).headline).toBe("元の見出し");
    expect(source.appearanceOverride).toEqual({ headline: { color: "#00FFFF" } });
  });

  it("discards an import back to a blank draft without creating a candidate", () => {
    const source = sourceCandidate();
    const imported = importedThumbnailCandidateDraft(source, "led_other");
    expect(imported.importedFrom).not.toBeNull();

    const discarded = blankThumbnailCandidateDraft(TEMPLATE);
    expect(discarded.label).toBe("");
    expect(discarded.input).not.toHaveProperty("backgroundAssetId");
    expect(discarded.appearanceOverride).toBeNull();
    expect(discarded.importedFrom).toBeNull();
    // Discarding only resets the form; creation happens on an explicit submit.
    expect(thumbnailDraftSubmitBody(discarded)).toMatchObject({
      label: "無題",
      template: TEMPLATE,
    });
  });
});
