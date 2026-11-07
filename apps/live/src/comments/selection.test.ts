import type { CommentCandidate, CommentRelevance, CommentSafety } from "@kakeai/contracts";
import { describe, expect, it } from "vitest";
import { selectComments } from "./selection.ts";

function candidate(
  commentId: string,
  overrides: {
    score?: number;
    safety?: CommentSafety;
    relevance?: CommentRelevance;
  } = {},
): CommentCandidate {
  return {
    commentId,
    score: overrides.score ?? 0.5,
    safety: overrides.safety ?? "ok",
    relevance: overrides.relevance ?? "high",
    isQuestion: false,
    reason: `${commentId} の理由`,
    suggestedAngle: "補足する",
    safeSummary: `${commentId} の要約`,
    safeQuestion: `${commentId} の質問`,
    safeQuote: null,
    piiRedacted: true,
    urlsRemoved: true,
  };
}

const POLICY = { maxCommentsPerCorner: 4, maxHumanPinsPerCorner: 4 };

describe("selectComments", () => {
  it("selects human pins before AI candidates", () => {
    const result = selectComments({
      pins: [{ commentId: "pin" }],
      candidates: [
        candidate("ai-high", { score: 0.9 }),
        candidate("pin", { score: 0.1 }),
        candidate("ai-low", { score: 0.4 }),
      ],
      policy: POLICY,
      maxExtraSlots: 2,
    });
    expect(result.selected.map((entry) => entry.commentId)).toEqual(["pin", "ai-high", "ai-low"]);
    expect(result.deferredPinIds).toEqual([]);
  });

  it("fills the remaining base slots in score order and ignores low relevance", () => {
    const result = selectComments({
      pins: [],
      candidates: [
        candidate("b", { score: 0.5 }),
        candidate("a", { score: 0.8 }),
        candidate("low", { score: 0.99, relevance: "low" }),
        candidate("c", { score: 0.2 }),
        candidate("d", { score: 0.1 }),
      ],
      policy: { maxCommentsPerCorner: 3, maxHumanPinsPerCorner: 4 },
      maxExtraSlots: 2,
    });
    expect(result.selected.map((entry) => entry.commentId)).toEqual(["a", "b", "c"]);
    expect(result.skipped).toContainEqual({ commentId: "low", reason: "low_relevance" });
  });

  it("defers pins beyond the base plus extra slots", () => {
    const pins = ["p1", "p2", "p3", "p4", "p5"].map((commentId) => ({ commentId }));
    const result = selectComments({
      pins,
      candidates: pins.map((pin, index) => candidate(pin.commentId, { score: 1 - index / 10 })),
      policy: { maxCommentsPerCorner: 2, maxHumanPinsPerCorner: 5 },
      maxExtraSlots: 1,
    });
    expect(result.selected.map((entry) => entry.commentId)).toEqual(["p1", "p2", "p3"]);
    expect(result.deferredPinIds).toEqual(["p4", "p5"]);
  });

  it("limits human pins per corner independently of base slots", () => {
    const pins = ["p1", "p2", "p3"].map((commentId) => ({ commentId }));
    const result = selectComments({
      pins,
      candidates: pins.map((pin) => candidate(pin.commentId, { score: 0.5 })),
      policy: { maxCommentsPerCorner: 4, maxHumanPinsPerCorner: 2 },
      maxExtraSlots: 2,
    });
    expect(result.selected.map((entry) => entry.commentId)).toEqual(["p1", "p2"]);
    expect(result.deferredPinIds).toEqual(["p3"]);
  });

  it("allows review only through a human pin and never allows block", () => {
    const result = selectComments({
      pins: [{ commentId: "review-pin" }, { commentId: "block-pin" }],
      candidates: [
        candidate("review-pin", { safety: "review" }),
        candidate("block-pin", { safety: "block" }),
        candidate("review-ai", { safety: "review", score: 0.9 }),
        candidate("block-ai", { safety: "block", score: 0.8 }),
      ],
      policy: POLICY,
      maxExtraSlots: 2,
    });
    expect(result.selected.map((entry) => entry.commentId)).toEqual(["review-pin"]);
    expect(result.skipped).toContainEqual({ commentId: "block-pin", reason: "safety_block" });
    expect(result.skipped).toContainEqual({
      commentId: "review-ai",
      reason: "review_without_pin",
    });
    expect(result.skipped).toContainEqual({ commentId: "block-ai", reason: "safety_block" });
  });

  it("deduplicates pins and never selects a pinned candidate as AI", () => {
    const result = selectComments({
      pins: [{ commentId: "p1" }, { commentId: "p1" }],
      candidates: [candidate("p1", { score: 0.2 }), candidate("a", { score: 0.7 })],
      policy: POLICY,
      maxExtraSlots: 2,
    });
    expect(result.selected.map((entry) => entry.commentId)).toEqual(["p1", "a"]);
    expect(result.skipped).toContainEqual({ commentId: "p1", reason: "duplicate" });
  });

  it("returns an empty selection for no candidates", () => {
    const result = selectComments({
      pins: [],
      candidates: [],
      policy: POLICY,
      maxExtraSlots: 2,
    });
    expect(result.selected).toEqual([]);
    expect(result.deferredPinIds).toEqual([]);
  });

  it("allows one or two comments as a short corner", () => {
    const result = selectComments({
      pins: [],
      candidates: [candidate("only", { score: 0.9 })],
      policy: POLICY,
      maxExtraSlots: 2,
    });
    expect(result.selected).toHaveLength(1);
  });

  it("uses freshness only for AI candidates and keeps old pins", () => {
    const freshness = new Map([
      ["old-ai", 900_000],
      ["old-pin", 900_000],
      ["new-ai", 1_000],
    ]);
    const result = selectComments({
      pins: [{ commentId: "old-pin" }],
      candidates: [
        candidate("old-ai", { score: 0.9 }),
        candidate("old-pin", { score: 0.1 }),
        candidate("new-ai", { score: 0.5 }),
      ],
      policy: POLICY,
      maxExtraSlots: 2,
      freshnessLimitMs: 600_000,
      freshnessMsById: freshness,
    });
    expect(result.selected.map((entry) => entry.commentId)).toEqual(["old-pin", "new-ai"]);
    expect(result.skipped).toContainEqual({ commentId: "old-ai", reason: "stale" });
  });

  it("excludes manually skipped comments", () => {
    const result = selectComments({
      pins: [{ commentId: "skipped-pin" }],
      candidates: [candidate("skipped-pin"), candidate("skipped-ai"), candidate("ok")],
      policy: POLICY,
      maxExtraSlots: 2,
      skippedIds: new Set(["skipped-pin", "skipped-ai"]),
    });
    expect(result.selected.map((entry) => entry.commentId)).toEqual(["ok"]);
    expect(result.skipped).toContainEqual({ commentId: "skipped-pin", reason: "skipped" });
  });
});
