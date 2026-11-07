import { z } from "zod";
import { idSchema, nonNegativeInt, positiveInt, timestampSchema } from "../content/primitives";
import { livePackageRelativePathSchema } from "./paths";
import { liveSideSchema } from "./common";

export const liveSegmentKindSchema = z.enum([
  "opening",
  "script",
  "comment",
  "closing",
]);
export type LiveSegmentKind = z.infer<typeof liveSegmentKindSchema>;

const segmentBase = {
  id: idSchema,
  label: z.string().trim().min(1),
  targetDurationMs: positiveInt,
  material: idSchema.optional(),
};

export const liveCueSegmentSchema = z.strictObject({
  ...segmentBase,
  kind: z.enum(["opening", "script", "closing"]),
  cues: z.array(idSchema).min(1),
});

export const liveCommentSegmentSchema = z.strictObject({
  ...segmentBase,
  kind: z.literal("comment"),
  commentPolicy: z
    .strictObject({
      maxCommentsPerCorner: positiveInt,
      maxHumanPinsPerCorner: nonNegativeInt,
      maxExtraSlots: nonNegativeInt,
    })
    .partial()
    .optional(),
});

export const liveSegmentSchema = z.discriminatedUnion("kind", [
  liveCueSegmentSchema,
  liveCommentSegmentSchema,
]);
export type LiveSegment = z.infer<typeof liveSegmentSchema>;

/**
 * Input-only cue that points at a NarrationSegment. Caption, speech, speaker
 * and audio are resolved from the ScriptVersion at export time.
 */
export const liveScriptCueInputSchema = z.strictObject({
  id: idSchema,
  lineId: idSchema,
  expressionId: idSchema.nullable().optional(),
});
export type LiveScriptCueInput = z.infer<typeof liveScriptCueInputSchema>;

/**
 * Input-only cue for content that does not exist in the ScriptVersion:
 * opening, corrections, fallbacks and ad-libs. Audio can point at a Kakeai
 * Asset; package paths are never accepted as input.
 */
export const liveCueInputSchema = z.strictObject({
  id: idSchema,
  speaker: liveSideSchema,
  caption: z.string().trim().min(1),
  speech: z.string().trim().min(1),
  expression: idSchema,
  audioAssetId: idSchema.optional(),
});
export type LiveCueInput = z.infer<typeof liveCueInputSchema>;

export const liveMaterialFormatSchema = z.enum(["png", "html", "mp4"]);
export type LiveMaterialFormat = z.infer<typeof liveMaterialFormatSchema>;

export const liveMaterialInputSchema = z
  .strictObject({
    id: idSchema,
    sceneId: idSchema,
    focus: z.boolean().default(true),
    format: liveMaterialFormatSchema.default("png"),
    durationMs: nonNegativeInt.default(4000),
  })
  .superRefine((value, ctx) => {
    if (value.format === "mp4" && (value.durationMs < 3000 || value.durationMs > 5000)) {
      ctx.addIssue({
        code: "custom",
        path: ["durationMs"],
        message: "MP4 素材カードの durationMs は 3000〜5000 の範囲で指定してください。",
      });
    }
  });
export type LiveMaterialInput = z.infer<typeof liveMaterialInputSchema>;

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

export const liveShowMetaSchema = z.strictObject({
  title: z.string().trim().min(1),
  /** v1 targets Japanese live shows only. */
  locale: z.literal("ja-JP"),
  targetDurationMs: positiveInt,
  stageTemplate: z.string().trim().min(1),
  /** Package-relative file name; the actual theme comes from ContentDocument. */
  theme: z.literal("theme.css").default("theme.css"),
  characters: z.strictObject({
    left: idSchema,
    right: idSchema.nullable(),
  }),
  speakerSides: z.record(z.string().min(1), liveSideSchema).optional(),
  startAt: timestampSchema.nullable().default(null),
});
export type LiveShowMeta = z.infer<typeof liveShowMetaSchema>;

export const liveCommentSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("youtube") }),
  z.strictObject({ kind: z.literal("fixture") }),
]);
export type LiveCommentSource = z.infer<typeof liveCommentSourceSchema>;

export const liveTestConfigSchema = z.strictObject({
  fixture: livePackageRelativePathSchema,
});
export type LiveTestConfig = z.infer<typeof liveTestConfigSchema>;

/**
 * The input Show Profile. Normal cues reference ScriptVersion lines; only
 * live-specific content carries caption/speech directly.
 */
