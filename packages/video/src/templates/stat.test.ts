import { describe, expect, it } from "vitest";
import { getVisualTheme } from "@kakeai/contracts";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import type { RenderContext } from "../render-context";
import { cueScope } from "../scope";
import type { AssetResolver } from "../resolver";
import { CompositionCompileError } from "../compile-error";
import { renderStat } from "./stat";

const theme = getVisualTheme("soft-editorial", 1)!;

const assetResolver: AssetResolver = (assetId) => ({ url: `/preview/${assetId}`, kind: "image" });

function context(): RenderContext {
  return {
    document: validContentDocument(),
    theme,
    assetResolver,
    scope: cueScope("visual-stat-1"),
    path: ["scenes", 1, "visualCues", 2, "input"],
    renderNested: () => {
      throw new Error("nested visuals are not used by stat");
    },
  };
}

function timedContext(): RenderContext {
  return {
    ...context(),
    cueTiming: { startMs: 0, spanMs: 9000 },
    lineIntervals: [
      { lineId: "l1", startMs: 500, endMs: 1500 },
      { lineId: "l2", startMs: 1500, endMs: 2500 },
    ],
  };
}

const baseInput = {
  value: 1200,
  label: "導入社数",
  caption: "2026年",
  format: "integer" as const,
};

describe("renderStat", () => {
  it("renders the formatted value, label, and caption", () => {
    const rendered = renderStat(baseInput, context());
    expect(rendered.assetIds).toEqual([]);
    expect(rendered.html).toContain("1,200");
    expect(rendered.html).toContain("導入社数");
    expect(rendered.html).toContain("2026年");
  });

  it("rejects invalid input", () => {
    expect(() => renderStat({ label: "x" }, context())).toThrow(CompositionCompileError);
  });

  it("renders deterministically and keeps two cues from colliding", () => {
    const first = renderStat(baseInput, context());
    const second = renderStat(baseInput, context());
    expect(first.html).toBe(second.html);
    const other = renderStat(baseInput, { ...context(), scope: cueScope("vc-other") });
    expect(first.html).not.toBe(other.html);
  });

  it("emits a count-up value animation over the trigger window", () => {
    const scope = cueScope("visual-stat-1");
    const rendered = renderStat(
      {
        ...baseInput,
        effects: [
          { trigger: { kind: "lines", startLineId: "l1", endLineId: "l1" }, effect: { kind: "value" } },
        ],
      },
      timedContext(),
    );
    expect(rendered.valueAnimations).toEqual([
      {
        targetId: scope.id("value-text"),
        from: 0,
        to: 1200,
        format: "integer",
        startMs: 500,
        durationMs: 1000,
      },
    ]);
  });

  it("emphasizes the value and appears the card", () => {
    const scope = cueScope("visual-stat-1");
    const rendered = renderStat(
      {
        ...baseInput,
        effects: [
          {
            trigger: { kind: "lines", startLineId: "l1", endLineId: "l1" },
            effect: { kind: "emphasize", style: "frame", tone: "primary" },
          },
          { trigger: { kind: "cue" }, effect: { kind: "appear", preset: "fade", durationMs: 400 } },
        ],
      },
      timedContext(),
    );
    expect(rendered.stateIntervals).toContainEqual({
      targetId: scope.id("value"),
      intervals: [{ startMs: 500, endMs: 1500 }],
      on: { boxShadow: expect.stringContaining("inset") },
      off: { boxShadow: "none" },
    });
    expect(rendered.animation).toContainEqual({
      targetId: scope.id("card"),
      action: "fade",
      startMs: 0,
      durationMs: 400,
    });
  });
});
