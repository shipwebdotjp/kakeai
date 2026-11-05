import { describe, expect, it } from "vitest";
import {
  chartLineDataSchema,
  chartLineInputSchema,
  computeChartLineAxis,
  computeChartLineGeometry,
  parseChartLineNumber,
} from "./index";

const baseData = {
  columns: [
    { key: "month", label: "月", type: "text" },
    { key: "sales", label: "売上", type: "number", format: "currency" },
  ],
  rows: [
    { month: "1月", sales: 100 },
    { month: "2月", sales: 120 },
  ],
};

const baseInput = {
  title: "月別売上",
  data: baseData,
  style: { valueLabels: true },
};

function issuePaths(input: unknown): string[] {
  const parsed = chartLineInputSchema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join("."));
}

describe("chartLineDataSchema", () => {
  it("accepts 2-8 categories and 1-4 same-format series", () => {
    const parsed = chartLineDataSchema.safeParse({
      columns: [
        { key: "month", label: "月", type: "text" },
        { key: "sales", label: "売上", type: "number", format: "decimal" },
        { key: "plan", label: "計画", type: "number", format: "decimal" },
      ],
      rows: [
        { month: "1月", sales: 1.5, plan: 1 },
        { month: "2月", sales: "2.5", plan: 2 },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects one category, duplicate categories, and empty categories", () => {
    expect(
      chartLineDataSchema.safeParse({
        ...baseData,
        rows: [{ month: "1月", sales: 100 }],
      }).success,
    ).toBe(false);
    expect(
      chartLineDataSchema.safeParse({
        ...baseData,
        rows: [
          { month: "1月", sales: 100 },
          { month: "1月", sales: 120 },
        ],
      }).success,
    ).toBe(false);
    expect(
      chartLineDataSchema.safeParse({
        ...baseData,
        rows: [
          { month: "1月", sales: 100 },
          { month: "  ", sales: 120 },
        ],
      }).success,
    ).toBe(false);
    expect(
      chartLineDataSchema.safeParse({
        ...baseData,
        rows: [
          { month: "1月", sales: 100 },
          { month: " 1月 ", sales: 120 },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects missing, empty, and non-finite numeric cells", () => {
    for (const sales of [undefined, "", "abc", Number.POSITIVE_INFINITY]) {
      expect(
        chartLineDataSchema.safeParse({
          ...baseData,
          rows: [
            { month: "1月", sales },
            { month: "2月", sales: 120 },
          ],
        }).success,
      ).toBe(false);
    }
  });

  it("rejects mixed formats and non-numeric series columns", () => {
    expect(
      chartLineDataSchema.safeParse({
        columns: [
          { key: "month", label: "月", type: "text" },
          { key: "sales", label: "売上", type: "number", format: "currency" },
          { key: "plan", label: "計画", type: "number", format: "percent" },
        ],
        rows: [
          { month: "1月", sales: 100, plan: 0.2 },
          { month: "2月", sales: 120, plan: 0.3 },
        ],
      }).success,
    ).toBe(false);
    expect(
      chartLineDataSchema.safeParse({
        ...baseData,
        columns: [
          { key: "month", label: "月", type: "text" },
          { key: "sales", label: "売上", type: "text" },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("chartLineInputSchema effects", () => {
  it("accepts the documented target/effect combinations", () => {
    const effects = [
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
        effect: {
          kind: "emphasize",
          style: "spotlight",
          tone: "primary",
          onset: { preset: "pop", durationMs: 300 },
        },
      },
      {
        target: { kind: "point", categoryKey: "1月", seriesKey: "sales" },
        trigger: { kind: "cue" },
        effect: { kind: "value", durationMs: 600 },
      },
    ];
    expect(chartLineInputSchema.safeParse({ ...baseInput, effects }).success).toBe(true);
  });

  it("rejects effects that do not fit the target", () => {
    expect(
      issuePaths({
        ...baseInput,
        effects: [
          {
            target: { kind: "allSeries" },
            trigger: { kind: "cue" },
            effect: { kind: "emphasize", style: "frame", tone: "primary" },
          },
        ],
      }),
    ).toContain("effects.0.effect");
    expect(
      issuePaths({
        ...baseInput,
        effects: [
          {
            target: { kind: "category", categoryKey: "1月" },
            trigger: { kind: "cue" },
            effect: { kind: "appear", preset: "draw", durationMs: 600 },
          },
        ],
      }),
    ).toContain("effects.0.effect");
    expect(
      issuePaths({
        ...baseInput,
        effects: [
          {
            target: { kind: "series", seriesKey: "sales" },
            trigger: { kind: "cue" },
            effect: {
              kind: "emphasize",
              style: "frame",
              tone: "primary",
              onset: { preset: "pop", durationMs: 300 },
            },
          },
        ],
      }),
    ).toContain("effects.0.effect.onset");
  });

  it("rejects background emphasis, value without labels, and unknown keys", () => {
    expect(
      issuePaths({
        ...baseInput,
        effects: [
          {
            target: { kind: "point", categoryKey: "1月", seriesKey: "sales" },
            trigger: { kind: "cue" },
            effect: { kind: "emphasize", style: "background", tone: "primary" },
          },
        ],
      }),
    ).toContain("effects.0.effect.style");
    expect(
      issuePaths({
        ...baseInput,
        style: { valueLabels: false },
        effects: [
          {
            target: { kind: "series", seriesKey: "sales" },
            trigger: { kind: "cue" },
            effect: { kind: "value", durationMs: 600 },
          },
        ],
      }),
    ).toContain("effects.0.effect");
    expect(
      issuePaths({
        ...baseInput,
        effects: [
          {
            target: { kind: "series", seriesKey: "missing" },
            trigger: { kind: "cue" },
            effect: { kind: "appear", preset: "draw", durationMs: 600 },
          },
        ],
      }),
    ).toContain("effects.0.target.seriesKey");
    expect(
      issuePaths({
        ...baseInput,
        effects: [
          {
            target: { kind: "category", categoryKey: "12月" },
            trigger: { kind: "cue" },
            effect: { kind: "emphasize", style: "frame", tone: "primary" },
          },
        ],
      }),
    ).toContain("effects.0.target.categoryKey");
  });

  it("limits axisUnit to integer and decimal series", () => {
    expect(
      chartLineInputSchema.safeParse({
        ...baseInput,
        style: { axisUnit: "円" },
      }).success,
    ).toBe(false);
    expect(
      chartLineInputSchema.safeParse({
        ...baseInput,
        data: {
          columns: [
            { key: "month", label: "月", type: "text" },
            { key: "sales", label: "売上", type: "number", format: "integer" },
          ],
          rows: baseData.rows,
        },
        style: { axisUnit: "件" },
      }).success,
    ).toBe(true);
  });
});

describe("chart line geometry", () => {
  it("parses finite numeric strings and rejects blank values", () => {
    expect(parseChartLineNumber("1.5")).toBe(1.5);
    expect(parseChartLineNumber(2)).toBe(2);
    expect(parseChartLineNumber("")).toBeNull();
    expect(parseChartLineNumber("abc")).toBeNull();
    expect(parseChartLineNumber(Number.NaN)).toBeNull();
  });

  it("computes deterministic nice ticks without forcing zero", () => {
    const axis = computeChartLineAxis([100, 120]);
    expect(axis).toEqual(computeChartLineAxis([120, 100]));
    expect(axis.min).toBeGreaterThan(0);
    expect(axis.ticks[0]).toBe(axis.min);
    expect(axis.ticks.at(-1)).toBe(axis.max);
  });

  it("keeps a non-zero range around an all-equal series", () => {
    const axis = computeChartLineAxis([50, 50]);
    expect(axis.min).toBeLessThan(50);
    expect(axis.max).toBeGreaterThan(50);
    expect(axis.step).toBeGreaterThan(0);
  });

  it("emits straight paths and cumulative marker fractions from the same points", () => {
    const geometry = computeChartLineGeometry({
      values: [
        [0, 10],
        [1, 20],
      ],
      seriesKeys: ["a", "b"],
      width: 1000,
    });
    const series = geometry.series[0]!;
    expect(series.path).toMatch(/^M-?[\d.]+ -?[\d.]+( L-?[\d.]+ -?[\d.]+)+$/);
    expect(series.path).not.toContain("C");
    expect(series.fractions[0]).toBe(0);
    expect(series.fractions.at(-1)).toBeCloseTo(1, 9);
    expect(series.length).toBeGreaterThan(0);
    const second = geometry.series[1]!;
    expect(second.points[0]!.y).not.toBe(series.points[0]!.y);
  });

  it("clamps wide labels inside the plot and above the category axis", () => {
    const geometry = computeChartLineGeometry({
      values: [
        [-100, -100],
        [100, 100],
      ],
      seriesKeys: ["a", "b"],
      width: 400,
      labelTexts: [
        ["1,000,000,000,000,000", "1,000,000,000,000,000"],
        ["1,000,000,000,000,000", "1,000,000,000,000,000"],
      ],
    });
    for (const label of geometry.labels) {
      expect(label.width).toBeLessThanOrEqual(geometry.plotRight - geometry.plotLeft);
      expect(label.x - label.width / 2).toBeGreaterThanOrEqual(geometry.plotLeft - 0.01);
      expect(label.x + label.width / 2).toBeLessThanOrEqual(geometry.plotRight + 0.01);
      expect(label.y - label.height / 2).toBeGreaterThanOrEqual(geometry.plotTop - 0.01);
      expect(label.y + label.height / 2).toBeLessThanOrEqual(geometry.plotBottom + 0.01);
    }
  });

  it("detects value-label overlap without dropping labels", () => {
    const geometry = computeChartLineGeometry({
      values: [
        [0, 0, 0, 0],
        [1, 1, 1, 1],
      ],
      seriesKeys: ["a", "b", "c", "d"],
      width: 500,
      labelTexts: [
        ["1,000,000", "1,000,000", "1,000,000", "1,000,000"],
        ["1,000,000", "1,000,000", "1,000,000", "1,000,000"],
      ],
    });
    expect(geometry.labels).toHaveLength(8);
    expect(geometry.labelOverlap).toBe(true);
  });
});
