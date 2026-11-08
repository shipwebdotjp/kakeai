import type {
  CommentCandidate,
  LiveCommentPolicy,
  LiveCommentsConfig,
  LiveSafety,
  StageCommentState,
} from "@kakeai/contracts";
import type { CommentFilter } from "../comments/filter.ts";
import type { CommentSource, CommentSourceScheduler } from "../comments/source.ts";
import type { CommentAnalyst } from "../llm/comment-analyst.ts";
import type { RunLogEventInput } from "../runs/run-store.ts";
import type { CommentSegment } from "./comment-corner-model.ts";
import type { CommentCornerResponder } from "./comment-responder.ts";

export interface CommentCornerHost {
  finishCorner(): void;
  setStageComment(comment: StageCommentState | null): void;
  publish(): void;
  isEndRequested(): boolean;
  isSafeMode(): boolean;
  notice?(level: "info" | "warning" | "error", message: string): void;
}

export interface CommentCornerOptions {
  source: CommentSource;
  analyst: CommentAnalyst | null;
  filter: CommentFilter;
  commentsConfig: LiveCommentsConfig;
  policy: LiveCommentPolicy;
  safety: Pick<LiveSafety, "blockedTopics">;
  now?: () => Date;
  scheduler?: CommentSourceScheduler;
  responder?: CommentCornerResponder;
  log?: (input: RunLogEventInput) => void;
  appendComment?: (entry: Record<string, unknown>) => void;
  host?: CommentCornerHost;
}

export type CommentCornerCommandResult =
  | { ok: true }
  | { ok: false; message: string };

export type { CommentCandidate, CommentSegment };
