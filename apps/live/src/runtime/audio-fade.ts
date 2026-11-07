import type { StagePhase } from "@kakeai/contracts";

export const FADE_OUT_DURATION_MS = 200;

/**
 * Linear fade-out gain. Starts at 1 and reaches 0 at `durationMs`. Kept pure
 * so the stage fade can be tested without a media element.
 */
export function fadeOutVolume(elapsedMs: number, durationMs = FADE_OUT_DURATION_MS): number {
  if (durationMs <= 0) {
    return 0;
  }
  const progress = Math.min(1, Math.max(0, elapsedMs / durationMs));
  return 1 - progress;
}

/**
 * Pause, post-show and the disappearance of the current playback fade the
 * audio out. A normal cue switch keeps the immediate stop.
 */
export function shouldFadeOut(phase: StagePhase, hasPlayback: boolean): boolean {
  return phase === "paused" || phase === "post_show" || !hasPlayback;
}
