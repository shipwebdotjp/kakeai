import { z } from "zod";
import { idSchema, nonNegativeInt, positiveInt } from "../content/primitives";
import { MAX_TTS_SPEED_SCALE, MIN_TTS_SPEED_SCALE } from "../requests";
import { voiceAdapterIdSchema, voiceIdSchema } from "../voice-profile";
import { liveCueOriginSchema, liveCueSourceSchema, liveCueStatusSchema, liveSideSchema } from "./common";
import {
  liveCommentPolicySchema,
  livePackageCutInSegmentSchema,
  livePackageShowMetaSchema,
  livePlayoutSchema,
  liveSafetySchema,
  type LivePackageCutInSegment,
} from "./package-policy";
import {
  liveCardAssetSchema,
  liveCardImageAssetIds,
  liveCardSchema,
  liveVisualRefSchema,
  resolveLiveCardState,
  type LiveVisualRef,
} from "./card";
import { liveAudioUrlSchema, livePackageRelativePathSchema } from "./paths";
import { validateSegmentCueReferences } from "./segment-references";
import {
  validateClosingReserve,
  validateFallbackAndOrphans,
  validateRightCast,
  validateSpineStructure,
} from "./spine-validation";

export const liveVoiceSettingsSchema = z.record(
  z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .refine((key) => !["__proto__", "constructor", "prototype"].includes(key)),
  z.unknown(),
);
export type LiveVoiceSettings = z.infer<typeof liveVoiceSettingsSchema>;

const segmentBaseShape = {
  id: idSchema,
  label: z.string().trim().min(1),
  targetDurationMs: positiveInt,
  visual: liveVisualRefSchema.optional(),
};

export const livePackageCueSegmentSchema = z.strictObject({
  ...segmentBaseShape,
  kind: z.enum(["opening", "script", "closing"]),
  cues: z.array(idSchema).min(1),
});

export const livePackageCommentSegmentSchema = z.strictObject({
  ...segmentBaseShape,
  kind: z.literal("comment"),
  commentPolicy: liveCommentPolicySchema.partial().optional(),
});

/**
 * A package segment carries a default centre visual. CutIn segments never do:
 * they replace the whole stage and do not compose with the centre slot.
 */
export const livePackageSegmentSchema = z.discriminatedUnion("kind", [
  livePackageCueSegmentSchema,
  livePackageCommentSegmentSchema,
  livePackageCutInSegmentSchema,
]);
export type LivePackageSegment = z.infer<typeof livePackageSegmentSchema>;

/** The runtime stage works with loaded package segments. */
export type LiveSegment = LivePackageSegment;
export type { LivePackageCutInSegment };

export const liveSpeakerVoiceSchema = z.strictObject({
  adapterId: voiceAdapterIdSchema,
  voiceId: voiceIdSchema,
  speedScale: z.number().finite().min(MIN_TTS_SPEED_SCALE).max(MAX_TTS_SPEED_SCALE),
  settings: liveVoiceSettingsSchema,
  refAudio: livePackageRelativePathSchema.optional(),
});
export type LiveSpeakerVoice = z.infer<typeof liveSpeakerVoiceSchema>;

export const liveSpeakerSchema = z.strictObject({
  id: idSchema,
  name: z.string().trim().min(1),
  side: liveSideSchema,
  characterId: idSchema.nullable(),
  voice: liveSpeakerVoiceSchema,
});
export type LiveSpeaker = z.infer<typeof liveSpeakerSchema>;

/**
 * A prepared cue in a v2 package. Every cue comes from a Live Program, so the
 * origin is always `live`; there is no ScriptVersion-derived cue.
 */
export const preparedCueSchema = z.strictObject({
  id: idSchema,
  origin: liveCueOriginSchema,
  speaker: liveSideSchema,
  caption: z.string().trim().min(1),
  speech: z.string().trim().min(1),
  expression: idSchema,
  /** null hides the centre slot; omitted inherits the segment default. */
  visual: liveVisualRefSchema.nullable().optional(),
  audio: livePackageRelativePathSchema,
  durationMs: positiveInt,
});
export type PreparedCue = z.infer<typeof preparedCueSchema>;

export const liveCueSchema = z.strictObject({
  id: idSchema,
  origin: liveCueOriginSchema,
  speaker: liveSideSchema,
  caption: z.string().trim().min(1),
  speech: z.string().trim().min(1),
  expression: idSchema,
  /** null hides the centre slot; omitted inherits the segment default. */
  visual: liveVisualRefSchema.nullable().optional(),
  /** Package-relative for prepared cues, `run:generated/...` for generated speech. */
  audio: liveAudioUrlSchema.nullable(),
  durationMs: nonNegativeInt.nullable(),
  source: liveCueSourceSchema,
  status: liveCueStatusSchema,
  commentId: idSchema.nullable(),
});
export type LiveCue = z.infer<typeof liveCueSchema>;

export const liveMaterialKindSchema = z.enum(["image", "video", "html"]);
export type LiveMaterialKind = z.infer<typeof liveMaterialKindSchema>;

export const materialCardSchema = z.strictObject({
  id: idSchema,
  kind: liveMaterialKindSchema,
  file: livePackageRelativePathSchema,
  hasAudio: z.literal(false),
  focus: z.boolean(),
  width: positiveInt,
  height: positiveInt,
  durationMs: positiveInt.optional(),
});
export type MaterialCard = z.infer<typeof materialCardSchema>;

