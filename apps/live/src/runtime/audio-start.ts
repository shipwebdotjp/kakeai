/** A short restart should not audibly jump; only seek when the gap is clear. */
export const PLAYBACK_SEEK_THRESHOLD_MS = 300;

export type PlaybackStartDecision =
  | { action: "play"; seekMs: number }
  | { action: "ended" };

/**
 * Decides how a stage starts a playback instruction. The server sends
 * `startedAt`, so a reconnect can resume inside the cue. If the cue already
 * ended while the stage was away, the stage reports completion instead of
 * replaying it from the top.
 */
export function resolvePlaybackStart(
  positionMs: number,
  durationMs: number | null,
): PlaybackStartDecision {
  const position = Number.isFinite(positionMs) ? Math.max(0, positionMs) : 0;
  if (
    durationMs !== null &&
    Number.isFinite(durationMs) &&
    durationMs >= 0 &&
    position >= durationMs
  ) {
    return { action: "ended" };
  }
  return {
    action: "play",
    seekMs: position >= PLAYBACK_SEEK_THRESHOLD_MS ? position : 0,
  };
}
