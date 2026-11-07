import type {
  CommentCandidate,
  CommentEvent,
  CommentSourceStatus,
  LiveCommentCorner,
  LiveCommentEntry,
  LiveCommentsConfig,
  LiveCommentPolicy,
  LiveSafety,
  StageCommentState,
} from "@kakeai/contracts";
import { redactCommentText } from "../comments/filter.ts";
import type { CommentFilter, CommentFilterReason } from "../comments/filter.ts";
import type { CommentSource, CommentSourceScheduler } from "../comments/source.ts";
import { realCommentScheduler } from "../comments/source.ts";
import type { CommentAnalyst } from "../llm/comment-analyst.ts";
import type { RunLogEventInput } from "../runs/run-store.ts";
import { collectCornerPlan } from "./comment-corner-collector.ts";
import type { CommentSegment, CornerEntry } from "./comment-corner-model.ts";
import {
  clampText,
  effectiveCommentPolicy,
  toPublicEntry,
} from "./comment-corner-model.ts";
import {
  HoldCommentCornerResponder,
  type CommentCornerResponder,
} from "./comment-responder.ts";

export type { CommentSegment } from "./comment-corner-model.ts";

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

const MAX_STAGE_AUTHOR = 200;

/**
 * Owns the in-memory comment store and the comment-corner run. Raw comment
 * bodies live only in this object; logs and `comments.jsonl` receive the
 * redacted text and structured analysis only.
 */
export class CommentCorner {
  private readonly source: CommentSource;
  private readonly analyst: CommentAnalyst | null;
  private readonly filter: CommentFilter;
  private readonly commentsConfig: LiveCommentsConfig;
  private readonly policy: LiveCommentPolicy;
  private readonly now: () => Date;
  private readonly scheduler: CommentSourceScheduler;
  private readonly responder: CommentCornerResponder;
  private readonly logEvent: (input: RunLogEventInput) => void;
  private readonly appendComment: (entry: Record<string, unknown>) => void;
  private readonly entries = new Map<string, CornerEntry>();
  private readonly skippedIds = new Set<string>();
  private readonly unsubscribeComment: () => void;
  private readonly unsubscribeStatus: () => void;
  private host: CommentCornerHost | null;
  private sourceStatus: CommentSourceStatus;
  private sourceStarted = false;
  private cornerState: LiveCommentCorner["state"] = "idle";
  private segmentId: string | null = null;
  private selected: CommentCandidate[] = [];
  private deferredPinIds: string[] = [];
  private currentCommentId: string | null = null;
  private remainingSlots = 0;
  private cornerBaseSlots = 0;
  private paused = false;
  private token = 0;
  private responseToken = 0;
  private stageComment: StageCommentState | null = null;

  constructor(options: CommentCornerOptions) {
    this.source = options.source;
    this.analyst = options.analyst;
    this.filter = options.filter;
    this.commentsConfig = options.commentsConfig;
    this.policy = options.policy;
    this.now = options.now ?? (() => new Date());
    this.scheduler = options.scheduler ?? realCommentScheduler;
    this.host = options.host ?? null;
    this.logEvent = options.log ?? (() => undefined);
    this.appendComment = options.appendComment ?? (() => undefined);
    this.sourceStatus = { ...this.source.getStatus() };
    this.responder =
      options.responder ??
      new HoldCommentCornerResponder({
        holdMs: this.commentsConfig.cornerHoldMs,
        scheduler: this.scheduler,
        now: () => this.now().getTime(),
      });

    this.unsubscribeComment = this.source.onComment((comment) => this.receive(comment));
    this.unsubscribeStatus = this.source.onStatus((status) => {
      this.sourceStatus = { ...status };
      this.host?.publish();
    });
  }

  /**
   * The controller attaches after construction because the callbacks point
   * back into it. The source stays stopped until `startSources`.
   */
  attach(host: CommentCornerHost): void {
    this.host = host;
  }

  startSources(): void {
    if (this.sourceStarted) {
      return;
    }
    this.sourceStarted = true;
    try {
      const result = this.source.start();
      if (result instanceof Promise) {
        void result.catch((error: unknown) => this.handleSourceError(error));
      }
    } catch (error) {
      this.handleSourceError(error);
    }
  }

