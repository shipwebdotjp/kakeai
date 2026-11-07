import type {
  CommentCandidate,
  CommentEvent,
  LiveCommentEntry,
  LiveCommentPolicy,
  LiveSegment,
} from "@kakeai/contracts";
import type { CommentFilterReason, FilteredComment } from "../comments/filter.ts";

export type CommentSegment = Extract<LiveSegment, { kind: "comment" }>;

export interface CornerEntry {
  event: CommentEvent;
  decision: LiveCommentEntry["decision"];
  reasons: CommentFilterReason[];
  redactedText: string;
  candidate: CommentCandidate | null;
  pinned: boolean;
  pinNote: string | null;
  state: LiveCommentEntry["state"];
  selected: boolean;
  analyzed: boolean;
}

const MAX_DISPLAY_TEXT = 500;
const FALLBACK_TEXT = "（内容を安全に表示できません）";

export function toFiltered(entry: CornerEntry): FilteredComment {
  return {
    event: entry.event,
    decision: entry.decision,
    reasons: entry.reasons,
    redactedText: entry.redactedText,
    blockedAuthor: false,
  };
}

export function clampText(value: string, fallback = FALLBACK_TEXT): string {
  const trimmed = value.trim();
  const text = trimmed.length === 0 ? fallback : trimmed;
  return text.length <= MAX_DISPLAY_TEXT ? text : `${text.slice(0, MAX_DISPLAY_TEXT - 1)}…`;
}

/**
 * Conservative candidate for a pinned comment whose analysis failed or that
 * was omitted from the batch. Only `redactedText` is used, so the safe text
 * contract holds without an analyser.
 */
export function conservativeCandidate(entry: CornerEntry, note: string | null): CommentCandidate {
  const safe = clampText(entry.redactedText);
  return {
    commentId: entry.event.id,
    score: 0.5,
    safety: "review",
    relevance: "medium",
    isQuestion: false,
    reason: "人間ピン",
    suggestedAngle: note ?? "ピンの意図に沿って短く触れる",
    safeSummary: safe,
    safeQuestion: safe,
    safeQuote: null,
    piiRedacted: true,
    urlsRemoved: true,
  };
}

export function freshnessOf(entry: CornerEntry, nowMs: number): number {
  const receivedAt = Date.parse(entry.event.receivedAt);
  if (Number.isNaN(receivedAt)) {
    return 0;
  }
  return Math.max(0, nowMs - receivedAt);
}

export function toPublicEntry(entry: CornerEntry, nowMs: number): LiveCommentEntry {
  return {
    comment: entry.event,
    decision: entry.decision,
    reasons: [...entry.reasons],
    redactedText: entry.redactedText,
    candidate: entry.candidate,
    pinned: entry.pinned,
    pinNote: entry.pinNote,
    selected: entry.selected,
    state: entry.state,
    freshnessMs: freshnessOf(entry, nowMs),
  };
}

export function effectiveCommentPolicy(
  policy: LiveCommentPolicy,
  segment: CommentSegment,
): LiveCommentPolicy {
  const override = segment.commentPolicy;
  return {
    ...policy,
    ...(override?.maxCommentsPerCorner === undefined
      ? {}
      : { maxCommentsPerCorner: override.maxCommentsPerCorner }),
    ...(override?.maxHumanPinsPerCorner === undefined
      ? {}
      : { maxHumanPinsPerCorner: override.maxHumanPinsPerCorner }),
    ...(override?.maxExtraSlots === undefined
      ? {}
      : { maxExtraSlots: override.maxExtraSlots }),
  };
}
