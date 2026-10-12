import { describe, expect, it, vi } from "vitest";
import {
  applyMove,
  clampPreviewTime,
  frameStepSeconds,
  semanticSeekTarget,
  type SeekablePlayer,
} from "./player";

function stubPlayer(paused: boolean): {
  player: SeekablePlayer;
  calls: { seeked: number[]; played: number };
} {
  const calls = { seeked: [] as number[], played: 0 };
  const player = {
    paused,
    seek: (timeInSeconds: number) => {
      calls.seeked.push(timeInSeconds);
    },
    play: () => {
      calls.played += 1;
      return Promise.resolve();
    },
    pause: () => {},
  } as unknown as SeekablePlayer;
  return { player, calls };
}

describe("frameStepSeconds", () => {
  it("returns one frame from fps and falls back to 30", () => {
    expect(frameStepSeconds(30)).toBeCloseTo(1 / 30, 10);
    expect(frameStepSeconds(60)).toBeCloseTo(1 / 60, 10);
    expect(frameStepSeconds(0)).toBeCloseTo(1 / 30, 10);
    expect(frameStepSeconds(Number.NaN)).toBeCloseTo(1 / 30, 10);
  });
});

describe("clampPreviewTime", () => {
  it("clamps out-of-range times to the total duration", () => {
    expect(clampPreviewTime(-1, 9000)).toBe(0);
    expect(clampPreviewTime(9.5, 9000)).toBe(9);
    expect(clampPreviewTime(4.2, 9000)).toBe(4.2);
  });
});

describe("semanticSeekTarget", () => {
  it("adds one output frame after the start", () => {
    expect(semanticSeekTarget(0, 9000, 30)).toBeCloseTo(1 / 30, 10);
    expect(semanticSeekTarget(500, 9000, 30)).toBeCloseTo(0.5 + 1 / 30, 10);
  });

  it("rounds down to the total duration", () => {
    expect(semanticSeekTarget(9000, 9000, 30)).toBe(9);
    expect(semanticSeekTarget(12000, 9000, 30)).toBe(9);
  });
});

describe("applyMove", () => {
  it("keeps a stopped player stopped after seek", () => {
    const { player, calls } = stubPlayer(true);
    applyMove(player, 2.5);
    expect(calls.seeked).toEqual([2.5]);
    expect(calls.played).toBe(0);
  });

  it("resumes a playing player after seek", async () => {
    const { player, calls } = stubPlayer(false);
    applyMove(player, 2.5);
    expect(calls.seeked).toEqual([2.5]);
    await Promise.resolve();
    expect(calls.played).toBe(1);
  });

  it("ignores a missing player or seek implementation", () => {
    const play = vi.fn();
    applyMove(null, 1);
    applyMove({ play } as unknown as SeekablePlayer, 1);
    expect(play).not.toHaveBeenCalled();
  });
});
