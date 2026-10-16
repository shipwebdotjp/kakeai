import { describe, expect, it } from "vitest";
import {
  appearEffectSchema,
  cueEffectSchema,
  emphasizeEffectSchema,
  lineTriggerSchema,
  timedEffectSchema,
} from "./cue-effect";
import { tableToneSchema } from "./tone";

describe("lineTriggerSchema", () => {
  it("accepts a line range and the cue window", () => {
    expect(
      lineTriggerSchema.safeParse({ kind: "lines", startLineId: "l1", endLineId: "l2" }).success,
    ).toBe(true);
    expect(lineTriggerSchema.safeParse({ kind: "cue" }).success).toBe(true);
  });

  it("rejects unknown kinds and malformed ranges", () => {
    expect(lineTriggerSchema.safeParse({ kind: "offset", startMs: 0, endMs: 1 }).success).toBe(
      false,
    );
    expect(lineTriggerSchema.safeParse({ kind: "lines", startLineId: "l1" }).success).toBe(false);
    expect(
      lineTriggerSchema.safeParse({ kind: "lines", startLineId: "l1", endLineId: "l2", x: 1 })
        .success,
    ).toBe(false);
  });
});

describe("appearEffectSchema", () => {
  it("accepts a preset, duration, and optional stagger", () => {
    expect(appearEffectSchema.safeParse({ kind: "appear", preset: "fade", durationMs: 400 }).success).toBe(
      true,
    );
    expect(
      appearEffectSchema.safeParse({
        kind: "appear",
        preset: "slide-up",
        durationMs: 400,
        staggerMs: 150,
      }).success,
    ).toBe(true);
  });

  it("rejects none, unknown presets, and invalid durations", () => {
    expect(appearEffectSchema.safeParse({ kind: "appear", preset: "none", durationMs: 0 }).success).toBe(
      false,
    );
    expect(
      appearEffectSchema.safeParse({ kind: "appear", preset: "fade", durationMs: -1 }).success,
    ).toBe(false);
    expect(
      appearEffectSchema.safeParse({ kind: "appear", preset: "fade", durationMs: 400, extra: 1 })
        .success,
    ).toBe(false);
  });
});

describe("emphasizeEffectSchema", () => {
  it("accepts the tone vocabulary shared with tables", () => {
    expect(
      emphasizeEffectSchema.safeParse({ kind: "emphasize", style: "frame", tone: "primary" }).success,
    ).toBe(true);
    expect(tableToneSchema.safeParse("warning").success).toBe(true);
  });

  it("rejects unknown styles and tones", () => {
    expect(
      emphasizeEffectSchema.safeParse({ kind: "emphasize", style: "glow", tone: "primary" }).success,
    ).toBe(false);
    expect(
      emphasizeEffectSchema.safeParse({ kind: "emphasize", style: "frame", tone: "brand" }).success,
    ).toBe(false);
  });
});

describe("timedEffectSchema", () => {
  it("accepts a trigger paired with either effect", () => {
    expect(
      timedEffectSchema.safeParse({
        trigger: { kind: "cue" },
        effect: { kind: "appear", preset: "scale-in", durationMs: 300 },
      }).success,
    ).toBe(true);
    expect(
      timedEffectSchema.safeParse({
        trigger: { kind: "lines", startLineId: "l1", endLineId: "l3" },
        effect: { kind: "emphasize", style: "background", tone: "secondary" },
      }).success,
    ).toBe(true);
  });

  it("rejects a missing effect and unknown keys", () => {
    expect(timedEffectSchema.safeParse({ trigger: { kind: "cue" } }).success).toBe(false);
    expect(
      timedEffectSchema.safeParse({
        trigger: { kind: "cue" },
        effect: { kind: "emphasize", style: "frame", tone: "primary" },
        extra: true,
      }).success,
    ).toBe(false);
  });
});

describe("cueEffectSchema", () => {
  it("rejects an effect without a known kind", () => {
    expect(cueEffectSchema.safeParse({ kind: "pulse" }).success).toBe(false);
  });
});
