import type { CommentCandidate, LiveCommentPolicy } from "@kakeai/contracts";

export interface CommentPin {
  commentId: string;
  note?: string;
}

export interface CommentSelectionInput {
  pins: readonly CommentPin[];
  candidates: readonly CommentCandidate[];
  /** The corner-level defaults; a segment may override these before calling. */
  policy: Pick<LiveCommentPolicy, "maxCommentsPerCorner" | "maxHumanPinsPerCorner">;
  /** Extension slots available only for human pins. */
  maxExtraSlots: number;
  /**
   * Freshness is checked only for AI candidates. A human pin is always kept
   * even when the comment is old; the operator can attach context to it.
   */
  freshnessLimitMs?: number;
  freshnessMsById?: ReadonlyMap<string, number>;
  /** Comments the operator skipped for the rest of the run. */
  skippedIds?: ReadonlySet<string>;
}

export interface CommentSelectionSkip {
  commentId: string;
  reason:
    | "safety_block"
    | "review_without_pin"
    | "low_relevance"
    | "stale"
    | "skipped"
    | "no_candidate"
    | "pin_limit"
    | "pin_overflow"
    | "duplicate";
}

export interface CommentSelectionResult {
  selected: CommentCandidate[];
  deferredPinIds: string[];
  skipped: CommentSelectionSkip[];
}

/**
 * Pure corner selection. Human pins consume slots before AI candidates and may
 * extend the corner up to `maxExtraSlots`. AI candidates only fill the base
 * slots, highest score first. Safety `block` is never selectable, and safety
 * `review` is selectable only through a human pin.
 */
export function selectComments(input: CommentSelectionInput): CommentSelectionResult {
  const maxBase = Math.max(0, Math.floor(input.policy.maxCommentsPerCorner));
  const maxPins = Math.max(0, Math.floor(input.policy.maxHumanPinsPerCorner));
  const maxExtras = Math.max(0, Math.floor(input.maxExtraSlots));
  const maxTotal = maxBase + maxExtras;
  const candidateById = new Map(input.candidates.map((candidate) => [candidate.commentId, candidate]));
  const skippedIds = input.skippedIds ?? new Set<string>();
  const selected: CommentCandidate[] = [];
  const selectedIds = new Set<string>();
  const seenPins = new Set<string>();
  const pinnedIds = new Set<string>();
  const deferredPinIds: string[] = [];
  const skipped: CommentSelectionSkip[] = [];
  let pinCount = 0;

  const reject = (commentId: string, reason: CommentSelectionSkip["reason"]): void => {
    skipped.push({ commentId, reason });
  };

  for (const pin of input.pins) {
    if (seenPins.has(pin.commentId)) {
      reject(pin.commentId, "duplicate");
      continue;
    }
    seenPins.add(pin.commentId);
    pinnedIds.add(pin.commentId);

    if (skippedIds.has(pin.commentId)) {
      reject(pin.commentId, "skipped");
      continue;
    }
    const candidate = candidateById.get(pin.commentId);
    if (candidate === undefined) {
      reject(pin.commentId, "no_candidate");
      continue;
    }
    if (candidate.safety === "block") {
      reject(pin.commentId, "safety_block");
      continue;
    }
    if (pinCount >= maxPins || selected.length >= maxTotal) {
      deferredPinIds.push(pin.commentId);
      reject(pin.commentId, pinCount >= maxPins ? "pin_limit" : "pin_overflow");
      continue;
    }
    selected.push(candidate);
    selectedIds.add(candidate.commentId);
    pinCount += 1;
  }

  const aiCandidates = input.candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => {
      if (selectedIds.has(candidate.commentId) || pinnedIds.has(candidate.commentId)) {
        return false;
      }
      if (skippedIds.has(candidate.commentId)) {
        reject(candidate.commentId, "skipped");
        return false;
      }
      if (candidate.safety === "block") {
        reject(candidate.commentId, "safety_block");
        return false;
      }
      if (candidate.safety === "review") {
        reject(candidate.commentId, "review_without_pin");
        return false;
      }
      if (candidate.relevance === "low") {
        reject(candidate.commentId, "low_relevance");
        return false;
      }
      if (
        input.freshnessLimitMs !== undefined &&
        input.freshnessMsById !== undefined &&
        (input.freshnessMsById.get(candidate.commentId) ?? 0) > input.freshnessLimitMs
      ) {
        reject(candidate.commentId, "stale");
        return false;
      }
      return true;
    })
    .sort((left, right) =>
      right.candidate.score === left.candidate.score
        ? left.index - right.index
        : right.candidate.score - left.candidate.score,
    );

  for (const { candidate } of aiCandidates) {
    if (selected.length >= maxBase) {
      break;
    }
    if (selectedIds.has(candidate.commentId)) {
      reject(candidate.commentId, "duplicate");
      continue;
    }
    selected.push(candidate);
    selectedIds.add(candidate.commentId);
  }

  return { selected, deferredPinIds, skipped };
}
