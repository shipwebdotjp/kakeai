import { z } from "zod";
import { idSchema, nonNegativeInt, positiveInt, timestampSchema } from "../content/primitives";
import {
  commentCornerSchema,
  commentSourceStatusSchema,
  liveCommentEntrySchema,
} from "./comment";
import { liveAudioUrlSchema } from "./paths";
import { liveSegmentKindSchema } from "./profile";
import { runLogEventSchema } from "./run-log";
import { liveCueSchema } from "./show";
import {
  stageClockSchema,
  stageEventSchema,
  stageLeaseRoleSchema,
  stageLeaseSchema,
  stagePhaseSchema,
  stagePlaybackSchema,
  stageSegmentRefSchema,
  stageStateSchema,
  stageStatusSchema,
} from "./stage";

/**
 * The subset of the show that stages and the console need in order to render
 * navigation and labels. Package files (theme, characters, materials) are
 * served separately through `/package/*`.
 */
export const liveServerShowMetaSchema = z.strictObject({
  title: z.string().trim().min(1),
  targetDurationMs: positiveInt,
  segments: z.array(
    z.strictObject({
      id: idSchema,
      label: z.string().trim().min(1),
      kind: liveSegmentKindSchema,
      targetDurationMs: positiveInt,
    }),
  ),
});
export type LiveServerShowMeta = z.infer<typeof liveServerShowMetaSchema>;

/**
 * Server-side generated-response lifecycle. `thinking` is the LLM call,
 * `preparing` covers TTS, `ready` means the cues are queued, and `failed`
 * carries a console-facing error. `cueIds` is empty until the cues exist.
 */
export const liveGenerationPhaseSchema = z.enum([
  "thinking",
  "preparing",
  "ready",
  "failed",
]);
export type LiveGenerationPhase = z.infer<typeof liveGenerationPhaseSchema>;

export const liveGenerationStatusSchema = z.strictObject({
  phase: liveGenerationPhaseSchema,
  commentId: idSchema.nullable(),
  cueIds: z.array(idSchema),
  error: z.string().nullable(),
  updatedAt: timestampSchema,
});
export type LiveGenerationStatus = z.infer<typeof liveGenerationStatusSchema>;

export const liveStageConnectionSchema = z.strictObject({
  sessionId: idSchema,
  role: stageLeaseRoleSchema,
  connectedAt: timestampSchema,
  leaseExpiresAt: timestampSchema,
  /** `/stage?preview=1`: always preview and not a takeover candidate by default. */
  explicitPreview: z.boolean().optional(),
});
export type LiveStageConnection = z.infer<typeof liveStageConnectionSchema>;

/**
 * Server-to-console state. Comment sections became required in P4; generation
 * sections (P5) can be added as optional or required fields later. Clients
 * validate every message against this schema.
 */
export const consoleSnapshotSchema = z.strictObject({
  runId: idSchema,
  show: liveServerShowMetaSchema,
  phase: stagePhaseSchema,
  segment: stageSegmentRefSchema.nullable(),
  stages: z.array(liveStageConnectionSchema),
  queue: z.array(liveCueSchema),
  currentCueId: idSchema.nullable(),
  /** Index in the flattened queue, or null when there is no current cue. Optional for older servers. */
  queuePosition: nonNegativeInt.nullable().optional(),
  playback: stagePlaybackSchema.nullable(),
  status: stageStatusSchema,
  clock: stageClockSchema,
  comments: z.array(liveCommentEntrySchema),
  commentCorner: commentCornerSchema,
  commentSource: commentSourceStatusSchema,
  /** Current or most recent generated response; null before the first one. */
  generation: liveGenerationStatusSchema.nullable(),
});
export type ConsoleSnapshot = z.infer<typeof consoleSnapshotSchema>;

export const liveServerHelloMessageSchema = z.strictObject({
  type: z.literal("hello"),
  runId: idSchema,
  sessionId: idSchema,
  role: z.enum(["stage", "console"]),
  /** Present for stage connections; null for the operator console. */
  lease: stageLeaseSchema.nullable(),
  state: stageStateSchema,
  showMeta: liveServerShowMetaSchema,
});
export type LiveServerHelloMessage = z.infer<typeof liveServerHelloMessageSchema>;

export const liveServerStateMessageSchema = z.strictObject({
  type: z.literal("state"),
  state: stageStateSchema,
});
export type LiveServerStateMessage = z.infer<typeof liveServerStateMessageSchema>;

export const liveServerSnapshotMessageSchema = z.strictObject({
  type: z.literal("snapshot"),
  snapshot: consoleSnapshotSchema,
});
export type LiveServerSnapshotMessage = z.infer<typeof liveServerSnapshotMessageSchema>;

export const livePreloadCueSchema = z.strictObject({
  cueId: idSchema,
  audioUrl: liveAudioUrlSchema,
});
export type LivePreloadCue = z.infer<typeof livePreloadCueSchema>;

