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

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}
