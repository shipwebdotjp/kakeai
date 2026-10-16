import { describe, expect, it } from "vitest";
import {
  appearEffectSchema,
  cueEffectSchema,
  emphasizeEffectSchema,
  lineTriggerSchema,
  numericEffectSchema,
  onsetSpecSchema,
  timedEffectSchema,
  valueEffectSchema,
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

  it("accepts spotlight and an optional onset", () => {
    expect(
      emphasizeEffectSchema.safeParse({ kind: "emphasize", style: "spotlight", tone: "info" }).success,
    ).toBe(true);
    expect(
      emphasizeEffectSchema.safeParse({
        kind: "emphasize",
        style: "frame",
        tone: "primary",
        onset: { preset: "sweep", durationMs: 600 },
      }).success,
    ).toBe(true);
  });

  it("rejects unknown styles, tones, and onset presets", () => {
    expect(
      emphasizeEffectSchema.safeParse({ kind: "emphasize", style: "glow", tone: "primary" }).success,
    ).toBe(false);
    expect(
      emphasizeEffectSchema.safeParse({ kind: "emphasize", style: "frame", tone: "brand" }).success,
    ).toBe(false);
    expect(
      emphasizeEffectSchema.safeParse({
        kind: "emphasize",
        style: "frame",
        tone: "primary",
        onset: { preset: "spin", durationMs: 600 },
      }).success,
    ).toBe(false);
    expect(
      emphasizeEffectSchema.safeParse({
        kind: "emphasize",
        style: "frame",
        tone: "primary",
        onset: { preset: "sweep", durationMs: 600, extra: 1 },
      }).success,
    ).toBe(false);
  });
});

describe("valueEffectSchema", () => {
  it("accepts an optional from and duration", () => {
    expect(valueEffectSchema.safeParse({ kind: "value" }).success).toBe(true);
    expect(
      valueEffectSchema.safeParse({ kind: "value", from: 10, durationMs: 800 }).success,
    ).toBe(true);
  });

  it("rejects unknown keys and negative durations", () => {
    expect(valueEffectSchema.safeParse({ kind: "value", extra: 1 }).success).toBe(false);
    expect(valueEffectSchema.safeParse({ kind: "value", durationMs: -1 }).success).toBe(false);
  });

  it("is part of the numeric effect union but not the base cue effect union", () => {
    expect(numericEffectSchema.safeParse({ kind: "value" }).success).toBe(true);
    expect(
      numericEffectSchema.safeParse({ kind: "appear", preset: "fade", durationMs: 100 }).success,
    ).toBe(true);
    expect(cueEffectSchema.safeParse({ kind: "value" }).success).toBe(false);
  });
});

describe("onsetSpecSchema", () => {
  it("accepts the onset vocabulary with a duration", () => {
    for (const preset of ["sweep", "flash", "pop"]) {
      expect(onsetSpecSchema.safeParse({ preset, durationMs: 500 }).success).toBe(true);
    }
  });

  it("rejects unknown presets, negative durations, and missing durations", () => {
    expect(onsetSpecSchema.safeParse({ preset: "sweep", durationMs: -1 }).success).toBe(false);
    expect(onsetSpecSchema.safeParse({ preset: "sweep" }).success).toBe(false);
    expect(onsetSpecSchema.safeParse({ preset: "unknown", durationMs: 500 }).success).toBe(false);
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
