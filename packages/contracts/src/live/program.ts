import { z, type RefinementCtx } from "zod";
import { idSchema, positiveInt, timestampSchema } from "../content/primitives";
import { visualThemeRefSchema } from "../content/theme";
import { liveSideSchema } from "./common";
import {
  liveCardImageAssetIds,
  liveCardSchema,
  liveVisualRefSchema,
  resolveLiveCardState,
  type LiveVisualRef,
} from "./card";
import {
  liveCommentPolicySchema,
  liveCutInInputSchema,
  livePlayoutSchema,
  liveSafetySchema,
} from "./profile";
import {
  validateClosingReserve,
  validateCueMembership,
  validateRightCast,
  validateSpineStructure,
} from "./spine-validation";
import { validateSegmentCueReferences } from "./segment-references";

export const LIVE_PROGRAM_SCHEMA_VERSION = 1 as const;

export const liveProgramStageTemplateSchema = z.literal("news-desk");
export type LiveProgramStageTemplate = z.infer<typeof liveProgramStageTemplateSchema>;

export const liveProgramCastMemberSchema = z.strictObject({
  characterId: idSchema,
  voiceProfileId: idSchema,
});
export type LiveProgramCastMember = z.infer<typeof liveProgramCastMemberSchema>;

export const liveProgramCastSchema = z.strictObject({
  left: liveProgramCastMemberSchema,
  right: liveProgramCastMemberSchema.nullable().default(null),
});
export type LiveProgramCast = z.infer<typeof liveProgramCastSchema>;

/**
 * Provenance only. The format is copied into the program; it is never
 * referenced for live editing or export resolution.
 */
export const liveProgramSourceFormatSchema = z.strictObject({
  formatId: idSchema,
  formatUpdatedAt: timestampSchema,
});
export type LiveProgramSourceFormat = z.infer<typeof liveProgramSourceFormatSchema>;

export const liveProgramCueSchema = z.strictObject({
  id: idSchema,
  speaker: liveSideSchema,
  caption: z.string().trim().min(1),
  speech: z.string().trim().min(1),
  expression: idSchema,
  /** Optional pre-existing audio Asset. Export fails rather than silently using TTS. */
  audioAssetId: idSchema.optional(),
  /** Centre visual; null hides it, omitted inherits the segment default. */
  visual: liveVisualRefSchema.nullable().optional(),
});
export type LiveProgramCue = z.infer<typeof liveProgramCueSchema>;

const segmentBaseShape = {
  id: idSchema,
  label: z.string().trim().min(1),
  targetDurationMs: positiveInt,
  visual: liveVisualRefSchema.optional(),
};

export const liveProgramCueSegmentSchema = z.strictObject({
  ...segmentBaseShape,
  kind: z.enum(["opening", "script", "closing"]),
  /** Draft may be empty; version validation requires at least one cue. */
  cues: z.array(idSchema).default([]),
});
export type LiveProgramCueSegment = z.infer<typeof liveProgramCueSegmentSchema>;

export const liveProgramCommentSegmentSchema = z.strictObject({
  ...segmentBaseShape,
  kind: z.literal("comment"),
  /** Partial override of the program-level comment policy. */
  commentPolicy: liveCommentPolicySchema.partial().optional(),
});
export type LiveProgramCommentSegment = z.infer<typeof liveProgramCommentSegmentSchema>;

export const liveProgramCutInSegmentSchema = z.strictObject({
  id: idSchema,
  label: z.string().trim().min(1),
  kind: z.literal("cut_in"),
  cutInId: idSchema,
});
export type LiveProgramCutInSegment = z.infer<typeof liveProgramCutInSegmentSchema>;

export const liveProgramSegmentSchema = z.discriminatedUnion("kind", [
  liveProgramCueSegmentSchema,
  liveProgramCommentSegmentSchema,
  liveProgramCutInSegmentSchema,
]);
export type LiveProgramSegment = z.infer<typeof liveProgramSegmentSchema>;

/**
 * A program-owned material reference. The snapshot of the imported Work scene
 * belongs to the Live Material entity; this document only owns the binding.
 */
export const liveProgramMaterialSchema = z.strictObject({
  id: idSchema,
  name: z.string().trim().min(1).optional(),
});
export type LiveProgramMaterial = z.infer<typeof liveProgramMaterialSchema>;

const DEFAULT_COMMENT_POLICY = {
  mode: "corner",
  freshnessMin: 10,
  maxCommentsPerCorner: 4,
  maxHumanPinsPerCorner: 4,
  maxExtraSlots: 2,
  allowImmediateInterrupt: false,
  skipWhenEmpty: true,
} as const;

const DEFAULT_PLAYOUT = {
  minBufferMs: 10_000,
  maxThinkingMs: 2_000,
  closingReserveMs: 120_000,
  noApprovalDelay: true,
} as const;

/**
 * Shape and basic-reference validation shared by drafts and versions.
 * Completeness rules (opening/closing/fallback/cast) live in
 * `validateLiveProgramDocumentForVersion`.
 */
