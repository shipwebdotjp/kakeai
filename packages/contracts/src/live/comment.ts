import { z } from "zod";
import { idSchema, nonNegativeInt, timestampSchema } from "../content/primitives";

export const liveCommentKindSchema = z.enum(["normal", "superchat", "member"]);
export type LiveCommentKind = z.infer<typeof liveCommentKindSchema>;

export const commentEventSchema = z.strictObject({
  id: idSchema,
  authorName: z.string().trim().min(1),
  text: z.string().trim().min(1),
  publishedAt: timestampSchema,
  receivedAt: timestampSchema,
  kind: liveCommentKindSchema,
});
export type CommentEvent = z.infer<typeof commentEventSchema>;

export const commentSafetySchema = z.enum(["ok", "review", "block"]);
export type CommentSafety = z.infer<typeof commentSafetySchema>;

export const commentRelevanceSchema = z.enum(["high", "medium", "low"]);
export type CommentRelevance = z.infer<typeof commentRelevanceSchema>;

export const commentCandidateSchema = z.strictObject({
  commentId: idSchema,
  score: z.number().finite().min(0).max(1),
  safety: commentSafetySchema,
  relevance: commentRelevanceSchema,
  isQuestion: z.boolean(),
  reason: z.string().trim().min(1).max(1000),
  suggestedAngle: z.string().trim().min(1).max(1000),
  safeSummary: z.string().trim().min(1).max(500),
  safeQuestion: z.string().trim().min(1).max(500),
  safeQuote: z.string().trim().min(1).max(1000).nullable(),
  piiRedacted: z.boolean(),
  urlsRemoved: z.boolean(),
});
export type CommentCandidate = z.infer<typeof commentCandidateSchema>;

export const commentAnalysisSchema = z.strictObject({
  comments: z.array(commentCandidateSchema),
});
export type CommentAnalysis = z.infer<typeof commentAnalysisSchema>;

export const commentSourceKindSchema = z.enum(["youtube", "fixture"]);
export type CommentSourceKind = z.infer<typeof commentSourceKindSchema>;

export const commentSourceStateSchema = z.enum([
  "idle",
  "connecting",
  "polling",
  "paused",
  "error",
  "stopped",
]);
export type CommentSourceState = z.infer<typeof commentSourceStateSchema>;

/**
 * Running estimate of YouTube Data API consumption. `startedAt` is when the
 * source started counting; the console derives a per-hour estimate from it.
 * `windowStartedAt` can mark a rolling window reset without losing the run
 * start time.
 */
export const commentQuotaEstimateSchema = z.strictObject({
  requests: nonNegativeInt,
  units: nonNegativeInt,
  startedAt: timestampSchema,
  windowStartedAt: timestampSchema.optional(),
});
export type CommentQuotaEstimate = z.infer<typeof commentQuotaEstimateSchema>;

/**
 * Status shared by the server and the operator console. The console renders
 * this directly; it contains no comment text or author names.
 */
export const commentSourceStatusSchema = z.strictObject({
  kind: commentSourceKindSchema,
  state: commentSourceStateSchema,
  liveChatId: z.string().trim().min(1).max(500).nullable(),
  pollingIntervalMs: nonNegativeInt,
  lastPolledAt: timestampSchema.nullable(),
  lastError: z.string().nullable(),
  quota: commentQuotaEstimateSchema.nullable(),
  authExpiresAt: timestampSchema.nullable(),
  needsReauth: z.boolean(),
});
export type CommentSourceStatus = z.infer<typeof commentSourceStatusSchema>;

/** One fixture comment. `atMs` is relative to the start of the comment source. */
export const liveFixtureCommentSchema = z.strictObject({
  atMs: nonNegativeInt,
  author: z.string().trim().min(1),
  text: z.string().trim().min(1),
  kind: liveCommentKindSchema.default("normal"),
});
export type LiveFixtureComment = z.infer<typeof liveFixtureCommentSchema>;

export const liveFixtureCommentsSchema = z.array(liveFixtureCommentSchema);
