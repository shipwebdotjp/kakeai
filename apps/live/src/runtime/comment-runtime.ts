import type {
  CommentSourceStatus,
  LiveCommand,
  LiveCommentCorner,
  LiveCommentEntry,
  StageCommentState,
} from "@kakeai/contracts";
import type { CommentCorner, CommentSegment } from "./comment-corner.ts";

export type CommentCommandResult = { ok: true } | { ok: false; message: string };

export interface CommentRuntimeHost {
  publish(): void;
  finishCorner(): void;
  isEndRequested(): boolean;
  isSafeMode(): boolean;
  notice(level: "info" | "warning" | "error", message: string): void;
}

const COMMENT_COMMAND_KINDS = [
  "pin_comment",
  "unpin_comment",
  "skip_comment",
  "pause_comments",
  "resume_comments",
  "block_author",
  "block_topic",
  "set_live_chat",
] as const;

export type CommentLiveCommand = Extract<
  LiveCommand,
  { kind: (typeof COMMENT_COMMAND_KINDS)[number] }
>;

export function isCommentCommand(command: LiveCommand): command is CommentLiveCommand {
  return (COMMENT_COMMAND_KINDS as readonly string[]).includes(command.kind);
}

/**
 * Adapts the optional CommentCorner to the controller. Keeping the command
 * routing and lifecycle here stops the controller from growing with comment
 * details while the corner owns the actual comment state.
 */
export class CommentRuntime {
  private readonly corner: CommentCorner | null;
  private stageComment: StageCommentState | null = null;

  constructor(corner: CommentCorner | undefined, host: CommentRuntimeHost) {
    this.corner = corner ?? null;
    this.corner?.attach({
      finishCorner: () => host.finishCorner(),
      setStageComment: (comment) => {
        this.stageComment = comment;
      },
      publish: () => host.publish(),
      isEndRequested: () => host.isEndRequested(),
      isSafeMode: () => host.isSafeMode(),
      notice: (level, message) => host.notice(level, message),
    });
  }

  get enabled(): boolean {
    return this.corner !== null;
  }

  getStageComment(): StageCommentState | null {
    return this.stageComment;
  }

  getStageStatus(): "idle" | "thinking" | "speaking" {
    return this.corner?.getStageStatus() ?? "idle";
  }

  isActive(): boolean {
    return this.corner?.isActive() ?? false;
  }

  getCurrentCommentId(): string | null {
    return this.corner?.getCurrentCommentId() ?? null;
  }

  getSnapshot(): {
    comments: LiveCommentEntry[];
    corner: LiveCommentCorner;
    source: CommentSourceStatus;
  } | null {
    return this.corner?.getSnapshot() ?? null;
  }

  startSources(): void {
    this.corner?.startSources();
  }

  stopSources(): void {
    this.corner?.stopSources();
  }

  dispose(): void {
    this.corner?.dispose();
  }

  startCorner(segment: CommentSegment): void {
    this.stageComment = null;
    this.corner?.startCorner(segment);
  }

  clearStageComment(): void {
    this.stageComment = null;
  }

  pause(): void {
    void this.corner?.pause();
  }

  resume(): void {
    void this.corner?.resume();
  }

  interrupt(reason: "safe_mode" | "skip" | "stop"): boolean {
    return this.corner?.interrupt(reason) ?? false;
  }

  handleCommand(command: CommentLiveCommand): CommentCommandResult {
    if (this.corner === null) {
      return { ok: false, message: "コメントコーナーが設定されていません。" };
    }
    switch (command.kind) {
      case "pin_comment":
        return this.corner.pin(command.commentId, command.note);
      case "unpin_comment":
        return this.corner.unpin(command.commentId);
      case "skip_comment":
        return this.corner.skip(command.commentId);
      case "pause_comments":
        return this.corner.pause();
      case "resume_comments":
        return this.corner.resume();
      case "block_author":
        return this.corner.blockAuthor(command.author);
      case "block_topic":
        return this.corner.blockTopic(command.topic);
      case "set_live_chat":
        return this.corner.setLiveChatId(command.liveChatId);
      default: {
        const exhaustive: never = command;
        throw new Error(`Unsupported comment command: ${JSON.stringify(exhaustive)}`);
      }
    }
  }
}
