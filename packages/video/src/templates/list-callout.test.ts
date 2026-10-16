import { describe, expect, it } from "vitest";
import { getVisualTheme } from "@kakeai/contracts";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import type { RenderContext } from "../render-context";
import { cueScope } from "../scope";
import type { AssetResolver } from "../resolver";
import { CompositionCompileError } from "../compile-error";
import { renderListCallout } from "./list-callout";

const theme = getVisualTheme("soft-editorial", 1)!;

const assetResolver: AssetResolver = (assetId) => ({ url: `/preview/${assetId}`, kind: "image" });

function context(scopeId = "callout-1"): RenderContext {
  return {
    document: validContentDocument(),
    theme,
    assetResolver,
    scope: cueScope(scopeId),
    path: ["scenes", 1, "visualCues", 2, "input"],
    cueTiming: { startMs: 0, spanMs: 9000 },
    lineIntervals: [
      { lineId: "l1", startMs: 500, endMs: 1500 },
      { lineId: "l2", startMs: 1500, endMs: 2500 },
    ],
    renderNested: () => {
      throw new Error("nested visuals are not used by list.callout");
    },
  };
}

const baseInput = {
  title: "テンプレート化の要点",
  items: [
    {
      text: "再利用できる",
      trigger: { kind: "lines", startLineId: "l1", endLineId: "l1" },
      effect: { kind: "emphasize", style: "frame", tone: "primary" },
    },
    {
      text: "表記ゆれを防ぐ",
      trigger: { kind: "lines", startLineId: "l2", endLineId: "l2" },
      effect: { kind: "emphasize", style: "background", tone: "secondary" },
    },
    { text: "常時表示" },
  ],
};

describe("renderListCallout", () => {
  it("renders the title and every item text", () => {
    const rendered = renderListCallout(baseInput, context());
    expect(rendered.assetIds).toEqual([]);
    expect(rendered.html).toContain("テンプレート化の要点");
    expect(rendered.html).toContain("再利用できる");
    expect(rendered.html).toContain("表記ゆれを防ぐ");
    expect(rendered.html).toContain("常時表示");
  });

  it("emphasizes the triggered items for their line ranges only", () => {
    const rendered = renderListCallout(baseInput, context());
    const scope = cueScope("callout-1");
    const item0 = rendered.stateIntervals?.find(
      (entry) => entry.targetId === scope.id("item-0"),
    );
    const item1 = rendered.stateIntervals?.find(
      (entry) => entry.targetId === scope.id("item-1"),
    );
    expect(item0?.intervals).toEqual([{ startMs: 500, endMs: 1500 }]);
    expect(item0?.on).toMatchObject({ boxShadow: expect.stringContaining("inset") });
    expect(item1?.intervals).toEqual([{ startMs: 1500, endMs: 2500 }]);
    expect(item1?.on).toMatchObject({ backgroundColor: expect.any(String) });
    expect(
      rendered.stateIntervals?.some((entry) => entry.targetId === scope.id("item-2")),
    ).toBe(false);
    expect(rendered.animation).toEqual([]);
  });

  it("appears all items with a stagger and hides later ones until their turn", () => {
    const rendered = renderListCallout(
      {
        ...baseInput,
        appear: {
          trigger: { kind: "cue" },
          effect: { kind: "appear", preset: "fade", durationMs: 400, staggerMs: 100 },
        },
      },
      context(),
    );
    const scope = cueScope("callout-1");
    expect(rendered.animation).toEqual([
      { targetId: scope.id("item-0"), action: "fade", startMs: 0, durationMs: 400 },
      { targetId: scope.id("item-1"), action: "fade", startMs: 100, durationMs: 400 },
      { targetId: scope.id("item-2"), action: "fade", startMs: 200, durationMs: 400 },
    ]);
    expect(rendered.stateIntervals).toContainEqual({
      targetId: scope.id("item-2"),
      intervals: [{ startMs: 0, endMs: 200 }],
      on: { opacity: 0 },
      off: { opacity: 1 },
    });
  });

  it("rejects invalid input", () => {
    expect(() => renderListCallout({ items: [] }, context())).toThrow(CompositionCompileError);
  });

  it("dims the sibling items when an item uses spotlight", () => {
    const rendered = renderListCallout(
      {
        items: [
          {
            text: "a",
            trigger: { kind: "lines", startLineId: "l1", endLineId: "l1" },
            effect: { kind: "emphasize", style: "spotlight", tone: "primary" },
          },
          { text: "b" },
        ],
      },
      context(),
    );
    const scope = cueScope("callout-1");
    expect(rendered.stateIntervals).toContainEqual({
      targetId: scope.id("item-0"),
      intervals: [{ startMs: 500, endMs: 1500 }],
      on: { boxShadow: expect.stringContaining("inset") },
      off: { boxShadow: "none" },
    });
    expect(rendered.stateIntervals).toContainEqual({
      targetId: scope.id("item-1"),
      intervals: [{ startMs: 500, endMs: 1500 }],
      on: { filter: "brightness(0.4)" },
      off: { filter: "none" },
    });
  });

  it("flashes an onset overlay when an item emphasizes with an onset", () => {
    const rendered = renderListCallout(
      {
        items: [
          {
            text: "a",
            trigger: { kind: "lines", startLineId: "l1", endLineId: "l1" },
            effect: {
              kind: "emphasize",
              style: "background",
              tone: "warning",
              onset: { preset: "flash", durationMs: 400 },
            },
          },
        ],
      },
      context(),
    );
    const scope = cueScope("callout-1");
    const overlayId = `${scope.id("item-0")}-onset`;
    expect(rendered.animation).toContainEqual({
      targetId: overlayId,
      action: "flash",
      ease: "normal",
      startMs: 500,
      durationMs: 400,
    });
    expect(rendered.html).toContain(`id="${overlayId}"`);
    expect(rendered.html).toContain("kakeai-onset-flash");
  });

  it("keeps two callout cues from colliding", () => {
    const a = renderListCallout(baseInput, context("callout-a"));
    const b = renderListCallout(baseInput, context("callout-b"));
    expect(a.html).not.toBe(b.html);
  });
});
