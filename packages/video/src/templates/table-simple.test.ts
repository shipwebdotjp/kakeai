import { describe, expect, it } from "vitest";
import { getVisualTheme } from "@kakeai/contracts";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import type { RenderContext } from "../render-context";
import { cueScope } from "../scope";
import type { AssetResolver } from "../resolver";
import { CompositionCompileError } from "../compile-error";
import { renderTableSimple } from "./table-simple";

const theme = getVisualTheme("soft-editorial", 1)!;

const assetResolver: AssetResolver = (assetId) => ({
  url: `/preview/${assetId}`,
  kind: "image",
});

function context(): RenderContext {
  return {
    document: validContentDocument(),
    theme,
    assetResolver,
    scope: cueScope("visual-table-1"),
    path: ["scenes", 1, "visualCues", 2, "input"],
    renderNested: () => {
      throw new Error("nested visuals are not used by table.simple");
    },
  };
}

const baseInput = {
  caption: "料金プラン",
  data: {
    columns: [
      { key: "name", label: "プラン", type: "text" },
      { key: "price", label: "月額", type: "number", format: "currency" },
    ],
    rows: [
      { name: "Free", price: 0 },
      { name: "Pro", price: 1500 },
    ],
  },
};

describe("renderTableSimple", () => {
  it("renders caption, headers, and formatted cells with alignment", () => {
    const rendered = renderTableSimple(baseInput, context());
    expect(rendered.assetIds).toEqual([]);
    expect(rendered.html).toContain("料金プラン");
    expect(rendered.html).toContain("プラン");
    expect(rendered.html).toContain("1,500");
    expect(rendered.html).toContain("text-align:right");
    expect(rendered.html).toContain("text-align:left");
  });

  it("formats percent values as ratios", () => {
    const rendered = renderTableSimple(
      {
        data: {
          columns: [{ key: "rate", label: "率", type: "number", format: "percent" }],
          rows: [{ rate: 0.25 }],
        },
      },
      context(),
    );
    expect(rendered.html).toContain("25%");
  });

  it("escapes cell text instead of rendering html", () => {
    const rendered = renderTableSimple(
      {
        data: {
          columns: [{ key: "name", label: "項目", type: "text" }],
          rows: [{ name: "<script>alert(1)</script>" }],
        },
      },
      context(),
    );
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.html).not.toContain("<script>alert");
  });

  it("returns staggered row animation entries by default", () => {
    const rendered = renderTableSimple(
      { ...baseInput, reveal: { mode: "rows", preset: "fade", durationMs: 400, staggerMs: 150 } },
      context(),
    );
    expect(rendered.animation).toHaveLength(2);
    expect(rendered.animation[0]).toMatchObject({ action: "fade", startMs: 0, durationMs: 400 });
    expect(rendered.animation[1]).toMatchObject({ action: "fade", startMs: 150, durationMs: 400 });
    expect(rendered.animation[0]!.targetId).not.toBe(rendered.animation[1]!.targetId);
  });

  it("returns no animation entries when reveal mode is none", () => {
    const rendered = renderTableSimple(
      { ...baseInput, reveal: { mode: "none", preset: "fade", durationMs: 400, staggerMs: 150 } },
      context(),
    );
    expect(rendered.animation).toEqual([]);
  });

  it("returns column-staggered cell animation entries in columns mode", () => {
    const rendered = renderTableSimple(
      {
        ...baseInput,
        reveal: { mode: "columns", preset: "slide-up", durationMs: 300, staggerMs: 100 },
      },
      context(),
    );
    expect(rendered.animation).toHaveLength(4);
    const starts = rendered.animation.map((item) => item.startMs);
    expect(starts).toEqual([0, 100, 0, 100]);
  });

  it("highlights emphasized rows and cells with theme-derived colors", () => {
    const rendered = renderTableSimple(
      {
        ...baseInput,
        data: {
          ...baseInput.data,
          emphasis: [
            { row: 1, tone: "primary" },
            { row: 0, key: "price", tone: "error" },
          ],
        },
      },
      context(),
    );
    const backgrounds = rendered.html.match(/background:#[0-9A-F]{6}/g) ?? [];
    expect(backgrounds.length).toBeGreaterThanOrEqual(2);
    expect(rendered.animation).toHaveLength(2);
  });

  it("keeps cell emphasis as an override on an emphasized row", () => {
    const rendered = renderTableSimple(
      {
        ...baseInput,
        data: {
          ...baseInput.data,
          emphasis: [
            { row: 0, tone: "primary" },
            { row: 0, key: "price", tone: "error" },
          ],
        },
      },
      context(),
    );
    const backgrounds = rendered.html.match(/background:#[0-9A-F]{6}/g) ?? [];
    expect(new Set(backgrounds).size).toBe(2);
  });

  it("rejects invalid input", () => {
    expect(() => renderTableSimple({ data: { columns: [], rows: [] } }, context())).toThrow(
      CompositionCompileError,
    );
  });

  it("renders deterministically for the same input", () => {
    const first = renderTableSimple(baseInput, context());
    const second = renderTableSimple(baseInput, context());
    expect(first.html).toBe(second.html);
    expect(first.animation).toEqual(second.animation);
  });
});

describe("renderTableSimple effects", () => {
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

  it("appears rows at their line and hides them until then", () => {
    const rendered = renderTableSimple(
      {
        ...baseInput,
        effects: [
          {
            target: { kind: "rows" },
            trigger: { kind: "lines", startLineId: "l2", endLineId: "l2" },
            effect: { kind: "appear", preset: "fade", durationMs: 300, staggerMs: 100 },
          },
        ],
      },
      timedContext(),
    );
    const scope = cueScope("visual-table-1");
    const row0 = scope.id("row-0");
    const row1 = scope.id("row-1");
    expect(rendered.animation).toContainEqual({
      targetId: row0,
      action: "fade",
      startMs: 1500,
      durationMs: 300,
    });
    expect(rendered.animation).toContainEqual({
      targetId: row1,
      action: "fade",
      startMs: 1600,
      durationMs: 300,
    });
    expect(rendered.stateIntervals).toContainEqual({
      targetId: row0,
      intervals: [{ startMs: 0, endMs: 1500 }],
      on: { opacity: 0 },
      off: { opacity: 1 },
    });
    expect(rendered.stateIntervals).toContainEqual({
      targetId: row1,
      intervals: [{ startMs: 0, endMs: 1600 }],
      on: { opacity: 0 },
      off: { opacity: 1 },
    });
  });

  it("highlights a row during its line range and restores it after", () => {
    const rendered = renderTableSimple(
      {
        ...baseInput,
        effects: [
          {
            target: { kind: "row", index: 1 },
            trigger: { kind: "lines", startLineId: "l2", endLineId: "l2" },
            effect: { kind: "emphasize", style: "background", tone: "primary" },
          },
        ],
      },
      timedContext(),
    );
    const row1 = cueScope("visual-table-1").id("row-1");
    const state = rendered.stateIntervals?.find((entry) => entry.targetId === row1);
    expect(state?.intervals).toEqual([{ startMs: 1500, endMs: 2500 }]);
    expect(state?.on).toMatchObject({ backgroundColor: expect.any(String) });
    expect(state?.off).toMatchObject({ color: "inherit" });
  });

  it("starts a cue-triggered appearance at the cue and leaves it visible", () => {
    const rendered = renderTableSimple(
      {
        ...baseInput,
        effects: [
          {
            target: { kind: "row", index: 0 },
            trigger: { kind: "cue" },
            effect: { kind: "appear", preset: "slide-up", durationMs: 400 },
          },
        ],
      },
      timedContext(),
    );
    const row0 = cueScope("visual-table-1").id("row-0");
    expect(rendered.animation).toContainEqual({
      targetId: row0,
      action: "slide-up",
      startMs: 0,
      durationMs: 400,
    });
    expect(rendered.stateIntervals).toEqual([]);
  });
});
