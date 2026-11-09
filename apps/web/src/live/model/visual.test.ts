import { describe, expect, it } from "vitest";
import {
  resolveEffectiveVisual,
  setCueVisual,
  setSegmentVisual,
  visualFieldKind,
  visualRefEquals,
  visualRefKey,
} from "./visual";
import { makeProgramDocument } from "./test-helpers";

describe("cue visual inheritance", () => {
  it("distinguishes inherit, explicit hide, and explicit refs", () => {
    let document = makeProgramDocument();
    expect(findCueVisual(document, "cue-opening")).toBeUndefined();
    expect(resolveEffectiveVisualByCue(document, "cue-opening").source).toBe("none");

    document = setCueVisual(document, "cue-opening", null);
    expect(findCueVisual(document, "cue-opening")).toBeNull();
    expect(visualFieldKind(findCueVisual(document, "cue-opening"))).toBe("hidden");
    expect(resolveEffectiveVisualByCue(document, "cue-opening").visual).toBeNull();

    document = setCueVisual(document, "cue-opening", {
      kind: "material",
      materialId: "mat-1",
    });
    expect(visualFieldKind(findCueVisual(document, "cue-opening"))).toBe("material");
    expect(resolveEffectiveVisualByCue(document, "cue-opening").source).toBe("cue");

    document = setCueVisual(document, "cue-opening", undefined);
    expect(findCueVisual(document, "cue-opening")).toBeUndefined();
    expect(visualFieldKind(findCueVisual(document, "cue-opening"))).toBe("inherit");
  });

  it("inherits the segment default when the cue has no visual", () => {
    const document = makeProgramDocument();
    const resolved = resolveEffectiveVisualByCue(document, "cue-news");
    expect(resolved.source).toBe("cue");

    const withoutCueVisual = setCueVisual(document, "cue-news", undefined);
    const inherited = resolveEffectiveVisualByCue(withoutCueVisual, "cue-news");
    expect(inherited.source).toBe("segment");
    expect(inherited.visual).toEqual({
      kind: "card",
      cardId: "card-1",
      stateId: "state-1",
    });
  });

  it("removes a segment default instead of storing null", () => {
    const document = makeProgramDocument();
    const next = setSegmentVisual(document, "seg-script", undefined);
    const segment = next.segments.find((entry) => entry.id === "seg-script");
    expect(segment !== undefined && "visual" in segment).toBe(false);
    expect(resolveEffectiveVisualByCue(next, "cue-news").source).toBe("cue");
  });

  it("can set an explicit material segment default", () => {
    const withMaterial = setSegmentVisual(makeProgramDocument(), "seg-script", {
      kind: "material",
      materialId: "mat-1",
    });
    const document = setCueVisual(withMaterial, "cue-news", undefined);
    expect(resolveEffectiveVisualByCue(document, "cue-news").visual).toEqual({
      kind: "material",
      materialId: "mat-1",
    });
  });

  it("compares card refs field-by-field when ids contain ':' and '/'", () => {
    expect(
      visualRefEquals(
        { kind: "card", cardId: "card:news", stateId: "2026/state:a/b" },
        { kind: "card", cardId: "card:news/2026", stateId: "state:a/b" },
      ),
    ).toBe(false);
    expect(
      visualRefEquals(
        { kind: "card", cardId: "card:a/b", stateId: "state:c" },
        { kind: "card", cardId: "card:a/b", stateId: "state:c" },
      ),
    ).toBe(true);
  });

  it("keeps keys distinct when ids contain ':' or '/'", () => {
    const first = visualRefKey({
      kind: "card",
      cardId: "card:news",
      stateId: "2026/state",
    });
    const second = visualRefKey({
      kind: "card",
      cardId: "card:news/2026",
      stateId: "state",
    });
    expect(first).not.toBe(second);
    expect(
      visualRefKey({ kind: "card", cardId: "card:a/b", stateId: "state:c" }),
    ).toBe(
      visualRefKey({ kind: "card", cardId: "card:a/b", stateId: "state:c" }),
    );
    expect(
      visualRefKey({ kind: "material", materialId: "card:x/y" }),
    ).not.toBe(
      visualRefKey({ kind: "card", cardId: "card:x", stateId: "y" }),
    );
  });
});

function findCueVisual(
  document: ReturnType<typeof makeProgramDocument>,
  cueId: string,
) {
  return document.cues.find((cue) => cue.id === cueId)?.visual;
}

function resolveEffectiveVisualByCue(
  document: ReturnType<typeof makeProgramDocument>,
  cueId: string,
) {
  const cue = document.cues.find((entry) => entry.id === cueId)!;
  const segment = document.segments.find(
    (entry) =>
      entry.kind !== "cut_in" &&
      (entry.kind === "opening" ||
        entry.kind === "script" ||
        entry.kind === "closing") &&
      entry.cues.includes(cueId),
  )!;
  return resolveEffectiveVisual(segment, cue);
}
