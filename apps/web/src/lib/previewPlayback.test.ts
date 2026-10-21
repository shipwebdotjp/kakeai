import { describe, expect, it } from "vitest";
import {
  capturePlayback,
  isPlayerReady,
  playbackRestoreSeconds,
  type PlaybackSnapshot,
} from "./previewPlayback";
import type { SeekablePlayer } from "./player";

function player(overrides: Partial<SeekablePlayer>): SeekablePlayer {
  return {
    currentTime: 0,
    duration: 30,
    paused: true,
    ready: true,
    ...overrides,
  } as unknown as SeekablePlayer;
}

describe("isPlayerReady", () => {
  it("only accepts an explicit ready", () => {
    expect(isPlayerReady(player({ ready: true }))).toBe(true);
    expect(isPlayerReady(player({ ready: false }))).toBe(false);
    expect(isPlayerReady(player({ ready: undefined }))).toBe(false);
    expect(isPlayerReady(null)).toBe(false);
  });
});

describe("capturePlayback", () => {
  it("keeps the current time and the paused state", () => {
    const snapshot = capturePlayback(player({ currentTime: 12.5, paused: true }), 1000);
    expect(snapshot).toEqual({ timeSeconds: 12.5, paused: true, capturedAtMs: 1000 });
  });

  it("treats a playing preview as not paused", () => {
    expect(capturePlayback(player({ currentTime: 3, paused: false }), 1000)?.paused).toBe(false);
  });

  it("returns null before the player is ready or without a finite time", () => {
    expect(capturePlayback(player({ ready: false }), 1000)).toBeNull();
    expect(capturePlayback(player({ currentTime: Number.NaN }), 1000)).toBeNull();
    expect(capturePlayback(null, 1000)).toBeNull();
  });

  it("treats an unknown play state as paused", () => {
    const snapshot = capturePlayback(
      player({ currentTime: 5, paused: undefined as unknown as boolean }),
      1000,
    );
    expect(snapshot?.paused).toBe(true);
  });
});

describe("playbackRestoreSeconds", () => {
  const paused: PlaybackSnapshot = { timeSeconds: 8, paused: true, capturedAtMs: 1000 };
  const playing: PlaybackSnapshot = { timeSeconds: 8, paused: false, capturedAtMs: 1000 };

  it("returns the same position for a paused preview", () => {
    expect(playbackRestoreSeconds(paused, 9000, 30)).toBe(8);
  });

  it("advances a playing preview by the rebuild time", () => {
    expect(playbackRestoreSeconds(playing, 1500, 30)).toBe(8.5);
  });

  it("clamps into the new composition's duration", () => {
    expect(playbackRestoreSeconds(playing, 100000, 10)).toBe(10);
    expect(playbackRestoreSeconds({ ...paused, timeSeconds: 40 }, 1000, 10)).toBe(10);
    expect(playbackRestoreSeconds({ ...paused, timeSeconds: -4 }, 1000, 10)).toBe(0);
  });

  it("does not clamp when the duration is unknown", () => {
    expect(playbackRestoreSeconds({ ...paused, timeSeconds: 40 }, 1000, undefined)).toBe(40);
  });
});
