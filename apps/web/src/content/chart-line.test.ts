import { describe, expect, it } from "vitest";
import { getVisualTemplate } from "@kakeai/contracts";
import { createCueFormValue } from "./form";
import { buildCueInput } from "./form/build-cue-input";
import {
  chartLineCategoryChoices,
  chartLineGridIssues,
  chartLineSeriesChoices,
  countChartLineCategoryEffects,
  countChartLineSeriesEffects,
  defaultChartLineGridDataJson,
  parseChartLineGrid,
  removeChartLineCategoryEffects,
  removeChartLineSeriesEffects,
  renameChartLineCategoryEffects,
  renameChartLineSeriesEffects,
} from "./chart-line";

const effects = JSON.stringify([
  {
    target: { kind: "allSeries" },
    trigger: { kind: "cue" },
    effect: { kind: "appear", preset: "draw", durationMs: 600 },
  },
  {
    target: { kind: "series", seriesKey: "sales" },
    trigger: { kind: "cue" },
    effect: { kind: "appear", preset: "fade", durationMs: 400 },
  },
  {
    target: { kind: "category", categoryKey: "1月" },
    trigger: { kind: "cue" },
    effect: { kind: "emphasize", style: "frame", tone: "primary" },
  },
  {
    target: { kind: "point", categoryKey: "1月", seriesKey: "sales" },
    trigger: { kind: "cue" },
    effect: { kind: "value", durationMs: 600 },
  },
]);

const grid = {
  columns: [
    { key: "month", label: "月", type: "text" },
    { key: "sales", label: "売上", type: "number", format: "currency" },
    { key: "plan", label: "計画", type: "number", format: "currency" },
  ],
  rows: [
    { month: "1月", sales: 100, plan: 90 },
    { month: "2月", sales: 120, plan: 110 },
  ],
} as const;

describe("chart line form helpers", () => {
  it("provides a valid default grid", () => {
    const parsed = parseChartLineGrid(defaultChartLineGridDataJson());
    expect(parsed).not.toBeNull();
    expect(chartLineGridIssues(parsed!)).toEqual([]);
  });

  it("lists series keys and unique non-empty categories", () => {
    const value = JSON.stringify({
      ...grid,
      rows: [
        ...grid.rows,
        { month: "2月", sales: 130, plan: 115 },
        { month: "  ", sales: 140, plan: 120 },
      ],
    });
    expect(chartLineSeriesChoices(value)).toEqual([
      { key: "sales", label: "売上" },
      { key: "plan", label: "計画" },
    ]);
    expect(chartLineCategoryChoices(value)).toEqual([
      { key: "1月", label: "1月" },
      { key: "2月", label: "2月" },
    ]);
  });

  it("reports the save-time grid contract in Japanese", () => {
    const issues = chartLineGridIssues({
      columns: [
        { key: "month", label: "月", type: "text" },
        { key: "sales", label: "売上", type: "number", format: "currency" },
        { key: "plan", label: "計画", type: "number", format: "percent" },
      ],
      rows: [
        { month: "1月", sales: 100, plan: 0.2 },
        { month: "1月", sales: 120, plan: 0.3 },
      ],
    });
    expect(issues).toContain("カテゴリが重複しています: 1月");
    expect(issues).toContain("全系列の数値書式を揃えてください");
    expect(chartLineGridIssues({ columns: [], rows: [] })).toContain(
      "カテゴリ列と数値系列を1本以上入力してください",
    );
  });

  it("renames series and category keys in the same edit", () => {
    const renamedSeries = JSON.parse(
      renameChartLineSeriesEffects(effects, "sales", "revenue")!,
    ) as { target: Record<string, unknown> }[];
    expect(renamedSeries[1]!.target).toEqual({ kind: "series", seriesKey: "revenue" });
    expect(renamedSeries[3]!.target).toEqual({
      kind: "point",
      categoryKey: "1月",
      seriesKey: "revenue",
    });

    const renamedCategory = JSON.parse(
      renameChartLineCategoryEffects(effects, "1月", "睦月")!,
    ) as { target: Record<string, unknown> }[];
    expect(renamedCategory[2]!.target).toEqual({
      kind: "category",
      categoryKey: "睦月",
    });
    expect(renamedCategory[3]!.target).toEqual({
      kind: "point",
      categoryKey: "睦月",
      seriesKey: "sales",
    });
  });

  it("removes only the effects that depend on the deleted key", () => {
    expect(countChartLineSeriesEffects(effects, "sales")).toBe(2);
    expect(countChartLineCategoryEffects(effects, "1月")).toBe(2);
    const withoutSeries = JSON.parse(
      removeChartLineSeriesEffects(effects, "sales")!,
    ) as { target: Record<string, unknown> }[];
    expect(withoutSeries.map((entry) => entry.target.kind)).toEqual([
      "allSeries",
      "category",
    ]);
    const withoutCategory = JSON.parse(
      removeChartLineCategoryEffects(effects, "1月")!,
    ) as { target: Record<string, unknown> }[];
    expect(withoutCategory.map((entry) => entry.target.kind)).toEqual([
      "allSeries",
      "series",
    ]);
  });

  it("leaves unparsable effects alone", () => {
    expect(renameChartLineSeriesEffects("", "sales", "revenue")).toBeNull();
    expect(removeChartLineCategoryEffects("not json", "1月")).toBeNull();
    expect(countChartLineSeriesEffects("not json", "sales")).toBe(0);
  });
});

describe("chart line cue form defaults", () => {
  it("creates a valid default grid and all-series draw effect", () => {
    const cue = createCueFormValue({
      sceneId: "scene-1",
      templateId: "chart.line",
      templateVersion: 1,
      layer: "card",
      order: 0,
    });
    expect(chartLineGridIssues(parseChartLineGrid(cue.fields.data!)!)).toEqual([]);
    expect(JSON.parse(cue.fields.effects!)).toEqual([
      {
        target: { kind: "allSeries" },
        trigger: { kind: "cue" },
        effect: { kind: "appear", preset: "draw", durationMs: 600 },
      },
    ]);
  });

  it("builds a chart.line input through the line data schema", () => {
    const definition = getVisualTemplate("chart.line", 1)!;
    const cue = createCueFormValue({
      sceneId: "scene-1",
      templateId: "chart.line",
      templateVersion: 1,
      layer: "card",
      order: 0,
    });
    cue.fields.data = JSON.stringify(grid);
    cue.fields.effects = effects;
    cue.fields["style.valueLabels"] = "true";
    const input = buildCueInput(cue, definition);
    expect(input?.data).toEqual(grid);
    expect((input?.effects as unknown[]).length).toBe(4);
    expect(input?.style).toMatchObject({ valueLabels: true });

    cue.fields.data = JSON.stringify({ ...grid, rows: [grid.rows[0]] });
    expect(() => buildCueInput(cue, definition)).toThrow(
      "折れ線グラフのデータを正しく入力してください",
    );
  });
});
