import {
  DEFAULT_LIVE_COMMENTS_CONFIG,
  type CommentCandidate,
  type LiveCommentsConfig,
  type LiveCommentPolicy,
  type StageCommentState,
} from "@kakeai/contracts";
import { describe, expect, it, vi } from "vitest";
import { CommentFilter } from "../comments/filter.ts";
import type { CommentAnalyst } from "../llm/comment-analyst.ts";
import type { RunLogEventInput } from "../runs/run-store.ts";
import { FakeCommentScheduler, flushMicrotasks } from "../testing/fake-scheduler.ts";
import { ManualCommentSource } from "../testing/manual-comment-source.ts";
import { CommentCorner, type CommentCornerHost } from "./comment-corner.ts";
import type { CommentCornerResponder } from "./comment-responder.ts";

const BASE_TIME = Date.parse("2026-11-07T12:00:00.000Z");

const POLICY: LiveCommentPolicy = {
  mode: "corner",
  freshnessMin: 10,
  maxCommentsPerCorner: 2,
  maxHumanPinsPerCorner: 2,
  maxExtraSlots: 1,
  allowImmediateInterrupt: false,
  skipWhenEmpty: true,
};

function candidate(commentId: string, score = 0.5): CommentCandidate {
  return {
    commentId,
    score,
    safety: "ok",
    relevance: "high",
    isQuestion: false,
    reason: "理由",
    suggestedAngle: "補足する",
    safeSummary: `要約: ${commentId}`,
    safeQuestion: `質問: ${commentId}`,
    safeQuote: null,
    piiRedacted: true,
    urlsRemoved: true,
  };
}

function fakeAnalyst(
  create: (commentId: string) => CommentCandidate = (id) => candidate(id),
): CommentAnalyst & { batches: string[][] } {
  const batches: string[][] = [];
  return {
    sourceKind: "fixture",
    batches,
    async analyze(comments) {
      batches.push(comments.map((comment) => comment.event.id));
      return { comments: comments.map((comment) => create(comment.event.id)) };
    },
  };
}

function setup(options: {
  analyst?: CommentAnalyst | null;
  policy?: LiveCommentPolicy;
  holdMs?: number;
  commentsConfig?: Partial<LiveCommentsConfig>;
  responder?: CommentCornerResponder;
} = {}) {
  const scheduler = new FakeCommentScheduler();
  const now = () => new Date(BASE_TIME + scheduler.currentTimeMs);
  const source = new ManualCommentSource(now);
  const filter = new CommentFilter({
    ngWords: [],
    blockedTopics: [],
    maxLength: 300,
    maxPerAuthorPerMinute: 3,
  });
  const logs: RunLogEventInput[] = [];
  const appends: Record<string, unknown>[] = [];
  const stages: (StageCommentState | null)[] = [];
  const notices: string[] = [];
  const finishCorner = vi.fn();
  const host: CommentCornerHost = {
    finishCorner,
    setStageComment: (comment) => {
      stages.push(comment);
    },
    publish: () => undefined,
    isEndRequested: () => false,
    isSafeMode: () => false,
    notice: (_level, message) => {
      notices.push(message);
    },
  };
  const corner = new CommentCorner({
    source,
    analyst: options.analyst === undefined ? fakeAnalyst() : options.analyst,
    filter,
    commentsConfig: {
      ...DEFAULT_LIVE_COMMENTS_CONFIG,
      ngWords: [],
      cornerHoldMs: options.holdMs ?? 4_000,
      ...options.commentsConfig,
    },
    policy: options.policy ?? POLICY,
    safety: { blockedTopics: [] },
    now,
    scheduler,
    ...(options.responder === undefined ? {} : { responder: options.responder }),
    log: (input) => logs.push(input),
    appendComment: (entry) => appends.push(entry),
    host,
  });
  return { corner, source, scheduler, logs, appends, stages, notices, finishCorner, host };
}

const SEGMENT = {
  id: "seg-comments",
  kind: "comment" as const,
  label: "コメント",
  targetDurationMs: 120_000,
};

