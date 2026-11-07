import { describe, expect, it } from "vitest";
import { fadeOutVolume, shouldFadeOut } from "./audio-fade.ts";

describe("fadeOutVolume", () => {
  it("stays full until the fade starts and reaches silence at the end", () => {
    expect(fadeOutVolume(-10)).toBe(1);
    expect(fadeOutVolume(0)).toBe(1);
    expect(fadeOutVolume(100)).toBeCloseTo(0.5);
    expect(fadeOutVolume(200)).toBe(0);
    expect(fadeOutVolume(500)).toBe(0);
  });

  it("accepts a custom duration", () => {
    expect(fadeOutVolume(50, 100)).toBeCloseTo(0.5);
    expect(fadeOutVolume(100, 100)).toBe(0);
    expect(fadeOutVolume(0, 0)).toBe(0);
  });
});

describe("shouldFadeOut", () => {
  it("fades on pause, post-show and when playback disappears", () => {
    expect(shouldFadeOut("paused", true)).toBe(true);
    expect(shouldFadeOut("post_show", false)).toBe(true);
    expect(shouldFadeOut("script", false)).toBe(true);
  });

  it("keeps the immediate stop for normal cue switches", () => {
    expect(shouldFadeOut("script", true)).toBe(false);
    expect(shouldFadeOut("safe_mode", true)).toBe(false);
  });
});
