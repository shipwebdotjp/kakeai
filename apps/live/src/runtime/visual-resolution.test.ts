import {
  materialCardSchema,
  type LivePackageSegment,
  type MaterialCard,
} from "@kakeai/contracts";
import { describe, expect, it } from "vitest";
import { testV2Show } from "../testing/v2-show.ts";
import {
  effectiveVisualKey,
  resolveEffectiveVisual,
  StageVisualTracker,
  type VisualResolutionInput,
} from "./visual-resolution.ts";

function material(id: string, focus: boolean): MaterialCard {
  return materialCardSchema.parse({
    id,
    kind: "image",
    file: `materials/${id}.png`,
    hasAudio: false,
    focus,
    width: 16,
    height: 9,
  });
}

function v2Context(materials: MaterialCard[] = []): VisualResolutionInput {
  return {
    cards: testV2Show().cards,
    materials,
  };
}

function scriptSegment(overrides: Record<string, unknown> = {}): LivePackageSegment {
  return {
    ...testV2Show().segments[1]!,
    ...overrides,
  } as LivePackageSegment;
}

describe("resolveEffectiveVisual (v2)", () => {
  it("inherits the segment card when the cue omits visual", () => {
    expect(resolveEffectiveVisual(v2Context(), scriptSegment(), {})).toEqual({
      kind: "card",
      cardId: "card-list",
      stateId: "state-list-title",
    });
  });

  it("lets a cue visual override the segment default", () => {
    expect(
      resolveEffectiveVisual(v2Context(), scriptSegment(), {
        visual: { kind: "card", cardId: "card-list", stateId: "state-list-item" },
      }),
    ).toEqual({ kind: "card", cardId: "card-list", stateId: "state-list-item" });
  });

  it("hides the visual when the cue explicitly sets null", () => {
    expect(
      resolveEffectiveVisual(v2Context(), scriptSegment(), { visual: null }),
    ).toBeNull();
  });

  it("hides the visual when neither cue nor segment specifies one", () => {
    expect(
      resolveEffectiveVisual(
        v2Context(),
        scriptSegment({ visual: undefined }),
        { visual: undefined },
      ),
    ).toBeNull();
  });

  it("resolves a material visual and takes focus from the package material", () => {
    expect(
      resolveEffectiveVisual(v2Context([material("material-1", false)]), scriptSegment(), {
        visual: { kind: "material", materialId: "material-1" },
      }),
    ).toEqual({ kind: "material", materialId: "material-1", focus: false });
  });

  it("fails safe to null for missing cards, states and materials", () => {
    expect(
      resolveEffectiveVisual(v2Context(), scriptSegment(), {
        visual: { kind: "card", cardId: "missing-card", stateId: "state" },
      }),
    ).toBeNull();
    expect(
      resolveEffectiveVisual(v2Context(), scriptSegment(), {
        visual: { kind: "card", cardId: "card-list", stateId: "missing-state" },
      }),
    ).toBeNull();
    expect(
      resolveEffectiveVisual(v2Context(), scriptSegment(), {
        visual: { kind: "material", materialId: "missing-material" },
      }),
    ).toBeNull();
  });
});

describe("StageVisualTracker", () => {
  it("advances only when the effective visual changes", () => {
    const tracker = new StageVisualTracker();
    expect(tracker.update(null)).toBeNull();
    expect(tracker.update(null)).toBeNull();

    const first = tracker.update({
      kind: "card",
      cardId: "card-list",
      stateId: "state-list-title",
    });
    expect(first).toEqual({
      kind: "card",
      cardId: "card-list",
      stateId: "state-list-title",
      sequence: 1,
    });
    expect(
      tracker.update({ kind: "card", cardId: "card-list", stateId: "state-list-title" }),
    ).toEqual(first);

    expect(
      tracker.update({ kind: "card", cardId: "card-list", stateId: "state-list-item" }),
    ).toMatchObject({ stateId: "state-list-item", sequence: 2 });
    expect(
      tracker.update({ kind: "material", materialId: "material-1", focus: true }),
    ).toMatchObject({ kind: "material", sequence: 3 });
  });

  it("advances on focus changes and on hide/show boundaries", () => {
    const tracker = new StageVisualTracker();
    expect(
      tracker.update({ kind: "material", materialId: "material-1", focus: true }),
    ).toMatchObject({ sequence: 1 });
    expect(
      tracker.update({ kind: "material", materialId: "material-1", focus: true }),
    ).toMatchObject({ sequence: 1 });
    expect(
      tracker.update({ kind: "material", materialId: "material-1", focus: false }),
    ).toMatchObject({ sequence: 2 });
    expect(tracker.update(null)).toBeNull();
    expect(
      tracker.update({ kind: "material", materialId: "material-1", focus: false }),
    ).toMatchObject({ sequence: 4 });
  });
});

describe("effectiveVisualKey", () => {
  it("distinguishes card states, material focus and null", () => {
    expect(effectiveVisualKey(null)).toBe("null");
    expect(
      effectiveVisualKey({ kind: "card", cardId: "card-a", stateId: "state-1" }),
    ).not.toBe(effectiveVisualKey({ kind: "card", cardId: "card-a", stateId: "state-2" }));
    expect(
      effectiveVisualKey({ kind: "material", materialId: "material-a", focus: true }),
    ).not.toBe(
      effectiveVisualKey({ kind: "material", materialId: "material-a", focus: false }),
    );
  });
});