export const liveServerPreloadMessageSchema = z.strictObject({
  type: z.literal("preload"),
  cues: z.array(livePreloadCueSchema),
});
export type LiveServerPreloadMessage = z.infer<typeof liveServerPreloadMessageSchema>;

export const liveNoticeLevelSchema = z.enum(["info", "warning", "error"]);
export type LiveNoticeLevel = z.infer<typeof liveNoticeLevelSchema>;

export const liveServerNoticeMessageSchema = z.strictObject({
  type: z.literal("notice"),
  level: liveNoticeLevelSchema,
  message: z.string().trim().min(1),
  code: z.string().trim().min(1).optional(),
});
export type LiveServerNoticeMessage = z.infer<typeof liveServerNoticeMessageSchema>;

export const liveServerEventMessageSchema = z.strictObject({
  type: z.literal("event"),
  event: runLogEventSchema,
});
export type LiveServerEventMessage = z.infer<typeof liveServerEventMessageSchema>;

export const liveServerLeaseMessageSchema = z.strictObject({
  type: z.literal("lease"),
  /** Sent to a stage when an explicit takeover or expiry changes its role. */
  lease: stageLeaseSchema,
});
export type LiveServerLeaseMessage = z.infer<typeof liveServerLeaseMessageSchema>;

export const liveServerMessageSchema = z.discriminatedUnion("type", [
  liveServerHelloMessageSchema,
  liveServerStateMessageSchema,
  liveServerSnapshotMessageSchema,
  liveServerPreloadMessageSchema,
  liveServerNoticeMessageSchema,
  liveServerEventMessageSchema,
  liveServerLeaseMessageSchema,
]);
export type LiveServerMessage = z.infer<typeof liveServerMessageSchema>;

const commentBlockTermSchema = z.string().trim().min(1).max(200);

export const liveCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("start") }),
  z.strictObject({ kind: z.literal("end") }),
  z.strictObject({ kind: z.literal("pause") }),
  z.strictObject({ kind: z.literal("resume") }),
  z.strictObject({ kind: z.literal("stop") }),
  z.strictObject({ kind: z.literal("safe_mode") }),
  z.strictObject({ kind: z.literal("skip_cue") }),
  z.strictObject({ kind: z.literal("takeover_program"), sessionId: idSchema }),
  // Generated-response editing. `edit_cue` requires at least one changed field.
  z
    .strictObject({
      kind: z.literal("edit_cue"),
      cueId: idSchema,
      caption: z.string().trim().min(1).optional(),
      speech: z.string().trim().min(1).optional(),
      expression: idSchema.optional(),
    })
    .refine(
      (command) =>
        command.caption !== undefined ||
        command.speech !== undefined ||
        command.expression !== undefined,
      { message: "caption・speech・expression のいずれかを指定してください。" },
    ),
  z.strictObject({ kind: z.literal("cancel_cue"), cueId: idSchema }),
  z.strictObject({ kind: z.literal("regenerate_cue"), cueId: idSchema }),
  z.strictObject({ kind: z.literal("delete_cue"), cueId: idSchema }),
  z.strictObject({
    kind: z.literal("move_cue"),
    cueId: idSchema,
    beforeCueId: idSchema.nullable(),
  }),
  z.strictObject({ kind: z.literal("play_correction"), cueId: idSchema }),
  // Comment corner commands consumed by the P4b controller integration.
  z.strictObject({
    kind: z.literal("pin_comment"),
    commentId: idSchema,
    note: commentBlockTermSchema.optional(),
  }),
  z.strictObject({ kind: z.literal("unpin_comment"), commentId: idSchema }),
  z.strictObject({ kind: z.literal("skip_comment"), commentId: idSchema }),
  z.strictObject({ kind: z.literal("pause_comments") }),
  z.strictObject({ kind: z.literal("resume_comments") }),
  z.strictObject({
    kind: z.literal("block_author"),
    author: commentBlockTermSchema,
  }),
  z.strictObject({
    kind: z.literal("block_topic"),
    topic: commentBlockTermSchema,
  }),
  z.strictObject({
    kind: z.literal("set_live_chat"),
    liveChatId: z.string().trim().min(1).max(500),
  }),
]);
export type LiveCommand = z.infer<typeof liveCommandSchema>;

export const liveStageEventMessageSchema = z.strictObject({
  type: z.literal("stage_event"),
  event: stageEventSchema,
});
export type LiveStageEventMessage = z.infer<typeof liveStageEventMessageSchema>;

export const liveCommandMessageSchema = z.strictObject({
  type: z.literal("command"),
  command: liveCommandSchema,
});
export type LiveCommandMessage = z.infer<typeof liveCommandMessageSchema>;

export const liveClientMessageSchema = z.discriminatedUnion("type", [
  liveStageEventMessageSchema,
  liveCommandMessageSchema,
]);
export type LiveClientMessage = z.infer<typeof liveClientMessageSchema>;
