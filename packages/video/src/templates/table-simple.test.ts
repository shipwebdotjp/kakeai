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
    expect(rendered.animation[0]).toMatchObject({ preset: "fade", startMs: 0, durationMs: 400 });
    expect(rendered.animation[1]).toMatchObject({ preset: "fade", startMs: 150, durationMs: 400 });
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