export function validateLiveProgramDocumentDraft(
  document: LiveProgramDocument,
  ctx: RefinementCtx,
): void {
  const segmentIds = new Set<string>();
  for (const [index, segment] of document.segments.entries()) {
    if (segmentIds.has(segment.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["segments", index, "id"],
        message: `セグメント ID が重複しています: ${segment.id}`,
      });
    }
    segmentIds.add(segment.id);
  }

  const cueIds = new Set<string>();
  for (const [index, cue] of document.cues.entries()) {
    if (cueIds.has(cue.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["cues", index, "id"],
        message: `キュー ID が重複しています: ${cue.id}`,
      });
    }
    cueIds.add(cue.id);
  }

  const cardIds = new Set<string>();
  for (const [index, card] of document.cards.entries()) {
    if (cardIds.has(card.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["cards", index, "id"],
        message: `カード ID が重複しています: ${card.id}`,
      });
    }
    cardIds.add(card.id);
  }

  const materialIds = new Set<string>();
  for (const [index, material] of document.materials.entries()) {
    if (materialIds.has(material.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["materials", index, "id"],
        message: `素材 ID が重複しています: ${material.id}`,
      });
    }
    materialIds.add(material.id);
  }

  const cutInIds = new Set<string>();
  for (const [index, cutIn] of document.cutIns.entries()) {
    if (cutInIds.has(cutIn.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["cutIns", index, "id"],
        message: `CutIn ID が重複しています: ${cutIn.id}`,
      });
    }
    cutInIds.add(cutIn.id);
  }

  for (const [index, segment] of document.segments.entries()) {
    if (segment.kind === "cut_in" && !cutInIds.has(segment.cutInId)) {
      ctx.addIssue({
        code: "custom",
        path: ["segments", index, "cutInId"],
        message: `CutIn が見つかりません: ${segment.cutInId}`,
      });
    }
  }
  validateSegmentCueReferences(document.segments, cueIds, ctx);

  const validateVisual = (visual: LiveVisualRef, path: (string | number)[]) => {
    if (visual.kind === "card") {
      if (resolveLiveCardState(document.cards, visual) === null) {
        ctx.addIssue({
          code: "custom",
          path,
          message: `カードまたは状態が見つかりません: ${visual.cardId}/${visual.stateId}`,
        });
      }
      return;
    }
    if (!materialIds.has(visual.materialId)) {
      ctx.addIssue({
        code: "custom",
        path,
        message: `素材が見つかりません: ${visual.materialId}`,
      });
    }
  };
  for (const [index, cue] of document.cues.entries()) {
    if (cue.visual !== undefined && cue.visual !== null) {
      validateVisual(cue.visual, ["cues", index, "visual"]);
    }
  }
  for (const [index, segment] of document.segments.entries()) {
    if (segment.kind !== "cut_in" && segment.visual !== undefined) {
      validateVisual(segment.visual, ["segments", index, "visual"]);
    }
  }
}

/**
 * Completeness rules applied when a draft becomes an immutable version.
 * The service also resolves DB references (audio Assets, theme, cast, Live
 * Materials) before calling this function.
 */
export function validateLiveProgramDocumentForVersion(
  document: LiveProgramDocument,
  ctx: RefinementCtx,
): void {
  validateSpineStructure(document.segments, ctx, { requireCues: true });
  if (document.safety === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["safety"],
      message: "版を確定するには safety が必要です。",
    });
  } else {
    const fallbackCue = document.cues.find((cue) => cue.id === document.safety?.fallbackCueId);
    if (fallbackCue === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["safety", "fallbackCueId"],
        message: `退避キューが見つかりません: ${document.safety.fallbackCueId}`,
      });
    }
    validateCueMembership(document.segments, document.cues, document.safety.fallbackCueId, ctx);
  }
  validateRightCast(document.cast.right !== null, document.cues, undefined, ctx);
  validateClosingReserve(
    document.targetDurationMs,
    document.playout.closingReserveMs,
    ctx,
  );
}

/**
 * Asset ids the version service must resolve before freezing a version.
 * The pure document schema cannot see the DB, so callers use this list to
 * validate every image/audio/CutIn reference.
 */
export function collectLiveProgramAssetReferences(document: LiveProgramDocument): {
  cardImageAssetIds: string[];
  audioAssetIds: string[];
  cutInAssetIds: string[];
} {
  return {
    cardImageAssetIds: [
      ...new Set(document.cards.flatMap((card) => liveCardImageAssetIds(card))),
    ],
    audioAssetIds: [
      ...new Set(
        document.cues.flatMap((cue) => (cue.audioAssetId === undefined ? [] : [cue.audioAssetId])),
      ),
    ],
    cutInAssetIds: [...new Set(document.cutIns.map((cutIn) => cutIn.assetId))],
  };
}

export const liveProgramDocumentSchema = z
  .strictObject({
    schemaVersion: z.literal(LIVE_PROGRAM_SCHEMA_VERSION),
    title: z.string().trim().min(1),
    locale: z.literal("ja-JP"),
    targetDurationMs: positiveInt,
    stageTemplate: liveProgramStageTemplateSchema,
    theme: visualThemeRefSchema,
    sourceFormat: liveProgramSourceFormatSchema.optional(),
    cast: liveProgramCastSchema,
    segments: z.array(liveProgramSegmentSchema).default([]),
    cues: z.array(liveProgramCueSchema).default([]),
    cards: z.array(liveCardSchema).default([]),
    materials: z.array(liveProgramMaterialSchema).default([]),
    cutIns: z.array(liveCutInInputSchema).default([]),
    commentPolicy: liveCommentPolicySchema.default(DEFAULT_COMMENT_POLICY),
    safety: liveSafetySchema.optional(),
    playout: livePlayoutSchema.default(DEFAULT_PLAYOUT),
  })
  .superRefine(validateLiveProgramDocumentDraft);
export type LiveProgramDocument = z.infer<typeof liveProgramDocumentSchema>;
