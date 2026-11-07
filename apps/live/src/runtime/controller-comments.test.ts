import {
  DEFAULT_LIVE_COMMENTS_CONFIG,
  type CommentCandidate,
  type LiveCommentPolicy,
  type LivePackageShow,
  type StageEvent,
} from "@kakeai/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommentFilter } from "../comments/filter.ts";
import type { CommentAnalyst } from "../llm/comment-analyst.ts";
import { ManualCommentSource } from "../testing/manual-comment-source.ts";
import { testCharacters, testShow } from "../testing/package-fixture.ts";
import { CommentCorner } from "./comment-corner.ts";
import { LiveController } from "./controller.ts";

const START = "2026-11-07T12:00:00.000Z";

const POLICY: LiveCommentPolicy = {
  mode: "corner",
  freshnessMin: 10,
  maxCommentsPerCorner: 4,
  maxHumanPinsPerCorner: 4,
  maxExtraSlots: 2,
  allowImmediateInterrupt: false,
  skipWhenEmpty: true,
};

function candidate(commentId: string, score: number): CommentCandidate {
  return {
    commentId,
    score,
    safety: "ok",
    relevance: "high",
    isQuestion: commentId.includes("question"),
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
  create: (commentId: string) => CommentCandidate = (id) => candidate(id, 0.5),
): CommentAnalyst {
  return {
    sourceKind: "fixture",
    async analyze(comments) {
      return { comments: comments.map((comment) => create(comment.event.id)) };
    },
  };
}

function setup(
  options: {
    show?: LivePackageShow;
    analyst?: CommentAnalyst;
    policy?: LiveCommentPolicy;
  } = {},
) {
  const show = options.show ?? testShow({ includeCommentCorner: true });
  const source = new ManualCommentSource(() => new Date());
  const corner = new CommentCorner({
    source,
    analyst: options.analyst ?? fakeAnalyst(),
    filter: new CommentFilter({
      ngWords: [],
      blockedTopics: [],
      maxLength: 300,
      maxPerAuthorPerMinute: 3,
    }),
    commentsConfig: { ...DEFAULT_LIVE_COMMENTS_CONFIG, ngWords: [], cornerHoldMs: 4_000 },
    policy: options.policy ?? POLICY,
    safety: { blockedTopics: [] },
    now: () => new Date(),
    log: () => undefined,
    appendComment: () => undefined,
  });
  const controller = new LiveController({
    runId: "run-test",
    show,
    characters: testCharacters(),
    comments: corner,
    leaseTtlMs: 24 * 60 * 60 * 1000,
  });
  return { controller, source, corner };
}

function audioEvent(controller: LiveController, overrides: Partial<StageEvent> = {}): StageEvent {
  const playback = controller.getState().playback;
  if (playback === null) {
    throw new Error("no playback");
  }
  return {
    kind: "audio_ended",
    runId: "run-test",
    sessionId: "stage-1",
    cueId: playback.cueId,
    attempt: playback.attempt,
    sequence: playback.sequence,
    ...overrides,
  };
}

function endCurrent(controller: LiveController): void {
  controller.handleStageEvent("stage-1", audioEvent(controller));
}

async function settle(): Promise<void> {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve();
  }
}