  stopSources(): void {
    if (!this.sourceStarted) {
      return;
    }
    this.sourceStarted = false;
    try {
      this.source.stop();
    } catch (error) {
      this.handleSourceError(error);
    }
  }

  dispose(): void {
    this.stopSources();
    this.token += 1;
    this.responseToken += 1;
    this.responder.stop();
    this.unsubscribeComment();
    this.unsubscribeStatus();
  }

  isActive(): boolean {
    return this.cornerState === "collecting" || this.cornerState === "running";
  }

  getStageStatus(): "idle" | "thinking" | "speaking" {
    if (this.paused) {
      return "idle";
    }
    if (this.cornerState === "collecting") {
      return "thinking";
    }
    if (this.cornerState === "running") {
      return this.currentCommentId === null ? "thinking" : "speaking";
    }
    return "idle";
  }

  getStageComment(): StageCommentState | null {
    return this.stageComment;
  }

  getCurrentCommentId(): string | null {
    return this.currentCommentId;
  }

  getSnapshot(): {
    comments: LiveCommentEntry[];
    corner: LiveCommentCorner;
    source: CommentSourceStatus;
  } {
    const nowMs = this.now().getTime();
    return {
      comments: [...this.entries.values()].map((entry) => toPublicEntry(entry, nowMs)),
      corner: {
        state: this.cornerState,
        segmentId: this.segmentId,
        selectedCommentIds: this.selected.map((candidate) => candidate.commentId),
        currentCommentId: this.currentCommentId,
        deferredPinIds: [...this.deferredPinIds],
        remainingSlots: this.remainingSlots,
      },
      source: { ...this.sourceStatus },
    };
  }

  startCorner(segment: CommentSegment): void {
    if (this.isActive()) {
      return;
    }
    this.token += 1;
    const token = this.token;
    this.cornerState = "collecting";
    this.segmentId = segment.id;
    this.selected = [];
    this.deferredPinIds = [];
    this.currentCommentId = null;
    const effective = effectiveCommentPolicy(this.policy, segment);
    this.cornerBaseSlots = effective.maxCommentsPerCorner;
    this.remainingSlots = effective.maxCommentsPerCorner;
    this.setStageComment(null);
    this.logEvent({
      type: "corner_started",
      data: {
        segmentId: segment.id,
        pinCount: [...this.entries.values()].filter((entry) => entry.pinned).length,
      },
    });
    this.host?.publish();
    void this.collect(token, segment);
  }

  pin(commentId: string, note?: string): CommentCornerCommandResult {
    const entry = this.entries.get(commentId);
    if (entry === undefined) {
      return { ok: false, message: "コメントが見つかりません。" };
    }
    if (this.isBlocked(entry)) {
      return { ok: false, message: "安全ブロックされたコメントはピンできません。" };
    }
    this.skippedIds.delete(commentId);
    entry.pinned = true;
    entry.pinNote = note?.trim() === "" ? null : (note ?? null);
    this.logEvent({
      type: "pin_added",
      commentId,
      data: entry.pinNote === null ? {} : { note: entry.pinNote },
    });
    this.host?.publish();
    return { ok: true };
  }

  unpin(commentId: string): CommentCornerCommandResult {
    const entry = this.entries.get(commentId);
    if (entry === undefined) {
      return { ok: false, message: "コメントが見つかりません。" };
    }
    entry.pinned = false;
    entry.pinNote = null;
    this.logEvent({ type: "pin_removed", commentId, data: { reason: "operator" } });
    this.host?.publish();
    return { ok: true };
  }

  skip(commentId: string): CommentCornerCommandResult {
    const entry = this.entries.get(commentId);
    if (entry === undefined) {
      return { ok: false, message: "コメントが見つかりません。" };
    }
    const wasPinned = entry.pinned;
    this.skippedIds.add(commentId);
    entry.pinned = false;
    entry.pinNote = null;
    entry.state = "skipped";
    entry.selected = false;
    this.selected = this.selected.filter((candidate) => candidate.commentId !== commentId);
    this.remainingSlots = Math.max(0, this.cornerBaseSlots - this.selected.length);
    if (wasPinned) {
      this.logEvent({ type: "pin_removed", commentId, data: { reason: "skip" } });
    }
    this.logEvent({ type: "comment_skipped", commentId, data: { reason: "operator" } });

    if (this.currentCommentId === commentId) {
      this.responseToken += 1;
      this.responder.stop();
      this.currentCommentId = null;
      this.setStageComment(null);
      this.host?.publish();
      this.runNext();
      return { ok: true };
    }
    this.host?.publish();
    return { ok: true };
  }