describe("CommentCorner", () => {
  it("analyzes fresh fixture comments and displays selected cards one by one", async () => {
    const analyst = fakeAnalyst((id) => candidate(id, id === "c1" ? 0.9 : 0.3));
    const { corner, source, scheduler, finishCorner } = setup({ analyst });
    source.emit({ id: "c1", text: "質問です" });
    source.emit({ id: "c2", text: "こんにちは" });

    corner.startCorner(SEGMENT);
    await flushMicrotasks();

    expect(analyst.batches).toEqual([["c1", "c2"]]);
    expect(corner.getSnapshot().corner.state).toBe("running");
    expect(corner.getSnapshot().corner.selectedCommentIds).toEqual(["c1", "c2"]);
    expect(corner.getStageComment()).toMatchObject({
      commentId: "c1",
      text: "要約: c1",
      state: "reading",
    });
    expect(corner.getStageStatus()).toBe("speaking");
    expect(finishCorner).not.toHaveBeenCalled();

    await scheduler.advance(4_000);
    expect(corner.getStageComment()?.commentId).toBe("c2");
    expect(corner.getSnapshot().comments.find((entry) => entry.comment.id === "c1")?.state).toBe(
      "done",
    );

    await scheduler.advance(4_000);
    expect(corner.getStageComment()).toBeNull();
    expect(corner.getSnapshot().corner.state).toBe("finished");
    expect(finishCorner).toHaveBeenCalledTimes(1);
  });

  it("prepares every selected candidate and moves past a failed response", async () => {
    const events: string[] = [];
    const responder: CommentCornerResponder = {
      prepare(candidates) {
        events.push(`prepare:${candidates.map((entry) => entry.commentId).join(",")}`);
      },
      async respond(entry) {
        events.push(`respond:${entry.commentId}`);
        return entry.commentId === "c1" ? "failed" : "done";
      },
      pause: () => undefined,
      resume: () => undefined,
      stop: () => undefined,
    };
    const { corner, source, finishCorner } = setup({ responder });
    source.emit({ id: "c1", text: "失敗する質問" });
    source.emit({ id: "c2", text: "次の質問" });

    corner.startCorner(SEGMENT);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(events).toEqual(["prepare:c1,c2", "respond:c1", "respond:c2"]);
    expect(corner.getSnapshot().comments.find((entry) => entry.comment.id === "c1")?.state).toBe(
      "skipped",
    );
    expect(corner.getSnapshot().comments.find((entry) => entry.comment.id === "c2")?.state).toBe(
      "done",
    );
    expect(corner.getSnapshot().corner.state).toBe("finished");
    expect(finishCorner).toHaveBeenCalledTimes(1);
  });

  it("skips an empty corner immediately", async () => {
    const { corner, logs, finishCorner } = setup();
    corner.startCorner(SEGMENT);
    await flushMicrotasks();
    expect(corner.getSnapshot().corner.state).toBe("finished");
    expect(finishCorner).toHaveBeenCalledTimes(1);
    expect(logs.some((entry) => entry.type === "corner_empty")).toBe(true);
    expect(corner.getStageComment()).toBeNull();
  });

  it("selects a human pin before higher-scored AI candidates", async () => {
    const { corner, source, scheduler } = setup({
      analyst: fakeAnalyst((id) =>
        candidate(id, id === "ai-high" ? 0.95 : id === "pinned" ? 0.1 : 0.4),
      ),
    });
    source.emit({ id: "ai-high", text: "AI 高い" });
    source.emit({ id: "pinned", text: "ピン" });
    expect(corner.pin("pinned", "質問として")).toEqual({ ok: true });

    corner.startCorner(SEGMENT);
    await flushMicrotasks();
    expect(corner.getSnapshot().corner.selectedCommentIds).toEqual(["pinned", "ai-high"]);
    expect(corner.getStageComment()?.commentId).toBe("pinned");
    await scheduler.advance(4_000);
    await scheduler.advance(4_000);
  });

  it("defers pins beyond the base plus extra slots to the next corner", async () => {
    const failing: CommentAnalyst = {
      sourceKind: "fixture",
      async analyze() {
        throw new Error("analyst down");
      },
    };
    const { corner, source, scheduler, notices } = setup({
      analyst: failing,
      policy: { ...POLICY, maxCommentsPerCorner: 1, maxHumanPinsPerCorner: 3, maxExtraSlots: 1 },
    });
    source.emit({ id: "p1", text: "一つ目" });
    source.emit({ id: "p2", text: "二つ目" });
    source.emit({ id: "p3", text: "三つ目" });
    corner.pin("p1");
    corner.pin("p2");
    corner.pin("p3");

    corner.startCorner(SEGMENT);
    await flushMicrotasks();

    expect(corner.getSnapshot().corner.selectedCommentIds).toEqual(["p1", "p2"]);
    expect(corner.getSnapshot().corner.deferredPinIds).toEqual(["p3"]);
    expect(notices.some((message) => message.includes("分析"))).toBe(true);
    await scheduler.advance(4_000);
    await scheduler.advance(4_000);
    expect(corner.getSnapshot().corner.state).toBe("finished");
  });

  it("rejects a pin for a blocked comment", () => {
    const { corner, source } = setup();
    source.emit({ id: "bad", text: "http://example.com を見てください" });
    const entry = corner.getSnapshot().comments[0];
    expect(entry?.decision).toBe("blocked");
    expect(corner.pin("bad")).toEqual({
      ok: false,
      message: "安全ブロックされたコメントはピンできません。",
    });
    expect(corner.getSnapshot().comments[0]?.pinned).toBe(false);
  });

  it("pauses and resumes the hold timer without restarting the card", async () => {
    const { corner, source, scheduler } = setup();
    source.emit({ id: "c1", text: "一つ目" });
    source.emit({ id: "c2", text: "二つ目" });
    corner.startCorner(SEGMENT);
    await flushMicrotasks();

    await scheduler.advance(1_000);
    corner.pause();
    expect(corner.getStageStatus()).toBe("idle");
    await scheduler.advance(10_000);
    expect(corner.getStageComment()?.commentId).toBe("c1");

    corner.resume();
    expect(corner.getStageStatus()).toBe("speaking");
    await scheduler.advance(2_999);
    expect(corner.getStageComment()?.commentId).toBe("c1");
    await scheduler.advance(1);
    expect(corner.getStageComment()?.commentId).toBe("c2");
    await scheduler.advance(4_000);
  });

  it("moves to the next card on skip and never re-surfaces a skipped AI candidate", async () => {
    const { corner, source, scheduler, logs, finishCorner } = setup({
      policy: { ...POLICY, maxCommentsPerCorner: 1, maxExtraSlots: 0 },
    });
    source.emit({ id: "c1", text: "一つ目" });
    source.emit({ id: "c2", text: "二つ目" });
    corner.startCorner(SEGMENT);
    await flushMicrotasks();
    expect(corner.getStageComment()?.commentId).toBe("c1");

    expect(corner.skip("c1")).toEqual({ ok: true });
    expect(corner.getStageComment()).toBeNull();
    expect(corner.getSnapshot().corner.state).toBe("finished");
    expect(finishCorner).toHaveBeenCalledTimes(1);
    expect(logs.some((entry) => entry.type === "comment_skipped")).toBe(true);
    await scheduler.advance(0);

    corner.startCorner({ ...SEGMENT, id: "seg-comments-2" });
    await flushMicrotasks();
    expect(corner.getSnapshot().corner.selectedCommentIds).not.toContain("c1");
    expect(corner.getSnapshot().corner.selectedCommentIds).toEqual(["c2"]);
    await scheduler.advance(4_000);
  });

  it("blocks an author and removes existing pins and selection", async () => {
    const { corner, source, scheduler } = setup();
    source.emit({ id: "c1", author: "spam", text: "こんにちは" });
    corner.pin("c1");
    expect(corner.blockAuthor("spam")).toEqual({ ok: true });
    const entry = corner.getSnapshot().comments[0];
    expect(entry?.decision).toBe("blocked");
    expect(entry?.pinned).toBe(false);

    corner.startCorner(SEGMENT);
    await flushMicrotasks();
    expect(corner.getSnapshot().corner.state).toBe("finished");
    await scheduler.advance(0);
  });

  it("blocks a topic and re-evaluates existing comments", async () => {
    const { corner, source } = setup();
    source.emit({ id: "c1", text: "政治の話をしましょう" });
    expect(corner.getSnapshot().comments[0]?.decision).toBe("accepted");
    expect(corner.blockTopic("政治")).toEqual({ ok: true });
    expect(corner.getSnapshot().comments[0]?.decision).toBe("blocked");
  });

  it("keeps a pinned comment usable when analysis fails", async () => {
    const failing: CommentAnalyst = {
      sourceKind: "fixture",
      async analyze() {
        throw new Error("timeout");
      },
    };
    const { corner, source, scheduler, finishCorner } = setup({ analyst: failing });
    source.emit({ id: "pin", author: "ゆず", text: "古い話題について質問です" });
    corner.pin("pin", "質問として");

    corner.startCorner(SEGMENT);
    await flushMicrotasks();
    expect(corner.getSnapshot().corner.selectedCommentIds).toEqual(["pin"]);
    expect(corner.getStageComment()).toMatchObject({
      commentId: "pin",
      author: "ゆず",
      text: "古い話題について質問です",
    });
    await scheduler.advance(4_000);
    expect(finishCorner).toHaveBeenCalledTimes(1);
  });

  it("removes a pin when analysis marks the comment as safety block", async () => {
    const { corner, source, scheduler, finishCorner } = setup({
      analyst: fakeAnalyst((id) => ({ ...candidate(id), safety: "block" })),
    });
    source.emit({ id: "blocked-late", text: "一見普通のコメント" });
    corner.pin("blocked-late");

    corner.startCorner(SEGMENT);
    await flushMicrotasks();
    const entry = corner.getSnapshot().comments[0];
    expect(entry?.candidate?.safety).toBe("block");
    expect(entry?.pinned).toBe(false);
    expect(entry?.state).toBe("blocked");
    expect(corner.getSnapshot().corner.state).toBe("finished");
    expect(finishCorner).toHaveBeenCalledTimes(1);
    await scheduler.advance(0);
  });

  it("skips a corner with no pinned comments when analysis fails", async () => {
    const failing: CommentAnalyst = {
      sourceKind: "fixture",
      async analyze() {
        throw new Error("timeout");
      },
    };
    const { corner, source, scheduler, finishCorner } = setup({ analyst: failing });
    source.emit({ id: "c1", text: "こんにちは" });
    corner.startCorner(SEGMENT);
    await flushMicrotasks();
    expect(corner.getSnapshot().corner.state).toBe("finished");
    expect(finishCorner).toHaveBeenCalledTimes(1);
    await scheduler.advance(0);
  });

  it("does not analyze or select comments older than freshnessMin", async () => {
    const analyst = fakeAnalyst();
    const { corner, source, scheduler, finishCorner } = setup({ analyst });
    source.emit({ id: "old", text: "古いコメント" });
    await scheduler.advance(11 * 60_000);

    corner.startCorner(SEGMENT);
    await flushMicrotasks();
    expect(analyst.batches).toEqual([]);
    expect(corner.getSnapshot().corner.state).toBe("finished");
    expect(finishCorner).toHaveBeenCalledTimes(1);
  });

  it("reports redacted text and never appends the raw author to comments.jsonl", async () => {
    const { corner, source, appends } = setup();
    source.emit({ id: "c1", author: "みかん", text: "連絡先は taro@example.com です" });
    expect(corner.getSnapshot().comments[0]?.decision).toBe("blocked");
    expect(appends.some((entry) => entry.author === "みかん")).toBe(false);
    expect(appends.some((entry) => entry.redactedText === "連絡先は [メール] です")).toBe(true);
  });
});
