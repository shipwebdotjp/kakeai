import type { SeekablePlayer } from "./player";

export interface PlaybackSnapshot {
  timeSeconds: number;
  paused: boolean;
  capturedAtMs: number;
}

/**
 * The player reports readiness through the `ready` event as well as the `ready`
 * property. A snapshot only means something once the first `ready` has fired.
 */
export function isPlayerReady(player: SeekablePlayer | null): player is SeekablePlayer {
  return player !== null && player.ready === true;
}

/**
 * Captures where the preview currently is and whether it was playing, so the
 * next composition document (a recompiled preview) can be put back there.
 * Returns null while the player is not ready yet: its time does not mean
 * anything before the first `ready`.
 */
export function capturePlayback(
  player: SeekablePlayer | null,
  nowMs: number,
): PlaybackSnapshot | null {
  if (!isPlayerReady(player)) {
    return null;
  }
  const time = player.currentTime;
  if (typeof time !== "number" || !Number.isFinite(time)) {
    return null;
  }
  // A player without a boolean `paused` is treated as paused: restoring a
  // position is always safe, whereas resuming unknown playback is not.
  const paused = typeof player.paused === "boolean" ? player.paused : true;
  return {
    timeSeconds: Math.max(0, time),
    paused,
    capturedAtMs: nowMs,
  };
}

/**
 * The position to seek to after the preview document was replaced. A paused
 * preview stays exactly where it was; a playing one keeps advancing by the time
 * the rebuild took, so playback looks continuous.
 */
export function playbackRestoreSeconds(
  snapshot: PlaybackSnapshot,
  nowMs: number,
  durationSeconds: number | undefined,
): number {
  const elapsed = snapshot.paused ? 0 : Math.max(0, nowMs - snapshot.capturedAtMs) / 1000;
  const max =
    typeof durationSeconds === "number" && Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : Number.POSITIVE_INFINITY;
  return Math.min(Math.max(0, snapshot.timeSeconds + elapsed), max);
}
