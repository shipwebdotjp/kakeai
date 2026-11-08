import { z } from "zod";
import { idSchema, nonNegativeInt, positiveInt } from "../content/primitives";
import { MAX_TTS_SPEED_SCALE, MIN_TTS_SPEED_SCALE } from "../requests";
import { voiceAdapterIdSchema, voiceIdSchema } from "../voice-profile";
import {
  liveCueOriginSchema,
  liveCueSourceSchema,
  liveCueStatusSchema,
  liveSideSchema,
} from "./common";
import {
  liveCommentPolicySchema,
  liveCommentSourceSchema,
  livePlayoutSchema,
  liveSafetySchema,
  liveSegmentSchema,
  liveShowMetaSchema,
  liveTestConfigSchema,
} from "./profile";
import { liveAudioUrlSchema, livePackageRelativePathSchema } from "./paths";
import { validateSegmentCueReferences } from "./segment-references";

export const liveVoiceSettingsSchema = z.record(
  z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .refine((key) => !["__proto__", "constructor", "prototype"].includes(key)),
  z.unknown(),
);
export type LiveVoiceSettings = z.infer<typeof liveVoiceSettingsSchema>;

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

export const preparedCueSchema = z
  .strictObject({
    id: idSchema,
    origin: liveCueOriginSchema,
    sourceLineId: idSchema.optional(),
    speaker: liveSideSchema,
    caption: z.string().trim().min(1),
    speech: z.string().trim().min(1),
    expression: idSchema,
    /** Raw per-cue material reference; runtime resolves the segment default. */
    materialId: idSchema.nullable().optional(),
    audio: livePackageRelativePathSchema,
    durationMs: positiveInt,
  })
  .superRefine((cue, ctx) => {
    if (cue.origin === "script" && cue.sourceLineId === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceLineId"],
        message: "origin: script のキューは sourceLineId を必須とします。",
      });
    }
    if (cue.origin === "live" && cue.sourceLineId !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceLineId"],
        message: "origin: live のキューは sourceLineId を持ちません。",
      });
    }
  });
export type PreparedCue = z.infer<typeof preparedCueSchema>;

export const liveCueSchema = z
  .strictObject({
    id: idSchema,
    origin: liveCueOriginSchema,
    sourceLineId: idSchema.optional(),
    speaker: liveSideSchema,
    caption: z.string().trim().min(1),
    speech: z.string().trim().min(1),
    expression: idSchema,
    /** Raw per-cue material reference; runtime resolves the segment default. */
    materialId: idSchema.nullable().optional(),
    /** Package-relative for prepared cues, `run:generated/...` for generated speech. */
    audio: liveAudioUrlSchema.nullable(),
    durationMs: nonNegativeInt.nullable(),
    source: liveCueSourceSchema,
    status: liveCueStatusSchema,
    commentId: idSchema.nullable(),
  })
  .superRefine((cue, ctx) => {
    if (cue.origin === "script" && cue.sourceLineId === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceLineId"],
        message: "origin: script のキューは sourceLineId を必須とします。",
      });
    }
    if (cue.origin === "live" && cue.sourceLineId !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceLineId"],
        message: "origin: live のキューは sourceLineId を持ちません。",
      });
    }
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

export const livePackageShowSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    show: liveShowMetaSchema,
    commentSource: liveCommentSourceSchema,
    segments: z.array(liveSegmentSchema).min(1),
    cues: z.array(preparedCueSchema),
    materials: z.array(materialCardSchema),
    cutIns: z.array(livePackageCutInSchema).default([]),
    speakers: z.array(liveSpeakerSchema),
    commentPolicy: liveCommentPolicySchema,
    safety: liveSafetySchema,
    playout: livePlayoutSchema,
    test: liveTestConfigSchema.optional(),
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
    for (const [index, cue] of show.cues.entries()) {
      if (
        cue.materialId !== undefined &&
        cue.materialId !== null &&
        !materialIds.has(cue.materialId)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["cues", index, "materialId"],
          message: `素材が見つかりません: ${cue.materialId}`,
        });
      }
    }
    for (const [index, segment] of show.segments.entries()) {
      if (
        segment.kind !== "cut_in" &&
        segment.material !== undefined &&
        !materialIds.has(segment.material)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["segments", index, "material"],
          message: `素材が見つかりません: ${segment.material}`,
        });
      }
    }
    if (!cueIds.has(show.safety.fallbackCueId)) {
      ctx.addIssue({
        code: "custom",
        path: ["safety", "fallbackCueId"],
        message: `退避キューが見つかりません: ${show.safety.fallbackCueId}`,
      });
    }
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
export type LivePackageShow = z.infer<typeof livePackageShowSchema>;
