import { describe, expect, it } from "vitest";
import { CompositionCompileError } from "./compile-error";
import { planAppearEffect, resolveTriggerWindow } from "./cue-effects";
import type { LineInterval } from "./render-context";

const intervals: LineInterval[] = [
  { lineId: "l1", startMs: 500, endMs: 1500 },
  { lineId: "l2", startMs: 1500, endMs: 2500 },
  { lineId: "l3", startMs: 2500, endMs: 4000 },
];

const path = ["scenes", 0, "visualCues", 0, "input"];

describe("resolveTriggerWindow", () => {
  it("resolves the cue window to the whole span", () => {
    expect(resolveTriggerWindow({ kind: "cue" }, intervals, 9000, path)).toEqual({
      startMs: 0,
      endMs: 9000,
    });
  });

  it("resolves a line range to its interval", () => {
    expect(
      resolveTriggerWindow({ kind: "lines", startLineId: "l1", endLineId: "l2" }, intervals, 9000, path),
    ).toEqual({ startMs: 500, endMs: 2500 });
  });

  it("clamps the window to the cue span", () => {
    expect(
      resolveTriggerWindow({ kind: "lines", startLineId: "l2", endLineId: "l3" }, intervals, 1800, path),
    ).toEqual({ startMs: 1500, endMs: 1800 });
  });

  it("returns null for a reversed or clamped-empty range", () => {
    expect(
      resolveTriggerWindow({ kind: "lines", startLineId: "l3", endLineId: "l1" }, intervals, 9000, path),
    ).toBeNull();
    expect(
      resolveTriggerWindow({ kind: "lines", startLineId: "l3", endLineId: "l3" }, [{ lineId: "l3", startMs: 2500, endMs: 2500 }], 9000, path),
    ).toBeNull();
    expect(resolveTriggerWindow({ kind: "cue" }, intervals, 0, path)).toBeNull();
  });

  it("throws when a referenced line is missing", () => {
    expect(() =>
      resolveTriggerWindow({ kind: "lines", startLineId: "missing", endLineId: "l2" }, intervals, 9000, path),
    ).toThrow(CompositionCompileError);
  });
});

describe("planAppearEffect", () => {
  it("staggers appearance and hides later targets until their turn", () => {
    const plan = planAppearEffect({
      targets: [
        { id: "a", step: 0 },
        { id: "b", step: 1 },
        { id: "c", step: 2 },
      ],
      trigger: { kind: "cue" },
      effect: { kind: "appear", preset: "fade", durationMs: 400, staggerMs: 200 },
      lineIntervals: intervals,
      spanMs: 9000,
      path,
    });
    expect(plan.animation).toEqual([
      { targetId: "a", action: "fade", startMs: 0, durationMs: 400 },
      { targetId: "b", action: "fade", startMs: 200, durationMs: 400 },
      { targetId: "c", action: "fade", startMs: 400, durationMs: 400 },
    ]);
    expect(plan.stateIntervals).toEqual([
      { targetId: "b", intervals: [{ startMs: 0, endMs: 200 }], on: { opacity: 0 }, off: { opacity: 1 } },
      { targetId: "c", intervals: [{ startMs: 0, endMs: 400 }], on: { opacity: 0 }, off: { opacity: 1 } },
    ]);
  });

  it("starts a line-triggered appearance at the line and hides until then", () => {
    const plan = planAppearEffect({
      targets: [{ id: "a", step: 0 }],
      trigger: { kind: "lines", startLineId: "l2", endLineId: "l2" },
      effect: { kind: "appear", preset: "slide-up", durationMs: 300 },
      lineIntervals: intervals,
      spanMs: 9000,
      path,
    });
    expect(plan.animation).toEqual([
      { targetId: "a", action: "slide-up", startMs: 1500, durationMs: 300 },
    ]);
    expect(plan.stateIntervals).toEqual([
      { targetId: "a", intervals: [{ startMs: 0, endMs: 1500 }], on: { opacity: 0 }, off: { opacity: 1 } },
    ]);
  });

  it("clamps the duration to the trigger window and drops targets pushed past it", () => {
    const plan = planAppearEffect({
      targets: [
        { id: "a", step: 0 },
        { id: "b", step: 1 },
      ],
      trigger: { kind: "cue" },
      effect: { kind: "appear", preset: "scale-in", durationMs: 5000, staggerMs: 1200 },
      lineIntervals: intervals,
      spanMs: 1000,
      path,
    });
    expect(plan.animation).toEqual([
      { targetId: "a", action: "scale-in", startMs: 0, durationMs: 1000 },
    ]);
    expect(plan.stateIntervals).toEqual([]);
  });

  it("returns an empty plan for a reversed range", () => {
    const plan = planAppearEffect({
      targets: [{ id: "a", step: 0 }],
      trigger: { kind: "lines", startLineId: "l3", endLineId: "l1" },
      effect: { kind: "appear", preset: "fade", durationMs: 300 },
      lineIntervals: intervals,
      spanMs: 9000,
      path,
    });
    expect(plan).toEqual({ animation: [], stateIntervals: [] });
  });
});
