import { z, type RefinementCtx } from "zod";
import { idSchema, positiveInt } from "../content/primitives";
import { visualThemeRefSchema } from "../content/theme";
import { liveSideSchema } from "./common";
import {
  liveCardSchema,
  resolveLiveCardState,
} from "./card";
import {
  liveCommentPolicySchema,
  livePlayoutSchema,
  liveSafetySchema,
} from "./package-policy";
import {
  LIVE_PROGRAM_DEFAULT_COMMENT_POLICY,
  LIVE_PROGRAM_DEFAULT_PLAYOUT,
  liveProgramCastSchema,
  liveProgramStageTemplateSchema,
} from "./program";
import {
  validateClosingReserve,
  validateRightCast,
  validateSpineStructure,
} from "./spine-validation";

export const LIVE_FORMAT_SCHEMA_VERSION = 1 as const;

/**
 * Formats may only reference template cards. Materials and CutIn ids belong
 * to an individual Live Program, so they have no representation here.
 */
export const liveFormatVisualRefSchema = z.strictObject({
  kind: z.literal("card"),
  cardId: idSchema,
  stateId: idSchema,
});
export type LiveFormatVisualRef = z.infer<typeof liveFormatVisualRefSchema>;

const formatSegmentBase = {
  id: idSchema,
  label: z.string().trim().min(1),
  targetDurationMs: positiveInt,
  visual: liveFormatVisualRefSchema.optional(),
};

export const liveFormatCueSegmentTemplateSchema = z.strictObject({
  ...formatSegmentBase,
  kind: z.enum(["opening", "script", "closing"]),
});
export type LiveFormatCueSegmentTemplate = z.infer<
  typeof liveFormatCueSegmentTemplateSchema
>;

export const liveFormatCommentSegmentTemplateSchema = z.strictObject({
  ...formatSegmentBase,
  kind: z.literal("comment"),
  commentPolicy: liveCommentPolicySchema.partial().optional(),
});
export type LiveFormatCommentSegmentTemplate = z.infer<
  typeof liveFormatCommentSegmentTemplateSchema
>;

/**
 * The CutIn placeholder carries only a label and target duration. A CutIn
 * asset cannot be part of a reusable format, so program creation omits the
 * placeholder until an editor attaches a concrete CutIn.
 */
export const liveFormatCutInSegmentTemplateSchema = z.strictObject({
  id: idSchema,
  kind: z.literal("cut_in"),
  label: z.string().trim().min(1),
  targetDurationMs: positiveInt.optional(),
});
export type LiveFormatCutInSegmentTemplate = z.infer<
  typeof liveFormatCutInSegmentTemplateSchema
>;

export const liveFormatSegmentTemplateSchema = z.discriminatedUnion("kind", [
  liveFormatCueSegmentTemplateSchema,
  liveFormatCommentSegmentTemplateSchema,
  liveFormatCutInSegmentTemplateSchema,
]);
export type LiveFormatSegmentTemplate = z.infer<typeof liveFormatSegmentTemplateSchema>;

export const liveFormatCueRoleSchema = z.enum(["opening", "closing", "fallback"]);
export type LiveFormatCueRole = z.infer<typeof liveFormatCueRoleSchema>;

/**
 * Generic template cues only. Formats never own episode bodies or audio
 * Assets; a program copies these texts and may rewrite them freely.
 */
export const liveFormatCueTemplateSchema = z.strictObject({
  id: idSchema,
  role: liveFormatCueRoleSchema,
  speaker: liveSideSchema,
  caption: z.string().trim().min(1),
  speech: z.string().trim().min(1),
  expression: idSchema,
});
export type LiveFormatCueTemplate = z.infer<typeof liveFormatCueTemplateSchema>;

function validateFormatDocument(
  document: LiveFormatDocumentV1,
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
  const roles = new Set<string>();
  for (const [index, cue] of document.cues.entries()) {
    if (cueIds.has(cue.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["cues", index, "id"],
        message: `キュー ID が重複しています: ${cue.id}`,
      });
    }
    cueIds.add(cue.id);
    if (roles.has(cue.role)) {
      ctx.addIssue({
        code: "custom",
        path: ["cues", index, "role"],
        message: `役割 ${cue.role} のキューは1つだけにしてください。`,
      });
    }
    roles.add(cue.role);
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

  validateSpineStructure(document.segments, ctx, { requireCues: false });
  for (const role of ["opening", "closing"] as const) {
    if (!document.cues.some((cue) => cue.role === role)) {
      ctx.addIssue({
        code: "custom",
        path: ["cues"],
        message: `${role} の汎用キューを1つ用意してください。`,
      });
    }
  }
  const fallbackCue = document.cues.find(
    (cue) => cue.id === document.safety.fallbackCueId,
  );
  if (fallbackCue === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["safety", "fallbackCueId"],
      message: `退避キューが見つかりません: ${document.safety.fallbackCueId}`,
    });
  } else if (fallbackCue.role !== "fallback") {
    ctx.addIssue({
      code: "custom",
      path: ["safety", "fallbackCueId"],
      message: "safety.fallbackCueId は role: fallback のキューを指してください。",
    });
  }
  validateRightCast(document.cast.right !== null, document.cues, undefined, ctx);
  validateClosingReserve(
    document.targetDurationMs,
    document.playout.closingReserveMs,
    ctx,
  );

  for (const [index, segment] of document.segments.entries()) {
    if (segment.kind === "cut_in" || segment.visual === undefined) {
      continue;
    }
    if (resolveLiveCardState(document.cards, segment.visual) === null) {
      ctx.addIssue({
        code: "custom",
        path: ["segments", index, "visual"],
        message: `カードまたは状態が見つかりません: ${segment.visual.cardId}/${segment.visual.stateId}`,
      });
    }
  }
}

/**
 * Reusable Live Program preset. The schema owns only generic template cues,
 * cards and spine targets; materials, CutIns and episode text are rejected by
 * the strict objects.
 */
export const liveFormatDocumentV1Schema = z
  .strictObject({
    schemaVersion: z.literal(LIVE_FORMAT_SCHEMA_VERSION),
    name: z.string().trim().min(1),
    title: z.string().trim().min(1),
    locale: z.literal("ja-JP"),
    targetDurationMs: positiveInt,
    stageTemplate: liveProgramStageTemplateSchema,
    theme: visualThemeRefSchema,
    cast: liveProgramCastSchema,
    segments: z.array(liveFormatSegmentTemplateSchema).min(1),
    cues: z.array(liveFormatCueTemplateSchema).default([]),
    cards: z.array(liveCardSchema).default([]),
    commentPolicy: liveCommentPolicySchema.default(LIVE_PROGRAM_DEFAULT_COMMENT_POLICY),
    safety: liveSafetySchema,
    playout: livePlayoutSchema.default(LIVE_PROGRAM_DEFAULT_PLAYOUT),
  })
  .superRefine(validateFormatDocument);
export type LiveFormatDocumentV1 = z.infer<typeof liveFormatDocumentV1Schema>;
export type LiveFormatDocument = LiveFormatDocumentV1;

export const liveFormatDocumentSchema = liveFormatDocumentV1Schema;
