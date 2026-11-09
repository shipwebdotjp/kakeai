import { z } from "zod";
import { idSchema, nonNegativeInt, positiveInt } from "../content/primitives";

export const liveSegmentKindSchema = z.enum([
  "opening",
  "script",
  "comment",
  "closing",
  "cut_in",
]);
export type LiveSegmentKind = z.infer<typeof liveSegmentKindSchema>;

export const liveCommentPolicySchema = z.strictObject({
  mode: z.literal("corner").default("corner"),
  freshnessMin: nonNegativeInt.default(10),
  maxCommentsPerCorner: positiveInt.default(4),
  maxHumanPinsPerCorner: nonNegativeInt.default(4),
  maxExtraSlots: nonNegativeInt.default(2),
  allowImmediateInterrupt: z.literal(false).default(false),
  skipWhenEmpty: z.boolean().default(true),
});
export type LiveCommentPolicy = z.infer<typeof liveCommentPolicySchema>;

export const liveSafetySchema = z.strictObject({
  blockedTopics: z.array(z.string().trim().min(1)).default([]),
  persona: z.string().trim().min(1),
  maxResponseChars: positiveInt,
  maxResponseCues: positiveInt,
  fallbackCueId: idSchema,
});
export type LiveSafety = z.infer<typeof liveSafetySchema>;

export const livePlayoutSchema = z.strictObject({
  minBufferMs: nonNegativeInt.default(10000),
  maxThinkingMs: nonNegativeInt.default(2000),
  closingReserveMs: nonNegativeInt.default(120000),
  noApprovalDelay: z.literal(true).default(true),
});
export type LivePlayout = z.infer<typeof livePlayoutSchema>;

/** v2 package show metadata. Comment source, fixture and startAt live in the Live Run. */
export const livePackageShowMetaSchema = z.strictObject({
  title: z.string().trim().min(1),
  locale: z.literal("ja-JP"),
  targetDurationMs: positiveInt,
  stageTemplate: z.string().trim().min(1),
  /** Package-relative file name; the actual theme comes from the package build. */
  theme: z.literal("theme.css").default("theme.css"),
  characters: z.strictObject({
    left: idSchema,
    right: idSchema.nullable(),
  }),
});
export type LivePackageShowMeta = z.infer<typeof livePackageShowMetaSchema>;


/** A segment on the visible stage. CutIn segments replace the whole stage. */
export const livePackageCutInSegmentSchema = z.strictObject({
  id: idSchema,
  label: z.string().trim().min(1),
  kind: z.literal("cut_in"),
  cutInId: idSchema,
});
export type LivePackageCutInSegment = z.infer<typeof livePackageCutInSegmentSchema>;
