import type { LiveCue } from "@kakeai/contracts";

export interface SegmentBufferInput {
  /** The current segment queue, in play order. */
  cues: readonly LiveCue[];
  /** Index of the playing/current cue; -1 when the queue has not started. */
  currentIndex: number;
  /** Remaining duration of the current cue, or 0 when nothing is playing. */
  currentRemainingMs: number;
  minBufferMs: number;
  hasFallback: boolean;
}

export interface SegmentBufferEstimate {
  /** Ready audio left in this segment, including the rest of the current cue. */
  remainingMs: number;
  /** Number of upcoming ready cues that contribute to `remainingMs`. */
  readyCueCount: number;
  /** The controller may switch to a fallback cue before the buffer runs out. */
  needsFallback: boolean;
}

/**
 * Estimates how much ready audio remains in the current segment. Cues that
 * are still preparing or have no audio do not count; the playout handles them
 * with the bounded `maxThinkingMs` wait instead.
 */
export function estimateSegmentBuffer(input: SegmentBufferInput): SegmentBufferEstimate {
  let remainingMs = Math.max(0, input.currentRemainingMs);
  let readyCueCount = 0;
  const start = input.currentIndex < 0 ? 0 : input.currentIndex + 1;
  for (let index = start; index < input.cues.length; index += 1) {
    const cue = input.cues[index];
    if (
      cue === undefined ||
      cue.status !== "ready" ||
      cue.audio === null ||
      cue.durationMs === null
    ) {
      continue;
    }
    remainingMs += cue.durationMs;
    readyCueCount += 1;
  }
  return {
    remainingMs,
    readyCueCount,
    needsFallback: remainingMs < input.minBufferMs && input.hasFallback,
  };
}
