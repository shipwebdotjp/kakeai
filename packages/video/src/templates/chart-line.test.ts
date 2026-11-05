import { describe, expect, it } from "vitest";
import { getVisualTheme } from "@kakeai/contracts";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import type { RenderContext } from "../render-context";
import { LANDSCAPE_CANVAS } from "../canvas";
import { neutralVisualSkin } from "../skins/neutral";
import { cueScope } from "../scope";
import type { AssetResolver } from "../resolver";
import { CompositionCompileError } from "../compile-error";
import { renderChartLine } from "./chart-line";

const theme = getVisualTheme("soft-editorial", 1)!;

const assetResolver: AssetResolver = (assetId) => ({
  url: `/preview/${assetId}`,
  kind: "image",
});

function context(): RenderContext {
  return {
    document: validContentDocument(),
    theme,
    skin: neutralVisualSkin,
    canvas: LANDSCAPE_CANVAS,
    assetResolver,
    scope: cueScope("visual-line-1"),
    path: ["scenes", 1, "visualCues", 2, "input"],
    renderNested: () => {
      throw new Error("nested visuals are not used by chart.line");
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
      { month: "3月", sales: 150 },
    ],
  },
};

describe("renderChartLine", () => {
  it("renders a title, straight paths, markers, ticks, and formatted value labels", () => {
    const rendered = renderChartLine(
      { ...singleSeries, style: { valueLabels: true } },
      context(),
    );
    expect(rendered.html).toContain("月別売上");
    expect(rendered.html).toContain("kakeai-linechartpath");
    expect(rendered.html).toContain("kakeai-linechartpoint");
    expect(rendered.html).toContain("kakeai-linecharttick");
    expect(rendered.html).toContain("￥200");
    expect(rendered.html).toContain("1月");
    expect(rendered.html).toContain("3月");
    expect(rendered.html).toMatch(/d="M[-\d.]+ -?[\d.]+ L/);
  });

  it("shows a legend only for multiple series and cycles theme colors", () => {
    const rendered = renderChartLine(
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
      },
      context(),
    );
    expect(rendered.html).toContain("kakeai-chartlegend");
    expect(rendered.html).toContain("売上");
    expect(rendered.html).toContain("費用");
    const colors = rendered.html.match(/stroke:#[0-9A-F]{6}/g) ?? [];
    expect(new Set(colors).size).toBeGreaterThanOrEqual(2);
  });

  it("hides value labels by default and appends the axis unit to ticks", () => {
    const rendered = renderChartLine(
      {
        data: {
          columns: [
            { key: "month", label: "月", type: "text" },
            { key: "sales", label: "売上", type: "number", format: "integer" },
          ],
          rows: singleSeries.data.rows,
        },
        style: { axisUnit: "件" },
      },
      context(),
    );
    expect(rendered.html).not.toContain("kakeai-linechartvalue");
    expect(rendered.html).toContain("件");
  });

  it("draws each series and reveals markers at their cumulative path fractions", () => {
    const scope = cueScope("visual-line-1");
    const rendered = renderChartLine(
      {
        ...singleSeries,
        effects: [
          {
            target: { kind: "allSeries" },
            trigger: { kind: "cue" },
            effect: { kind: "appear", preset: "draw", durationMs: 600 },
          },
        ],
      },
      { ...context(), cueTiming: { startMs: 0, spanMs: 9000 } },
    );
    expect(rendered.animation).toContainEqual({
      targetId: scope.id("line-path-0"),
      action: "draw",
      startMs: 0,
      durationMs: 600,
      fromVars: { strokeDashoffset: expect.any(Number) },
    });
    expect(rendered.stateIntervals).toContainEqual({
      targetId: scope.id("line-point-1-0"),
      intervals: [{ startMs: 0, endMs: expect.any(Number) }],
      on: { opacity: 0 },
      off: { opacity: 1 },
    });
    expect(rendered.stateIntervals).not.toContainEqual(
      expect.objectContaining({ targetId: scope.id("line-point-0-0") }),
    );
  });

  it("fades the path and every marker together", () => {
    const scope = cueScope("visual-line-1");
    const rendered = renderChartLine(
      {
        ...singleSeries,
        effects: [
          {
            target: { kind: "series", seriesKey: "sales" },
            trigger: { kind: "cue" },
            effect: { kind: "appear", preset: "fade", durationMs: 400 },
          },
        ],
      },
      { ...context(), cueTiming: { startMs: 0, spanMs: 9000 } },
    );
    expect(rendered.animation).toHaveLength(4);
    expect(rendered.animation.every((item) => item.action === "fade")).toBe(true);
    expect(rendered.animation).toContainEqual({
      targetId: scope.id("line-point-2-0"),
      action: "fade",
      startMs: 0,
      durationMs: 400,
    });
  });

  it("emphasizes a series with a frame and spotlights the rest for a category", () => {
    const scope = cueScope("visual-line-1");
    const frame = renderChartLine(
      {
        ...singleSeries,
        effects: [
          {
            target: { kind: "series", seriesKey: "sales" },
            trigger: { kind: "cue" },
            effect: { kind: "emphasize", style: "frame", tone: "primary" },
          },
        ],
      },
      { ...context(), cueTiming: { startMs: 0, spanMs: 9000 } },
    );
    expect(frame.stateIntervals).toContainEqual(
      expect.objectContaining({
        targetId: scope.id("line-path-0"),
        on: expect.objectContaining({ strokeWidth: 10 }),
      }),
    );

    const spotlight = renderChartLine(
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
        effects: [
          {
            target: { kind: "category", categoryKey: "1月" },
            trigger: { kind: "cue" },
            effect: { kind: "emphasize", style: "spotlight", tone: "primary" },
          },
        ],
      },
      { ...context(), cueTiming: { startMs: 0, spanMs: 9000 } },
    );
    expect(spotlight.stateIntervals).toContainEqual(
      expect.objectContaining({
        targetId: scope.id("line-path-1"),
        on: { filter: "brightness(0.4)" },
      }),
    );
    expect(spotlight.stateIntervals).toContainEqual(
      expect.objectContaining({
        targetId: scope.id("line-point-1-0"),
        on: { filter: "brightness(0.4)" },
      }),
    );
    expect(spotlight.stateIntervals).not.toContainEqual(
      expect.objectContaining({
        targetId: scope.id("line-point-0-0"),
        on: { filter: "brightness(0.4)" },
      }),
    );
  });

  it("counts value labels for a point target", () => {
    const scope = cueScope("visual-line-1");
    const rendered = renderChartLine(
      {
        ...singleSeries,
        style: { valueLabels: true },
        effects: [
          {
            target: { kind: "point", categoryKey: "2月", seriesKey: "sales" },
            trigger: { kind: "cue" },
            effect: { kind: "value", from: 0, durationMs: 600 },
          },
        ],
      },
      { ...context(), cueTiming: { startMs: 0, spanMs: 9000 } },
    );
    expect(rendered.valueAnimations).toContainEqual(
      expect.objectContaining({
        targetId: scope.id("line-value-1-0"),
        from: 0,
        to: 200,
        format: "currency",
        durationMs: 600,
      }),
    );
  });

  it("caps the plot width by the wide, medium, and narrow presets", () => {
    for (const [width, expected] of [
      [undefined, 1280],
      ["wide", 1280],
      ["medium", 960],
      ["narrow", 768],
    ] as const) {
      const rendered = renderChartLine(
        width === undefined ? singleSeries : { ...singleSeries, style: { width } },
        context(),
      );
      expect(rendered.html).toContain(`--kakeai-chart-frame-max-w:${expected}px`);
      expect(rendered.html).toContain(`width:${expected}px;height:560px`);
    }
  });

  it("renders deterministically and isolates cue scopes", () => {
    const first = renderChartLine(singleSeries, context());
    const second = renderChartLine(singleSeries, context());
    expect(first.html).toBe(second.html);
    const other = renderChartLine(singleSeries, { ...context(), scope: cueScope("visual-line-2") });
    expect(other.html).not.toBe(first.html);
  });

  it("rejects invalid input", () => {
    expect(() => renderChartLine({ data: { columns: [], rows: [] } }, context())).toThrow(
      CompositionCompileError,
    );
  });
});