export const liveShowProfileSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    show: liveShowMetaSchema,
    commentSource: liveCommentSourceSchema,
    segments: z.array(liveSegmentSchema).min(1),
    scriptCues: z.array(liveScriptCueInputSchema).default([]),
    liveCues: z.array(liveCueInputSchema).default([]),
    materials: z.array(liveMaterialInputSchema).default([]),
    commentPolicy: liveCommentPolicySchema.default({
      mode: "corner",
      freshnessMin: 10,
      maxCommentsPerCorner: 4,
      maxHumanPinsPerCorner: 4,
      maxExtraSlots: 2,
      allowImmediateInterrupt: false,
      skipWhenEmpty: true,
    }),
    safety: liveSafetySchema,
    playout: livePlayoutSchema.default({
      minBufferMs: 10000,
      maxThinkingMs: 2000,
      closingReserveMs: 120000,
      noApprovalDelay: true,
    }),
    test: liveTestConfigSchema.optional(),
  })
  .superRefine((profile, ctx) => {
    if (profile.segments[0]?.kind !== "opening") {
      ctx.addIssue({
        code: "custom",
        path: ["segments", 0, "kind"],
        message: "segments の先頭は opening にしてください。",
      });
    }
    if (profile.segments[profile.segments.length - 1]?.kind !== "closing") {
      ctx.addIssue({
        code: "custom",
        path: ["segments", profile.segments.length - 1, "kind"],
        message: "segments の末尾は closing にしてください。",
      });
    }
    if (!profile.segments.some((segment) => segment.kind === "script")) {
      ctx.addIssue({
        code: "custom",
        path: ["segments"],
        message: "script セグメントを 1 つ以上含めてください。",
      });
    }

    const segmentIds = new Set<string>();
    for (const segment of profile.segments) {
      if (segmentIds.has(segment.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["segments"],
          message: `セグメント ID が重複しています: ${segment.id}`,
        });
      }
      segmentIds.add(segment.id);
    }

    const cueIds = new Set<string>();
    for (const cue of profile.scriptCues) {
      if (cueIds.has(cue.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["scriptCues"],
          message: `キュー ID が重複しています: ${cue.id}`,
        });
      }
      cueIds.add(cue.id);
    }
    for (const cue of profile.liveCues) {
      if (cueIds.has(cue.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["liveCues"],
          message: `キュー ID が重複しています: ${cue.id}`,
        });
      }
      cueIds.add(cue.id);
    }

    const lineIds = new Set<string>();
    for (const cue of profile.scriptCues) {
      if (lineIds.has(cue.lineId)) {
        ctx.addIssue({
          code: "custom",
          path: ["scriptCues"],
          message: `lineId が重複しています: ${cue.lineId}`,
        });
      }
      lineIds.add(cue.lineId);
    }

    const materialIds = new Set<string>();
    for (const material of profile.materials) {
      if (materialIds.has(material.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["materials"],
          message: `素材 ID が重複しています: ${material.id}`,
        });
      }
      materialIds.add(material.id);
    }

    for (const [index, segment] of profile.segments.entries()) {
      if ("cues" in segment) {
        for (const cueId of segment.cues) {
          if (!cueIds.has(cueId)) {
            ctx.addIssue({
              code: "custom",
              path: ["segments", index, "cues"],
              message: `キューが見つかりません: ${cueId}`,
            });
          }
        }
      }
      if (segment.material !== undefined && !materialIds.has(segment.material)) {
        ctx.addIssue({
          code: "custom",
          path: ["segments", index, "material"],
          message: `素材が見つかりません: ${segment.material}`,
        });
      }
    }

    if (!cueIds.has(profile.safety.fallbackCueId)) {
      ctx.addIssue({
        code: "custom",
        path: ["safety", "fallbackCueId"],
        message: `退避キューが見つかりません: ${profile.safety.fallbackCueId}`,
      });
    }

    if (profile.commentSource.kind === "fixture" && profile.test === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["commentSource", "kind"],
        message: "fixture のコメントソースには test.fixture が必要です。",
      });
    }

    if (
      profile.show.characters.right !== null &&
      profile.show.characters.right === profile.show.characters.left
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["show", "characters", "right"],
        message: "左右に同じキャラクターは指定できません。",
      });
    }
  });
export type LiveShowProfile = z.infer<typeof liveShowProfileSchema>;
