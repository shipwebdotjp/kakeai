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

/**
 * The single centre-slot visual. A card state and an imported material are
 * mutually exclusive by construction; `sequence` is the server-wide visual
 * sequence that lets a stage ignore late, older snapshots.
 */
export const stageVisualStateSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("card"),
    cardId: idSchema,
    stateId: idSchema,
    sequence: nonNegativeInt,
  }),
  z.strictObject({
    kind: z.literal("material"),
    materialId: idSchema,
    focus: z.boolean(),
    sequence: nonNegativeInt,
  }),
]);
export type StageVisualState = z.infer<typeof stageVisualStateSchema>;

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
  visual: stageVisualStateSchema.nullable(),
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
  "card_error",
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
    /** Card display failure identity; omitted by non-card events. */
    cardId: idSchema.nullable().optional(),
    stateId: idSchema.nullable().optional(),
    attempt: nonNegativeInt,
    /**
     * Playback sequence echoed from `StageState.playback`; only an exact match
     * is accepted. A `card_error` carries the visual sequence instead.
     *
     * Intentional overload: `card_error` is the only visual event, and the
     * server validates it by `cardId`/`stateId` plus this visual sequence. A
     * dedicated `visualSequence` field would change the stage producer and is
     * deferred until a second visual event needs ordering.
     */
    sequence: nonNegativeInt,
    positionMs: nonNegativeInt.optional(),
    error: z.string().optional(),
  })
  .superRefine((event, ctx) => {
    const hasCutIn = event.cutInId != null;
    const hasSegment = event.segmentId != null;
    const hasCard = event.cardId != null;
    const hasState = event.stateId != null;
    const forbid = (
      present: boolean,
      field: "cutInId" | "segmentId" | "cardId" | "stateId",
      message: string,
    ): void => {
      if (present) {
        ctx.addIssue({ code: "custom", message, path: [field] });
      }
    };

    if (event.kind === "cut_in_ended" || event.kind === "cut_in_error") {
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
      forbid(
        hasCard,
        "cardId",
        "CutIn イベントに cardId / stateId は指定できません。",
      );
      forbid(
        hasState,
        "stateId",
        "CutIn イベントに cardId / stateId は指定できません。",
      );
      return;
    }
    if (event.kind === "card_error") {
      if (typeof event.cardId !== "string") {
        ctx.addIssue({
          code: "custom",
          message: "card_error イベントには cardId が必要です。",
          path: ["cardId"],
        });
      }
      if (typeof event.stateId !== "string") {
        ctx.addIssue({
          code: "custom",
          message: "card_error イベントには stateId が必要です。",
          path: ["stateId"],
        });
      }
      forbid(
        hasCutIn,
        "cutInId",
        "card_error イベントに cutInId / segmentId は指定できません。",
      );
      forbid(
        hasSegment,
        "segmentId",
        "card_error イベントに cutInId / segmentId は指定できません。",
      );
      return;
    }
    // audio_ended / audio_error / stage_ready / stage_heartbeat carry no
    // specialized identity beyond the cue playback contract.
    forbid(
      hasCutIn,
      "cutInId",
      "このイベントに cutInId / segmentId / cardId / stateId は指定できません。",
    );
    forbid(
      hasSegment,
      "segmentId",
      "このイベントに cutInId / segmentId / cardId / stateId は指定できません。",
    );
    forbid(
      hasCard,
      "cardId",
      "このイベントに cutInId / segmentId / cardId / stateId は指定できません。",
    );
    forbid(
      hasState,
      "stateId",
      "このイベントに cutInId / segmentId / cardId / stateId は指定できません。",
    );
  });
export type StageEvent = z.infer<typeof stageEventSchema>;
