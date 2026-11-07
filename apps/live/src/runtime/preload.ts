import type { LiveCue, LivePreloadCue } from "@kakeai/contracts";

const MAX_PRELOAD_CUES = 2;

/**
 * Collects the next ready cues with audio: first the rest of the current
 * segment, then later segments so a boundary does not produce a gap.
 */
export function collectPreloadCues(
  queue: readonly LiveCue[],
  currentIndex: number,
  followingCues: readonly LiveCue[],
): LivePreloadCue[] {
  const result: LivePreloadCue[] = [];
  const consider = (cue: LiveCue): boolean => {
    if (cue.status !== "ready" || cue.audio === null) {
      return false;
    }
    result.push({ cueId: cue.id, audioUrl: cue.audio });
    return result.length >= MAX_PRELOAD_CUES;
  };
  for (let position = currentIndex + 1; position < queue.length; position += 1) {
    const cue = queue[position];
    if (cue !== undefined && consider(cue)) {
      return result;
    }
  }
  for (const cue of followingCues) {
    if (consider(cue)) {
      return result;
    }
  }
  return result;
}
