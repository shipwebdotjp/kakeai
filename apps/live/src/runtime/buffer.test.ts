import type { LiveCue } from "@kakeai/contracts";
import { describe, expect, it } from "vitest";
import { estimateSegmentBuffer } from "./buffer.ts";

function cue(
  id: string,
  overrides: Partial<LiveCue> = {},
): LiveCue {
  return {
    id,
    origin: "live",
    speaker: "left",
    caption: id,
    speech: id,
    expression: "normal",
    audio: `audio/prepared/${id}.wav`,
    durationMs: 10_000,
    source: "prepared",
    status: "ready",
    commentId: null,
    ...overrides,
  };
}

describe("estimateSegmentBuffer", () => {
  it("sums the rest of the current cue and upcoming ready cues", () => {
    const estimate = estimateSegmentBuffer({
      cues: [
        cue("a", { status: "playing", durationMs: 10_000 }),
        cue("b", { durationMs: 20_000 }),
        cue("c", { durationMs: 30_000 }),
      ],
      currentIndex: 0,
      currentRemainingMs: 4000,
      minBufferMs: 10_000,
      hasFallback: false,
    });
    expect(estimate.remainingMs).toBe(54_000);
    expect(estimate.readyCueCount).toBe(2);
    expect(estimate.needsFallback).toBe(false);
  });

  it("ignores preparing, audio-less and terminal cues", () => {
    const estimate = estimateSegmentBuffer({
      cues: [
        cue("a", { status: "playing", durationMs: 5000 }),
        cue("b", { status: "preparing", audio: null, durationMs: 15_000 }),
        cue("c", { status: "ready", audio: null, durationMs: 15_000 }),
        cue("d", { status: "skipped", durationMs: 15_000 }),
        cue("e", { status: "ready", durationMs: 3000 }),
        cue("f", { status: "ready", durationMs: null }),
      ],
      currentIndex: 0,
      currentRemainingMs: 2000,
      minBufferMs: 10_000,
      hasFallback: true,
    });
    expect(estimate.remainingMs).toBe(5000);
    expect(estimate.readyCueCount).toBe(1);
    expect(estimate.needsFallback).toBe(true);
  });

  it("counts the whole segment before playback starts", () => {
    const estimate = estimateSegmentBuffer({
      cues: [cue("a", { durationMs: 4000 }), cue("b", { durationMs: 6000 })],
      currentIndex: -1,
      currentRemainingMs: 0,
      minBufferMs: 10_000,
      hasFallback: true,
    });
    expect(estimate.remainingMs).toBe(10_000);
    expect(estimate.needsFallback).toBe(false);
  });

  it("only asks for a fallback when one exists", () => {
    const estimate = estimateSegmentBuffer({
      cues: [cue("a", { status: "playing", durationMs: 1000 })],
      currentIndex: 0,
      currentRemainingMs: 1000,
      minBufferMs: 10_000,
      hasFallback: false,
    });
    expect(estimate.needsFallback).toBe(false);
  });
});