  pause(): CommentCornerCommandResult {
    if (this.paused) {
      return { ok: true };
    }
    this.paused = true;
    this.responder.pause();
    this.host?.publish();
    return { ok: true };
  }

  resume(): CommentCornerCommandResult {
    if (!this.paused) {
      return { ok: true };
    }
    this.paused = false;
    this.responder.resume();
    if (this.cornerState === "running" && this.currentCommentId === null) {
      this.runNext();
    }
    this.host?.publish();
    return { ok: true };
  }

  blockAuthor(author: string): CommentCornerCommandResult {
    this.filter.blockAuthor(author);
    return this.reevaluateAll();
  }

  blockTopic(topic: string): CommentCornerCommandResult {
    this.filter.blockTopic(topic);
    return this.reevaluateAll();
  }

  setLiveChatId(liveChatId: string): CommentCornerCommandResult {
    if (this.source.setLiveChatId === undefined) {
      return { ok: false, message: "このコメントソースは liveChatId を変更できません。" };
    }
    this.source.setLiveChatId(liveChatId);
    this.host?.publish();
    return { ok: true };
  }

  /** Ends the corner immediately without advancing the spine. */
  interrupt(reason: "safe_mode" | "skip" | "stop"): boolean {
    if (!this.isActive()) {
      return false;
    }
    this.finishCorner(reason, false);
    return true;
  }

  private receive(comment: CommentEvent): void {
    if (this.entries.has(comment.id)) {
      return;
    }
    const filtered = this.filter.filter(comment);
    const entry: CornerEntry = {
      event: comment,
      decision: filtered.decision,
      reasons: filtered.reasons,
      redactedText: filtered.redactedText,
      candidate: null,
      pinned: false,
      pinNote: null,
      state: filtered.decision === "blocked" ? "blocked" : "received",
      selected: false,
      analyzed: false,
    };
    this.entries.set(comment.id, entry);
    this.appendComment({
      event: "received",
      commentId: comment.id,
      redactedText: entry.redactedText,
      decision: entry.decision,
      reasons: entry.reasons,
    });
    this.host?.publish();
  }

  private async collect(token: number, segment: CommentSegment): Promise<void> {
    const plan = await collectCornerPlan(segment, {
      entries: this.entries,
      skippedIds: this.skippedIds,
      analyst: this.analyst,
      policy: this.policy,
      now: this.now,
      log: this.logEvent,
      appendComment: this.appendComment,
      ...(this.host?.notice === undefined
        ? {}
        : { notice: (message: string) => this.host?.notice?.("warning", message) }),
      isCurrent: () => this.isCurrent(token),
    });
    if (plan === null) {
      return;
    }
    this.selected = plan.selected;
    this.deferredPinIds = plan.deferredPinIds;
    this.cornerBaseSlots = plan.baseSlots;
    this.remainingSlots = Math.max(0, plan.baseSlots - plan.selected.length);
    this.cornerState = "running";

    if (plan.selected.length === 0) {
      this.logEvent({
        type: "corner_empty",
        data: { segmentId: segment.id, skipped: plan.skippedCount },
      });
      if (this.paused) {
        // Do not advance the spine while the operator has the show paused.
        // Resuming calls `runNext`, which sees no selected comment and ends.
        this.host?.publish();
        return;
      }
      this.finishCorner("empty", true);
      return;
    }
    this.host?.publish();
    if (!this.isCurrent(token)) {
      return;
    }
    this.runNext();
  }

