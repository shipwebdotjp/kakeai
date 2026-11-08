import { z } from "zod";
import { idSchema, nonNegativeInt, positiveInt, timestampSchema } from "../content/primitives";
import { liveSideSchema } from "./common";
import { liveAudioUrlSchema, livePackageRelativePathSchema } from "./paths";

export const stagePhaseSchema = z.enum([
  "pre_show",
  "opening",
  "script",
  "comment",
  "closing",
  "cut_in",
  "post_show",
  "paused",
  "safe_mode",
  "error",
]);
export type StagePhase = z.infer<typeof stagePhaseSchema>;

export const stageStatusSchema = z.enum(["idle", "thinking", "speaking"]);
export type StageStatus = z.infer<typeof stageStatusSchema>;

export const stageLeaseRoleSchema = z.enum(["program", "preview"]);
export type StageLeaseRole = z.infer<typeof stageLeaseRoleSchema>;

export const stageLeaseSchema = z.strictObject({
  leaseId: idSchema,
  runId: idSchema,
  sessionId: idSchema,
  role: stageLeaseRoleSchema,
  expiresAt: timestampSchema,
});
export type StageLease = z.infer<typeof stageLeaseSchema>;

export const stageCharacterStateSchema = z.strictObject({
  expression: idSchema,
  speaking: z.boolean(),
});
export type StageCharacterState = z.infer<typeof stageCharacterStateSchema>;

export const stageCaptionSchema = z.strictObject({
  speaker: liveSideSchema,
  text: z.string().trim().min(1),
});
export type StageCaption = z.infer<typeof stageCaptionSchema>;

export const stageMaterialStateSchema = z.strictObject({
  id: idSchema,
  focus: z.boolean(),
});
export type StageMaterialState = z.infer<typeof stageMaterialStateSchema>;

export const stageCommentStateSchema = z.strictObject({
  commentId: idSchema,
  author: z.string().trim().min(1).max(200),
  /** Safe display text prepared by the server; never the raw comment body. */
  text: z.string().trim().min(1).max(500),
  state: z.enum(["reading", "responding"]),
});
export type StageCommentState = z.infer<typeof stageCommentStateSchema>;

export const stagePlaybackSchema = z.strictObject({
  cueId: idSchema,
  attempt: positiveInt,
  /**
   * Server-wide monotonic playback instruction. A stage echoes the value it
   * received; resume, skip and reconnect each issue a new sequence.
   */
  sequence: nonNegativeInt,
  startedAt: timestampSchema,
  audioUrl: liveAudioUrlSchema,
});
export type StagePlayback = z.infer<typeof stagePlaybackSchema>;

/**
 * CutIn playback is reported separately from `playback`: its audio never joins
 * the cue attempt/sequence contract. `startedAt` lets a reconnecting program
 * stage seek to the current position.
 */
export const stageCutInSchema = z.strictObject({
  cutInId: idSchema,
  segmentId: idSchema,
  label: z.string().trim().min(1),
  file: livePackageRelativePathSchema,
  durationMs: positiveInt,
  hasAudio: z.boolean(),
  attempt: positiveInt,
  sequence: nonNegativeInt,
  startedAt: timestampSchema,
});
export type StageCutIn = z.infer<typeof stageCutInSchema>;

export const stageClockSchema = z.strictObject({
  elapsedMs: nonNegativeInt,
  remainingMs: nonNegativeInt,
});
export type StageClock = z.infer<typeof stageClockSchema>;

export const stageShowSchema = z.strictObject({
  title: z.string().trim().min(1),
  startAt: timestampSchema.nullable(),
});
export type StageShow = z.infer<typeof stageShowSchema>;

export const stageSegmentRefSchema = z.strictObject({
  id: idSchema,
  label: z.string().trim().min(1),
});
export type StageSegmentRef = z.infer<typeof stageSegmentRefSchema>;

export const stageStateSchema = z.strictObject({
  phase: stagePhaseSchema,
  show: stageShowSchema,
  segment: stageSegmentRefSchema.nullable(),
  characters: z.strictObject({
    left: stageCharacterStateSchema.nullable(),
    right: stageCharacterStateSchema.nullable(),
  }),
  caption: stageCaptionSchema.nullable(),
  material: stageMaterialStateSchema.nullable(),
  comment: stageCommentStateSchema.nullable(),
  status: stageStatusSchema,
  playback: stagePlaybackSchema.nullable(),
  /** Non-null only while a CutIn plays; older servers omit it and parse as null. */
  cutIn: stageCutInSchema.nullable().default(null),
  clock: stageClockSchema,
});
export type StageState = z.infer<typeof stageStateSchema>;

export const stageEventKindSchema = z.enum([
  "stage_ready",
  "audio_ended",
  "audio_error",
  "cut_in_ended",
  "cut_in_error",
  "stage_heartbeat",
]);
export type StageEventKind = z.infer<typeof stageEventKindSchema>;

export const stageEventSchema = z
  .strictObject({
    kind: stageEventKindSchema,
    runId: idSchema,
    sessionId: idSchema,
    cueId: idSchema.nullable(),
    /** CutIn occurrence identity; omitted by audio and heartbeat events. */
    cutInId: idSchema.nullable().optional(),
    segmentId: idSchema.nullable().optional(),
    attempt: nonNegativeInt,
    /** Playback sequence echoed from `StageState.playback`; only an exact match is accepted. */
    sequence: nonNegativeInt,
    positionMs: nonNegativeInt.optional(),
    error: z.string().optional(),
  })
  .superRefine((event, ctx) => {
    if (event.kind !== "cut_in_ended" && event.kind !== "cut_in_error") {
      return;
    }
    if (typeof event.cutInId !== "string") {
      ctx.addIssue({
        code: "custom",
        message: "CutIn イベントには cutInId が必要です。",
        path: ["cutInId"],
      });
    }
    if (typeof event.segmentId !== "string") {
      ctx.addIssue({
        code: "custom",
        message: "CutIn イベントには segmentId が必要です。",
        path: ["segmentId"],
      });
    }
  });
export type StageEvent = z.infer<typeof stageEventSchema>;
