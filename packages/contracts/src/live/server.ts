import { z } from "zod";
import { idSchema, nonNegativeInt, positiveInt, timestampSchema } from "../content/primitives";
import { livePackageRelativePathSchema } from "./paths";
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
 * Server-to-console state. New sections (comments in P4, generation in P5) are
 * added as optional or required fields in later phases; clients validate the
 * messages they receive against this schema.
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
  audioUrl: livePackageRelativePathSchema,
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

export const liveCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("start") }),
  z.strictObject({ kind: z.literal("end") }),
  z.strictObject({ kind: z.literal("pause") }),
  z.strictObject({ kind: z.literal("resume") }),
  z.strictObject({ kind: z.literal("stop") }),
  z.strictObject({ kind: z.literal("safe_mode") }),
  z.strictObject({ kind: z.literal("skip_cue") }),
  z.strictObject({ kind: z.literal("takeover_program"), sessionId: idSchema }),
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