  private runNext(): void {
    if (!this.isActive() || this.paused) {
      return;
    }
    if (this.host?.isSafeMode() === true) {
      this.finishCorner("safe_mode", false);
      return;
    }
    if (this.host?.isEndRequested() === true) {
      this.finishCorner("end", true);
      return;
    }
    const next = this.selected.find((candidate) => {
      const entry = this.entries.get(candidate.commentId);
      return entry !== undefined && entry.state === "selected";
    });
    if (next === undefined) {
      this.finishCorner("completed", true);
      return;
    }

    const entry = this.entries.get(next.commentId);
    if (entry === undefined) {
      this.finishCorner("completed", true);
      return;
    }
    this.responseToken += 1;
    const responseToken = this.responseToken;
    this.currentCommentId = next.commentId;
    entry.state = "selected";
    this.setStageComment({
      commentId: next.commentId,
      author:
        redactCommentText(entry.event.authorName).trim().slice(0, MAX_STAGE_AUTHOR) || "匿名",
      text: clampText(next.safeSummary),
      state: "reading",
    });
    this.host?.publish();
    void this.responder.respond(next).then((outcome) => {
      if (responseToken !== this.responseToken || !this.isActive()) {
        return;
      }
      if (outcome === "stopped") {
        return;
      }
      this.finishCurrentEntry(entry);
      this.currentCommentId = null;
      this.setStageComment(null);
      if (entry.pinned) {
        entry.pinned = false;
        entry.pinNote = null;
        this.logEvent({
          type: "pin_removed",
          commentId: entry.event.id,
          data: { reason: "consumed" },
        });
      }
      this.host?.publish();
      this.runNext();
    });
  }

  private finishCurrentEntry(entry: CornerEntry): void {
    entry.state = "done";
    entry.selected = true;
  }

  private finishCorner(reason: string, notifySpine: boolean): void {
    if (!this.isActive()) {
      return;
    }
    this.token += 1;
    this.responseToken += 1;
    this.responder.stop();
    this.currentCommentId = null;
    this.setStageComment(null);
    for (const candidate of this.selected) {
      const entry = this.entries.get(candidate.commentId);
      if (entry === undefined) {
        continue;
      }
      if (entry.state === "selected") {
        entry.state = "skipped";
        entry.selected = false;
      }
      if (entry.pinned) {
        entry.pinned = false;
        entry.pinNote = null;
        this.logEvent({
          type: "pin_removed",
          commentId: entry.event.id,
          data: { reason },
        });
      }
    }
    this.cornerState = "finished";
    this.remainingSlots = 0;
    this.logEvent({
      type: "corner_finished",
      data: { reason, segmentId: this.segmentId, selected: this.selected.length },
    });
    this.host?.publish();
    if (notifySpine) {
      this.host?.finishCorner();
    }
  }

  private reevaluateAll(): CommentCornerCommandResult {
    let blockedCurrent = false;
    for (const entry of this.entries.values()) {
      const filtered = this.filter.reevaluate(entry.event);
      entry.decision = filtered.decision;
      entry.reasons = filtered.reasons;
      entry.redactedText = filtered.redactedText;
      if (filtered.decision !== "blocked") {
        continue;
      }
      entry.candidate = null;
      entry.state = "blocked";
      entry.selected = false;
      if (entry.pinned) {
        entry.pinned = false;
        entry.pinNote = null;
        this.logEvent({
          type: "pin_removed",
          commentId: entry.event.id,
          data: { reason: "blocked" },
        });
      }
      if (this.currentCommentId === entry.event.id) {
        blockedCurrent = true;
      }
      this.selected = this.selected.filter(
        (candidate) => candidate.commentId !== entry.event.id,
      );
    }
    this.remainingSlots = Math.max(0, this.cornerBaseSlots - this.selected.length);
    if (blockedCurrent) {
      this.responseToken += 1;
      this.responder.stop();
      this.currentCommentId = null;
      this.setStageComment(null);
      this.host?.publish();
      this.runNext();
      return { ok: true };
    }
    this.host?.publish();
    return { ok: true };
  }

  private isBlocked(entry: CornerEntry): boolean {
    return entry.decision === "blocked" || entry.candidate?.safety === "block";
  }

  private isCurrent(token: number): boolean {
    return token === this.token && this.isActive();
  }

  private setStageComment(comment: StageCommentState | null): void {
    this.stageComment = comment;
    this.host?.setStageComment(comment);
  }

  private handleSourceError(error: unknown): void {
    const message =
      error instanceof Error ? error.message : "コメントソースでエラーが発生しました。";
    this.logEvent({ type: "error", data: { message } });
    this.host?.notice?.("warning", `コメントソース: ${message}`);
    this.host?.publish();
  }
}
