import { describe, expect, it } from "vitest";
import { getVisualTheme } from "@kakeai/contracts";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import type { RenderContext } from "../render-context";
import { cueScope } from "../scope";
import type { AssetResolver } from "../resolver";
import { CompositionCompileError } from "../compile-error";
import { renderChartBar } from "./chart-bar";

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
    scope: cueScope("visual-chart-1"),
    path: ["scenes", 1, "visualCues", 2, "input"],
    renderNested: () => {
      throw new Error("nested visuals are not used by chart.bar");
    },
  };
}

const singleSeries = {
  title: "月別売上",
  data: {
    columns: [
      { key: "month", label: "月", type: "text" },
      { key: "sales", label: "売上", type: "number", format: "currency" },
    ],
    rows: [
      { month: "1月", sales: 100 },
      { month: "2月", sales: 200 },
    ],
  },
};

describe("renderChartBar", () => {
  it("renders a title and formatted values", () => {
    const rendered = renderChartBar(singleSeries, context());
    expect(rendered.html).toContain("月別売上");
    expect(rendered.html).toContain("￥200");
    expect(rendered.html).toContain("kakeai-chartbar");
  });

  it("grows bars along the vertical axis through a cue-triggered effect", () => {
    const rendered = renderChartBar(
      {
        ...singleSeries,
        effects: [
          {
            target: { kind: "bars" },
            trigger: { kind: "cue" },
            effect: { kind: "appear", preset: "grow", durationMs: 600, staggerMs: 120 },
          },
        ],
      },
      { ...context(), cueTiming: { startMs: 0, spanMs: 9000 } },
    );
    expect(rendered.animation).toHaveLength(2);
    expect(rendered.animation[0]).toMatchObject({
      action: "grow",
      axis: "y",
      ease: "normal",
      startMs: 0,
    });
    expect(rendered.animation[1]).toMatchObject({ startMs: 120 });
  });

  it("maps the bounce preset to an overshoot ease", () => {
    const rendered = renderChartBar(
      {
        ...singleSeries,
        effects: [
          {
            target: { kind: "bars" },
            trigger: { kind: "cue" },
            effect: { kind: "appear", preset: "bounce", durationMs: 600, staggerMs: 120 },
          },
        ],
      },
      { ...context(), cueTiming: { startMs: 0, spanMs: 9000 } },
    );
    expect(rendered.animation.every((item) => item.ease === "overshoot")).toBe(true);
  });

  it("emits a horizontal grow action in horizontal orientation", () => {
    const rendered = renderChartBar(
      {
        ...singleSeries,
        style: { orientation: "horizontal", valueLabels: true },
        effects: [
          {
            target: { kind: "bars" },
            trigger: { kind: "cue" },
            effect: { kind: "appear", preset: "grow", durationMs: 600 },
          },
        ],
      },
      { ...context(), cueTiming: { startMs: 0, spanMs: 9000 } },
    );
    expect(rendered.animation.every((item) => item.axis === "x")).toBe(true);
    expect(rendered.html).toContain("kakeai-chart-horizontal");
  });

  it("shows a legend and varies colors for multiple series", () => {
    const rendered = renderChartBar(
      {
        data: {
          columns: [
            { key: "month", label: "月", type: "text" },
            { key: "sales", label: "売上", type: "number" },
            { key: "cost", label: "費用", type: "number" },
          ],
          rows: [{ month: "1月", sales: 100, cost: 80 }],
        },
      },
      context(),
    );
    expect(rendered.html).toContain("kakeai-chartlegend");
    expect(rendered.html).toContain("売上");
    const colors = rendered.html.match(/background:#[0-9A-F]{6}/g) ?? [];
    expect(new Set(colors).size).toBeGreaterThanOrEqual(2);
  });

  it("escapes category labels", () => {
    const rendered = renderChartBar(
      {
        data: {
          columns: [
            { key: "name", label: "項目", type: "text" },
            { key: "value", label: "値", type: "number" },
          ],
          rows: [{ name: "<b>x</b>", value: 1 }],
        },
      },
      context(),
    );
    expect(rendered.html).toContain("&lt;b&gt;");
    expect(rendered.html).not.toContain("<b>x</b>");
  });

  it("renders deterministically for the same input", () => {
    const first = renderChartBar(singleSeries, context());
    const second = renderChartBar(singleSeries, context());
    expect(first.html).toBe(second.html);
    expect(first.animation).toEqual(second.animation);
  });

  it("rejects invalid input", () => {
    expect(() => renderChartBar({ data: { columns: [], rows: [] } }, context())).toThrow(
      CompositionCompileError,
    );
  });

  it("omits value labels when disabled and appends the axis unit to ticks", () => {
    const rendered = renderChartBar(
      {
        ...singleSeries,
        style: { preset: "clean", orientation: "vertical", valueLabels: false, axisUnit: "円" },
      },
      context(),
    );
    expect(rendered.html).not.toContain("kakeai-chartvalue");
    expect(rendered.html).toContain("kakeai-charttick");
    expect(rendered.html).toContain("円");
  });

  it("matches legend colors to category colors when colorBy is category", () => {
    const rendered = renderChartBar(
      {
        data: {
          columns: [
            { key: "month", label: "月", type: "text" },
            { key: "sales", label: "売上", type: "number" },
            { key: "cost", label: "費用", type: "number" },
          ],
          rows: [
            { month: "1月", sales: 100, cost: 80 },
            { month: "2月", sales: 200, cost: 95 },
          ],
        },
        style: { preset: "clean", orientation: "vertical", valueLabels: true, colorBy: "category" },
      },
      context(),
    );
    const swatches = rendered.html.match(/kakeai-chartswatch" style="background:(#[0-9A-F]{6})/g) ?? [];
    expect(swatches).toHaveLength(2);
    expect(rendered.html).toContain("1月");
    expect(rendered.html).toContain("2月");
  });

  it("keeps two chart cues from colliding", () => {
    const a = renderChartBar(singleSeries, { ...context(), scope: cueScope("vc-a") });
    const b = renderChartBar(singleSeries, { ...context(), scope: cueScope("vc-b") });
    expect(a.html).not.toBe(b.html);
  });
});

describe("renderChartBar effects", () => {
  it("appears bars at their line and hides them until then", () => {
    const scope = cueScope("visual-chart-1");
    const rendered = renderChartBar(
      {
        ...singleSeries,
        effects: [
          {
            target: { kind: "bars" },
            trigger: { kind: "lines", startLineId: "l2", endLineId: "l2" },
            effect: { kind: "appear", preset: "fade", durationMs: 200, staggerMs: 50 },
          },
        ],
      },
      {
        ...context(),
        cueTiming: { startMs: 0, spanMs: 9000 },
        lineIntervals: [{ lineId: "l2", startMs: 1500, endMs: 2500 }],
      },
    );
    expect(rendered.animation).toEqual([
      {
        targetId: scope.id("bar-0-0"),
        action: "fade",
        axis: "y",
        ease: "normal",
        startMs: 1500,
        durationMs: 200,
      },
      {
        targetId: scope.id("bar-1-0"),
        action: "fade",
        axis: "y",
        ease: "normal",
        startMs: 1550,
        durationMs: 200,
      },
    ]);
    expect(rendered.stateIntervals).toContainEqual({
      targetId: scope.id("bar-0-0"),
      intervals: [{ startMs: 0, endMs: 1500 }],
      on: { opacity: 0 },
      off: { opacity: 1 },
    });
  });

  it("appears only the bars of a category", () => {
    const scope = cueScope("visual-chart-1");
    const rendered = renderChartBar(
      {
        ...singleSeries,
        effects: [
          {
            target: { kind: "category", index: 1 },
            trigger: { kind: "cue" },
            effect: { kind: "appear", preset: "fade", durationMs: 300 },
          },
        ],
      },
      { ...context(), cueTiming: { startMs: 0, spanMs: 9000 } },
    );
    expect(rendered.animation).toEqual([
      {
        targetId: scope.id("bar-1-0"),
        action: "fade",
        axis: "y",
        ease: "normal",
        startMs: 0,
        durationMs: 300,
      },
    ]);
    expect(rendered.stateIntervals).toEqual([]);
  });

  it("rings the spotlighted category and dims the other bars", () => {
    const scope = cueScope("visual-chart-1");
    const rendered = renderChartBar(
      {
        ...singleSeries,
        effects: [
          {
            target: { kind: "category", index: 1 },
            trigger: { kind: "lines", startLineId: "l1", endLineId: "l1" },
            effect: { kind: "emphasize", style: "spotlight", tone: "primary" },
          },
        ],
      },
      {
        ...context(),
        cueTiming: { startMs: 0, spanMs: 9000 },
        lineIntervals: [{ lineId: "l1", startMs: 500, endMs: 1500 }],
      },
    );
    expect(rendered.stateIntervals).toContainEqual({
      targetId: scope.id("bar-1-0"),
      intervals: [{ startMs: 500, endMs: 1500 }],
      on: { boxShadow: expect.stringContaining("inset") },
      off: { boxShadow: "none" },
    });
    expect(rendered.stateIntervals).toContainEqual({
      targetId: scope.id("bar-0-0"),
      intervals: [{ startMs: 500, endMs: 1500 }],
      on: { filter: "brightness(0.4)" },
      off: { filter: "none" },
    });
  });

  it("pops the onset overlay on every highlighted bar", () => {
    const scope = cueScope("visual-chart-1");
    const rendered = renderChartBar(
      {
        ...singleSeries,
        effects: [
          {
            target: { kind: "bars" },
            trigger: { kind: "lines", startLineId: "l1", endLineId: "l1" },
            effect: {
              kind: "emphasize",
              style: "frame",
              tone: "primary",
              onset: { preset: "pop", durationMs: 500 },
            },
          },
        ],
      },
      {
        ...context(),
        cueTiming: { startMs: 0, spanMs: 9000 },
        lineIntervals: [{ lineId: "l1", startMs: 500, endMs: 1500 }],
      },
    );
    expect(rendered.animation).toContainEqual({
      targetId: `${scope.id("bar-0-0")}-onset`,
      action: "pop",
      ease: "overshoot",
      startMs: 500,
      durationMs: 500,
    });
    expect(rendered.html).toContain("kakeai-onset-pop");
  });

  it("counts up bar value labels and skips when labels are disabled", () => {
    const scope = cueScope("visual-chart-1");
    const rendered = renderChartBar(
      {
        ...singleSeries,
        effects: [
          {
            target: { kind: "bars" },
            trigger: { kind: "cue" },
            effect: { kind: "value" },
          },
        ],
      },
      { ...context(), cueTiming: { startMs: 0, spanMs: 9000 } },
    );
    expect(rendered.valueAnimations).toContainEqual({
      targetId: scope.id("val-0-0"),
      from: 0,
      to: 100,
      format: "currency",
      startMs: 0,
      durationMs: 2000,
    });
    expect(() =>
      renderChartBar(
        {
          ...singleSeries,
          style: { preset: "clean", orientation: "vertical", valueLabels: false },
          effects: [
            {
              target: { kind: "bars" },
              trigger: { kind: "cue" },
              effect: { kind: "value" },
            },
          ],
        },
        { ...context(), cueTiming: { startMs: 0, spanMs: 9000 } },
      ),
    ).toThrow(CompositionCompileError);
  });
});