/**
 * A resolved CutIn in an exported package. Unlike material cards, CutIn video
 * may carry audio; all media facts come from probing the packaged MP4.
 */
export const livePackageCutInSchema = z.strictObject({
  id: idSchema,
  file: livePackageRelativePathSchema,
  durationMs: positiveInt,
  hasAudio: z.boolean(),
  width: positiveInt,
  height: positiveInt,
});
export type LivePackageCutIn = z.infer<typeof livePackageCutInSchema>;

export const livePackageShowV2Schema = z
  .strictObject({
    schemaVersion: z.literal(2),
    show: livePackageShowMetaSchema,
    segments: z.array(livePackageSegmentSchema).min(1),
    cues: z.array(preparedCueSchema),
    materials: z.array(materialCardSchema).default([]),
    cards: z.array(liveCardSchema).default([]),
    cardAssets: z.array(liveCardAssetSchema).default([]),
    cutIns: z.array(livePackageCutInSchema).default([]),
    speakers: z.array(liveSpeakerSchema),
    commentPolicy: liveCommentPolicySchema,
    safety: liveSafetySchema,
    playout: livePlayoutSchema,
  })
  .superRefine((show, ctx) => {
    const cueIds = new Set<string>();
    for (const cue of show.cues) {
      if (cueIds.has(cue.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["cues"],
          message: `キュー ID が重複しています: ${cue.id}`,
        });
      }
      cueIds.add(cue.id);
    }
    validateSegmentCueReferences(show.segments, cueIds, ctx);

    const materialIds = new Set<string>();
    for (const material of show.materials) {
      if (materialIds.has(material.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["materials"],
          message: `素材 ID が重複しています: ${material.id}`,
        });
      }
      materialIds.add(material.id);
    }

    const cutInIds = new Set<string>();
    for (const cutIn of show.cutIns) {
      if (cutInIds.has(cutIn.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["cutIns"],
          message: `CutIn ID が重複しています: ${cutIn.id}`,
        });
      }
      cutInIds.add(cutIn.id);
    }
    for (const [index, segment] of show.segments.entries()) {
      if (segment.kind === "cut_in" && !cutInIds.has(segment.cutInId)) {
        ctx.addIssue({
          code: "custom",
          path: ["segments", index, "cutInId"],
          message: `CutIn が見つかりません: ${segment.cutInId}`,
        });
      }
    }

    const cardIds = new Set<string>();
    for (const card of show.cards) {
      if (cardIds.has(card.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["cards"],
          message: `カード ID が重複しています: ${card.id}`,
        });
      }
      cardIds.add(card.id);
    }
    const cardAssetIds = new Set<string>();
    for (const asset of show.cardAssets) {
      if (cardAssetIds.has(asset.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["cardAssets"],
          message: `カード画像 Asset ID が重複しています: ${asset.id}`,
        });
      }
      cardAssetIds.add(asset.id);
    }
    for (const [cardIndex, card] of show.cards.entries()) {
      for (const assetId of liveCardImageAssetIds(card)) {
        if (!cardAssetIds.has(assetId)) {
          ctx.addIssue({
            code: "custom",
            path: ["cards", cardIndex, "states"],
            message: `カード画像 Asset が見つかりません: ${assetId}`,
          });
        }
      }
    }

    const validateVisual = (visual: LiveVisualRef, path: (string | number)[]): void => {
      if (visual.kind === "card") {
        if (resolveLiveCardState(show.cards, visual) === null) {
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
    for (const [index, cue] of show.cues.entries()) {
      if (cue.visual !== undefined && cue.visual !== null) {
        validateVisual(cue.visual, ["cues", index, "visual"]);
      }
    }
    for (const [index, segment] of show.segments.entries()) {
      if (segment.kind !== "cut_in" && segment.visual !== undefined) {
        validateVisual(segment.visual, ["segments", index, "visual"]);
      }
    }

    if (!cueIds.has(show.safety.fallbackCueId)) {
      ctx.addIssue({
        code: "custom",
        path: ["safety", "fallbackCueId"],
        message: `退避キューが見つかりません: ${show.safety.fallbackCueId}`,
      });
    }

    if (show.show.stageTemplate !== "news-desk") {
      ctx.addIssue({
        code: "custom",
        path: ["show", "stageTemplate"],
        message: "v2 のライブステージは news-desk だけに対応しています。",
      });
    }
    validateSpineStructure(show.segments, ctx, { requireCues: true });
    validateFallbackAndOrphans(show.segments, show.cues, show.safety.fallbackCueId, ctx);
    validateClosingReserve(show.show.targetDurationMs, show.playout.closingReserveMs, ctx);
    validateRightCast(show.show.characters.right !== null, show.cues, show.speakers, ctx);

    const sides = new Set<string>();
    const speakerIds = new Set<string>();
    for (const speaker of show.speakers) {
      if (speakerIds.has(speaker.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["speakers"],
          message: `話者 ID が重複しています: ${speaker.id}`,
        });
      }
      speakerIds.add(speaker.id);
      if (sides.has(speaker.side)) {
        ctx.addIssue({
          code: "custom",
          path: ["speakers"],
          message: `同じ side に複数の話者があります: ${speaker.side}`,
        });
      }
      sides.add(speaker.side);
    }
  });
export type LivePackageShow = z.infer<typeof livePackageShowV2Schema>;

/** The only supported package show contract. v1 is rejected at load time. */
export const livePackageShowSchema = livePackageShowV2Schema;
