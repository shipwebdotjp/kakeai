export interface SeekablePlayer extends HTMLElement {
  seek?: (timeInSeconds: number) => void;
  play?: () => void | Promise<void>;
  pause?: () => void;
  readonly currentTime?: number;
  readonly duration?: number;
  readonly paused?: boolean;
}

export function asSeekablePlayer(element: HTMLElement | null): SeekablePlayer | null {
  return element === null ? null : (element as SeekablePlayer);
}

export function seekTo(player: SeekablePlayer | null, timeInSeconds: number): void {
  if (player?.seek === undefined) {
    return;
  }
  const duration = player.duration;
  const max = typeof duration === "number" && Number.isFinite(duration) ? duration : timeInSeconds;
  player.seek(Math.min(Math.max(0, timeInSeconds), Math.max(0, max)));
}

export const DEFAULT_OUTPUT_FPS = 30;

export function normalizeOutputFps(fps: number | undefined): number {
  return typeof fps === "number" && fps > 0 && Number.isFinite(fps)
    ? fps
    : DEFAULT_OUTPUT_FPS;
}

export function frameStepSeconds(fps: number): number {
  return 1 / normalizeOutputFps(fps);
}

export function clampPreviewTime(timeInSeconds: number, totalDurationMs: number): number {
  const max = Math.max(0, totalDurationMs / 1000);
  if (!Number.isFinite(timeInSeconds)) {
    return 0;
  }
  return Math.min(Math.max(0, timeInSeconds), max);
}

export function semanticSeekTarget(
  startMs: number,
  totalDurationMs: number,
  fps: number,
): number {
  return clampPreviewTime(startMs / 1000 + frameStepSeconds(fps), totalDurationMs);
}

export function isPlaying(player: SeekablePlayer | null): boolean {
  return player?.paused === false;
}

export function applyMove(player: SeekablePlayer | null, timeInSeconds: number): void {
  if (player === null || typeof player.seek !== "function") {
    return;
  }
  const wasPlaying = isPlaying(player);
  player.seek(timeInSeconds);
  if (wasPlaying) {
    Promise.resolve(player.play?.()).catch(() => {
      // playback can be rejected before the user interacts with the page
    });
  }
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}