async function reachCommentCorner(controller: LiveController): Promise<void> {
  controller.connectStage("stage-1");
  controller.handleCommand({ kind: "start" });
  endCurrent(controller); // opening -> script
  endCurrent(controller); // script -> comment
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(START));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LiveController comment corner", () => {
  it("runs a comment card for cornerHoldMs and then advances to closing", async () => {
    const { controller, source } = setup();
    source.emit({ id: "c1", text: "質問です" });
    await reachCommentCorner(controller);

    expect(controller.getState().phase).toBe("comment");
    expect(controller.getState().status).toBe("speaking");
    expect(controller.getState().caption).toBeNull();
    expect(controller.getState().comment).toMatchObject({
      commentId: "c1",
      text: "要約: c1",
      state: "reading",
    });

    await vi.advanceTimersByTimeAsync(4_000);
    await settle();
    expect(controller.getState().phase).toBe("closing");
    expect(controller.getState().playback?.cueId).toBe("cue-closing");
    expect(controller.getSnapshot().commentSource.state).not.toBe("idle");

    endCurrent(controller);
    expect(controller.getState().phase).toBe("post_show");
    expect(controller.getSnapshot().commentSource.state).toBe("stopped");
  });

  it("skips the comment segment when there are no comments", async () => {
    const { controller } = setup();
    await reachCommentCorner(controller);
    expect(controller.getState().phase).toBe("closing");
    expect(controller.getState().playback?.cueId).toBe("cue-closing");
    expect(controller.getSnapshot().commentCorner.state).toBe("finished");
  });

  it("uses a human pin before higher-scored AI candidates", async () => {
    const { controller, source } = setup({
      analyst: fakeAnalyst((id) => candidate(id, id === "pin" ? 0.1 : 0.9)),
    });
    source.emit({ id: "ai", text: "AI 候補" });
    source.emit({ id: "pin", text: "ピンしてほしい" });
    expect(
      controller.handleCommand({ kind: "pin_comment", commentId: "pin", note: "質問として" }),
    ).toEqual({ ok: true });

    await reachCommentCorner(controller);
    expect(controller.getSnapshot().commentCorner.selectedCommentIds).toEqual(["pin", "ai"]);
    expect(controller.getState().comment?.commentId).toBe("pin");
    await vi.advanceTimersByTimeAsync(4_000);
    await settle();
    await vi.advanceTimersByTimeAsync(4_000);
    await settle();
  });

  it("finishes the current card and then enters closing when end is requested", async () => {
    const { controller, source } = setup();
    source.emit({ id: "c1", text: "一つ目" });
    source.emit({ id: "c2", text: "二つ目" });
    await reachCommentCorner(controller);
    expect(controller.getState().comment?.commentId).toBe("c1");

    expect(controller.handleCommand({ kind: "end" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("comment");
    expect(controller.getState().comment?.commentId).toBe("c1");

    await vi.advanceTimersByTimeAsync(4_000);
    await settle();
    expect(controller.getState().phase).toBe("closing");
    expect(controller.getState().playback?.cueId).toBe("cue-closing");
  });

  it("ends the corner and skips later comment segments in safe mode", async () => {
    const base = testShow();
    const show = {
      ...base,
      segments: [
        base.segments[0]!,
        base.segments[1]!,
        {
          id: "seg-comments-1",
          kind: "comment" as const,
          label: "コメント1",
          targetDurationMs: 60_000,
        },
        {
          id: "seg-comments-2",
          kind: "comment" as const,
          label: "コメント2",
          targetDurationMs: 60_000,
        },
        base.segments[2]!,
      ],
    } as LivePackageShow;
    const { controller, source } = setup({ show });
    source.emit({ id: "c1", text: "一つ目" });
    await reachCommentCorner(controller);
    expect(controller.getSnapshot().commentCorner.segmentId).toBe("seg-comments-1");
    expect(controller.getState().comment?.commentId).toBe("c1");

    expect(controller.handleCommand({ kind: "safe_mode" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("safe_mode");
    expect(controller.getState().comment).toBeNull();
    expect(controller.getState().playback?.cueId).toBe("cue-closing");
    expect(controller.getSnapshot().commentCorner.state).toBe("finished");
  });

  it("pauses the comment hold and resumes it", async () => {
    const { controller, source } = setup();
    source.emit({ id: "c1", text: "一つ目" });
    source.emit({ id: "c2", text: "二つ目" });
    await reachCommentCorner(controller);
    expect(controller.getState().comment?.commentId).toBe("c1");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(controller.handleCommand({ kind: "pause" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("paused");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(controller.getState().comment?.commentId).toBe("c1");

    expect(controller.handleCommand({ kind: "resume" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("comment");
    await vi.advanceTimersByTimeAsync(2_999);
    expect(controller.getState().comment?.commentId).toBe("c1");
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.getState().comment?.commentId).toBe("c2");
    await vi.advanceTimersByTimeAsync(4_000);
    await settle();
  });

  it("still runs a pinned corner when analysis fails and then reaches closing", async () => {
    const failing: CommentAnalyst = {
      sourceKind: "fixture",
      async analyze() {
        throw new Error("analyst down");
      },
    };
    const { controller, source } = setup({ analyst: failing });
    source.emit({ id: "pin", text: "ピンのコメント" });
    controller.handleCommand({ kind: "pin_comment", commentId: "pin" });

    await reachCommentCorner(controller);
    expect(controller.getState().phase).toBe("comment");
    expect(controller.getState().comment?.commentId).toBe("pin");
    await vi.advanceTimersByTimeAsync(4_000);
    await settle();
    expect(controller.getState().phase).toBe("closing");
    expect(controller.getState().playback?.cueId).toBe("cue-closing");
  });

  it("exposes comments, corner and source in the console snapshot", async () => {
    const { controller, source } = setup();
    source.emit({ id: "c1", author: "みかん", text: "こんにちは" });
    await reachCommentCorner(controller);

    const snapshot = controller.getSnapshot();
    expect(snapshot.comments).toHaveLength(1);
    expect(snapshot.comments[0]).toMatchObject({
      pinned: false,
      selected: true,
      state: "selected",
    });
    expect(snapshot.comments[0]?.comment.authorName).toBe("みかん");
    expect(snapshot.commentCorner).toMatchObject({
      state: "running",
      segmentId: "seg-comments",
      currentCommentId: "c1",
      remainingSlots: 3,
    });
    expect(snapshot.commentSource.kind).toBe("fixture");
    expect(snapshot.commentSource.state).toBe("polling");
    await vi.advanceTimersByTimeAsync(4_000);
    await settle();
  });

  it("skips the current comment card with skip_cue", async () => {
    const { controller, source } = setup();
    source.emit({ id: "c1", text: "一つ目" });
    source.emit({ id: "c2", text: "二つ目" });
    await reachCommentCorner(controller);
    expect(controller.getState().comment?.commentId).toBe("c1");

    expect(controller.handleCommand({ kind: "skip_cue" })).toEqual({ ok: true });
    expect(controller.getState().comment?.commentId).toBe("c2");
    await vi.advanceTimersByTimeAsync(4_000);
    await settle();
  });
});
