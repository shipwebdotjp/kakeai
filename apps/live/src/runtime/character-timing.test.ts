import { describe, expect, it } from "vitest";
import { blinkTiming, mouthTiming } from "./character-timing.ts";

describe("character timing", () => {
  it("keeps blink intervals at 3–6s and closed eyes at 100–150ms", () => {
    for (const seed of ["left", "right", "char-left", "char-右"]) {
      const timing = blinkTiming(seed);
      expect(timing.intervalMs).toBeGreaterThanOrEqual(3000);
      expect(timing.intervalMs).toBeLessThanOrEqual(6000);
      expect(timing.durationMs).toBeGreaterThanOrEqual(100);
      expect(timing.durationMs).toBeLessThanOrEqual(150);
      expect(blinkTiming(seed)).toEqual(timing);
    }
  });

  it("keeps the mouth frame interval at 100–140ms", () => {
    for (const seed of ["left", "right", "generated"]) {
      const timing = mouthTiming(seed);
      expect(timing.intervalMs).toBeGreaterThanOrEqual(100);
      expect(timing.intervalMs).toBeLessThanOrEqual(140);
      expect(mouthTiming(seed)).toEqual(timing);
    }
  });
});
