import { describe, expect, it } from "vitest";
import { resolvePlaybackStart } from "./audio-start.ts";

describe("resolvePlaybackStart", () => {
  it("plays from the beginning when the stage is close to the cue start", () => {
    expect(resolvePlaybackStart(0, 1000)).toEqual({ action: "play", seekMs: 0 });
    expect(resolvePlaybackStart(299, 1000)).toEqual({ action: "play", seekMs: 0 });
  });

  it("seeks after 300ms so a reconnect resumes inside the cue", () => {
    expect(resolvePlaybackStart(300, 1000)).toEqual({ action: "play", seekMs: 300 });
    expect(resolvePlaybackStart(999, 1000)).toEqual({ action: "play", seekMs: 999 });
  });

  it("reports completion when the cue already ended while the stage was away", () => {
    expect(resolvePlaybackStart(1000, 1000)).toEqual({ action: "ended" });
    expect(resolvePlaybackStart(5000, 1000)).toEqual({ action: "ended" });
  });

  it("plays without a known duration and clamps invalid positions", () => {
    expect(resolvePlaybackStart(1200, null)).toEqual({ action: "play", seekMs: 1200 });
    expect(resolvePlaybackStart(-50, 1000)).toEqual({ action: "play", seekMs: 0 });
    expect(resolvePlaybackStart(Number.NaN, 1000)).toEqual({ action: "play", seekMs: 0 });
  });
});
