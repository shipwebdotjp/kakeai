import type { Thumbnail, ThumbnailAppearance } from "@kakeai/contracts";
import { defaultThumbnailInput, thumbnailInputWithDefaults } from "./thumbnailTemplate";

export interface ThumbnailCandidateDraft {
  label: string;
  template: { id: string; version: number };
  input: Record<string, unknown>;
  appearanceOverride: ThumbnailAppearance | null;
  /** Source candidate when the draft was loaded from another Edition. */
  importedFrom: { editionId: string; thumbnailId: string; label: string } | null;
}

/** An empty candidate for the current Edition. */
export function blankThumbnailCandidateDraft(template: {
  id: string;
  version: number;
}): ThumbnailCandidateDraft {
  return {
    label: "",
    template,
    input: defaultThumbnailInput(template.id, template.version),
    appearanceOverride: null,
    importedFrom: null,
  };
}

/**
 * Copies name, text, template, asset references and crop/placement settings.
 * The source candidate's appearance override is deliberately not copied so the
 * target Work appearance applies on save.
 */
export function importedThumbnailCandidateDraft(
  source: Thumbnail,
  sourceEditionId: string,
): ThumbnailCandidateDraft {
  return {
    label: source.label,
    template: source.template,
    input: thumbnailInputWithDefaults(
      source.template.id,
      source.template.version,
      source.input,
    ),
    appearanceOverride: null,
    importedFrom: {
      editionId: sourceEditionId,
      thumbnailId: source.id,
      label: source.label,
    },
  };
}

/** Editing the imported text changes only the local draft. */
export function withThumbnailDraftValue(
  draft: ThumbnailCandidateDraft,
  key: string,
  value: unknown,
): ThumbnailCandidateDraft {
  return { ...draft, input: { ...draft.input, [key]: value } };
}

/** The create/save body. A missing appearance override stays omitted. */
export function thumbnailDraftSubmitBody(draft: ThumbnailCandidateDraft): {
  label: string;
  template: ThumbnailCandidateDraft["template"];
  input: Record<string, unknown>;
  appearanceOverride?: ThumbnailAppearance;
} {
  return {
    label: draft.label.trim().length === 0 ? "無題" : draft.label.trim(),
    template: draft.template,
    input: draft.input,
    ...(draft.appearanceOverride === null
      ? {}
      : { appearanceOverride: draft.appearanceOverride }),
  };
}
