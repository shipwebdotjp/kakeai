import type { CommentCandidate, LiveCommentPolicy } from "@kakeai/contracts";
import { selectComments, type CommentPin } from "../comments/selection.ts";
import type { CommentAnalyst } from "../llm/comment-analyst.ts";
import type { RunLogEventInput } from "../runs/run-store.ts";
import type { CornerEntry, CommentSegment } from "./comment-corner-model.ts";
import {
  conservativeCandidate,
  effectiveCommentPolicy,
  freshnessOf,
  toFiltered,
} from "./comment-corner-model.ts";

export interface CornerCollectorOptions {
  entries: Map<string, CornerEntry>;
  skippedIds: ReadonlySet<string>;
  analyst: CommentAnalyst | null;
  policy: LiveCommentPolicy;
  now: () => Date;
  log: (input: RunLogEventInput) => void;
  appendComment: (entry: Record<string, unknown>) => void;
  notice?: (message: string) => void;
  isCurrent: () => boolean;
}

export interface CornerPlan {
  selected: CommentCandidate[];
  deferredPinIds: string[];
  skippedCount: number;
  baseSlots: number;
}

/**
 * Analyses fresh comments and produces the selected cards. Mutates entry
 * states so the console can show candidate/selected/deferred rows. Returns
 * null when the corner was interrupted while waiting for the analyst.
 */
export async function collectCornerPlan(
  segment: CommentSegment,
  options: CornerCollectorOptions,
): Promise<CornerPlan | null> {
  const freshnessLimitMs = options.policy.freshnessMin * 60_000;
  const batch = [...options.entries.values()].filter(
    (entry) =>
      !entry.analyzed &&
      !options.skippedIds.has(entry.event.id) &&
      (entry.decision === "accepted" || entry.decision === "review") &&
      freshnessOf(entry, options.now().getTime()) <= freshnessLimitMs,
  );

  if (batch.length > 0) {
    if (options.analyst !== null) {
      try {
        const analysis = await options.analyst.analyze(batch.map(toFiltered));
        if (!options.isCurrent()) {
          return null;
        }
        applyAnalysis(batch, analysis.comments, options);
      } catch (error) {
        if (!options.isCurrent()) {
          return null;
        }
        handleAnalysisFailure(error, options);
      }
    } else {
      handleAnalysisFailure(new Error("コメント分析役が設定されていません。"), options);
    }
  }

  if (!options.isCurrent()) {
    return null;
  }
  createPinnedFallbacks(options.entries, options.skippedIds);
  if (!options.isCurrent()) {
    return null;
  }

  const effective = effectiveCommentPolicy(options.policy, segment);
  const freshnessMsById = new Map<string, number>();
  for (const entry of options.entries.values()) {
    freshnessMsById.set(entry.event.id, freshnessOf(entry, options.now().getTime()));
  }
  const pins: CommentPin[] = [...options.entries.values()]
    .filter((entry) => entry.pinned && !options.skippedIds.has(entry.event.id))
    .map((entry) => ({
      commentId: entry.event.id,
      ...(entry.pinNote === null ? {} : { note: entry.pinNote }),
    }));
  const candidates = [...options.entries.values()]
    .map((entry) => entry.candidate)
    .filter((candidate): candidate is CommentCandidate => candidate !== null);

  const result = selectComments({
    pins,
    candidates,
    policy: effective,
    maxExtraSlots: effective.maxExtraSlots,
    freshnessLimitMs,
    freshnessMsById,
    skippedIds: options.skippedIds,
  });

  for (const entry of options.entries.values()) {
    if (entry.state === "candidate") {
      entry.state = "received";
      entry.selected = false;
    }
  }
  for (const commentId of result.deferredPinIds) {
    const entry = options.entries.get(commentId);
    if (entry !== undefined) {
      entry.state = "deferred";
    }
  }
  for (const candidate of result.selected) {
    const entry = options.entries.get(candidate.commentId);
    if (entry !== undefined) {
      entry.state = "selected";
      entry.selected = true;
    }
  }

  for (const [index, candidate] of result.selected.entries()) {
    const entry = options.entries.get(candidate.commentId);
    const pinned = entry?.pinned === true;
    options.log({
      type: "comment_selected",
      commentId: candidate.commentId,
      data: { index, pinned, score: candidate.score },
    });
    options.appendComment({
      event: "selected",
      commentId: candidate.commentId,
      redactedText: entry?.redactedText ?? "",
      score: candidate.score,
      safety: candidate.safety,
      relevance: candidate.relevance,
      pinned,
    });
  }

  return {
    selected: result.selected,
    deferredPinIds: result.deferredPinIds,
    skippedCount: result.skipped.length,
    baseSlots: effective.maxCommentsPerCorner,
  };
}

function applyAnalysis(
  batch: CornerEntry[],
  candidates: readonly CommentCandidate[],
  options: CornerCollectorOptions,
): void {
  const byId = new Map(candidates.map((candidate) => [candidate.commentId, candidate]));
  for (const entry of batch) {
    entry.analyzed = true;
    const candidate = byId.get(entry.event.id);
    if (candidate === undefined) {
      continue;
    }
    entry.candidate = candidate;
    entry.state = candidate.safety === "block" ? "blocked" : "candidate";
    if (candidate.safety === "block" && entry.pinned) {
      entry.pinned = false;
      entry.pinNote = null;
      options.log({
        type: "pin_removed",
        commentId: entry.event.id,
        data: { reason: "blocked" },
      });
    }
    options.appendComment({
      event: "analyzed",
      commentId: entry.event.id,
      redactedText: entry.redactedText,
      decision: entry.decision,
      reasons: entry.reasons,
      score: candidate.score,
      safety: candidate.safety,
      relevance: candidate.relevance,
    });
  }
}

function handleAnalysisFailure(
  error: unknown,
  options: CornerCollectorOptions,
): void {
  const message = error instanceof Error ? error.message : "コメント分析に失敗しました。";
  options.log({ type: "error", data: { message } });
  options.notice?.("コメント分析に失敗しました。ピンだけでコーナーを続けます。");
}

function createPinnedFallbacks(
  entries: Map<string, CornerEntry>,
  skippedIds: ReadonlySet<string>,
): void {
  for (const entry of entries.values()) {
    if (
      !entry.pinned ||
      skippedIds.has(entry.event.id) ||
      entry.decision === "blocked" ||
      entry.candidate?.safety === "block"
    ) {
      continue;
    }
    if (entry.candidate === null) {
      entry.candidate = conservativeCandidate(entry, entry.pinNote);
      entry.state = "candidate";
    }
  }
}
