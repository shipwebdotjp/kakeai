import { z } from "zod";
import { nonNegativeInt } from "../content/primitives";
import { DEFAULT_TRANSITION_POLICY } from "../content/layers";
import { DEFAULT_ANIMATION_POLICY } from "../content/animation";
import {
  emphasizeEffectSchema,
  lineTriggerSchema,
  valueEffectSchema,
} from "../content/cue-effect";
import type { VisualTemplateDefinition } from "./shared";
import { EXAMPLE_LINE_TRIGGER } from "./common";
import { refineFigureData } from "./figure";
import { FIGURE_WIDTH_OPTIONS, figureWidthSchema } from "./figure-width";
import { tableColumnSchema, tableRowSchema } from "./table";
import { createEffectsLineRefCollector } from "./line-refs";
import {
  CHART_LINE_MAX_CATEGORIES,
  CHART_LINE_MAX_COLUMNS,
  CHART_LINE_MIN_CATEGORIES,
  parseChartLineNumber,
} from "./chart-line-layout";

export const chartLineStylePresetSchema = z.enum(["clean", "grid"]);
export type ChartLineStylePreset = z.infer<typeof chartLineStylePresetSchema>;

export const chartLineAppearPresetSchema = z.enum(["draw", "fade"]);
export type ChartLineAppearPreset = z.infer<typeof chartLineAppearPresetSchema>;
export const CHART_LINE_APPEAR_PRESETS = chartLineAppearPresetSchema.options;

export const chartLineDataSchema = z
  .strictObject({
    columns: z.array(tableColumnSchema).min(2).max(CHART_LINE_MAX_COLUMNS),
    rows: z
      .array(tableRowSchema)
      .min(CHART_LINE_MIN_CATEGORIES)
      .max(CHART_LINE_MAX_CATEGORIES),
  })
  .superRefine((data, ctx) => {
    refineFigureData(data, ctx);
    const categoryColumn = data.columns[0];
    if (categoryColumn === undefined || categoryColumn.type !== "text") {
      ctx.addIssue({
        code: "custom",
        message: "先頭の列はカテゴリ（文字列）にしてください",
        path: ["columns", 0, "type"],
      });
    }
    const seriesColumns = data.columns.slice(1);
    seriesColumns.forEach((column, index) => {
      if (column.type !== "number") {
        ctx.addIssue({
          code: "custom",
          message: "2列目以降は系列（数値）にしてください",
          path: ["columns", index + 1, "type"],
        });
      }
    });
    if (categoryColumn === undefined) {
      return;
    }
    const seenCategories = new Set<string>();
    data.rows.forEach((row, rowIndex) => {
      const category = row[categoryColumn.key];
      if (typeof category !== "string" || category.trim().length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "カテゴリは空白でない文字列にしてください",
          path: ["rows", rowIndex, categoryColumn.key],
        });
        return;
      }
      const normalized = category.trim();
      if (normalized !== category) {
        ctx.addIssue({
          code: "custom",
          message: "カテゴリの前後に空白を入れないでください",
          path: ["rows", rowIndex, categoryColumn.key],
        });
        return;
      }
      if (seenCategories.has(normalized)) {
        ctx.addIssue({
          code: "custom",
          message: `カテゴリが重複しています: ${normalized}`,
          path: ["rows", rowIndex, categoryColumn.key],
        });
        return;
      }
      seenCategories.add(normalized);
    });
    seriesColumns.forEach((column, seriesIndex) => {
      if (column.type !== "number") {
        return;
      }
      data.rows.forEach((row, rowIndex) => {
        const value = row[column.key];
        if (parseChartLineNumber(value) === null) {
          ctx.addIssue({
            code: "custom",
            message: `系列「${column.label}」の値は有限の数値にしてください`,
            path: ["rows", rowIndex, column.key],
          });
        }
      });
      const format = column.format ?? null;
      if (format !== (seriesColumns[0]?.format ?? null)) {
        ctx.addIssue({
          code: "custom",
          message: "全系列の数値書式を揃えてください",
          path: ["columns", seriesIndex + 1, "format"],
        });
      }
    });
  });
export type ChartLineData = z.infer<typeof chartLineDataSchema>;

export const chartLineStyleSchema = z.strictObject({
  preset: chartLineStylePresetSchema.default("clean"),
  width: figureWidthSchema.optional(),
  valueLabels: z.boolean().default(false),
  axisUnit: z.string().max(8).optional(),
});
export type ChartLineStyle = z.infer<typeof chartLineStyleSchema>;

export const chartLineEffectTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("allSeries") }),
  z.strictObject({ kind: z.literal("series"), seriesKey: z.string().min(1).max(64) }),
  z.strictObject({ kind: z.literal("category"), categoryKey: z.string().min(1) }),
  z.strictObject({
    kind: z.literal("point"),
    categoryKey: z.string().min(1),
    seriesKey: z.string().min(1).max(64),
  }),
]);
export type ChartLineEffectTarget = z.infer<typeof chartLineEffectTargetSchema>;

export const chartLineAppearEffectSchema = z.strictObject({
  kind: z.literal("appear"),
  preset: chartLineAppearPresetSchema,
  durationMs: nonNegativeInt,
});
export type ChartLineAppearEffect = z.infer<typeof chartLineAppearEffectSchema>;

export const chartLineCueEffectSchema = z.discriminatedUnion("kind", [
  chartLineAppearEffectSchema,
  emphasizeEffectSchema,
  valueEffectSchema,
]);
export type ChartLineCueEffect = z.infer<typeof chartLineCueEffectSchema>;

export const chartLineEffectSchema = z.strictObject({
  target: chartLineEffectTargetSchema,
  trigger: lineTriggerSchema,
  effect: chartLineCueEffectSchema,
});
export type ChartLineEffect = z.infer<typeof chartLineEffectSchema>;

export const chartLineEffectsSchema = z.array(chartLineEffectSchema).max(32);

function targetEffectAllowed(
  target: ChartLineEffectTarget,
  effect: ChartLineCueEffect,
): boolean {
  switch (target.kind) {
    case "allSeries":
      return effect.kind === "appear" || effect.kind === "value";
    case "series":
      return true;
    case "category":
    case "point":
      return effect.kind === "emphasize" || effect.kind === "value";
  }
}

export const chartLineInputSchema = z
  .strictObject({
    title: z.string().optional(),
    data: chartLineDataSchema,
    style: chartLineStyleSchema.optional(),
    effects: chartLineEffectsSchema.optional(),
  })
  .superRefine((input, ctx) => {
    const seriesColumns = input.data.columns.slice(1);
    const seriesKeys = new Set(seriesColumns.map((column) => column.key));
    const categoryColumn = input.data.columns[0];
    const categories = new Set(
      input.data.rows.map((row) =>
        categoryColumn === undefined ? undefined : row[categoryColumn.key],
      ),
    );
    const formats = new Set(seriesColumns.map((column) => column.format ?? null));
    if (
      input.style?.axisUnit !== undefined &&
      formats.size === 1 &&
      (formats.has("currency") || formats.has("percent"))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "軸の単位は integer または decimal の系列にだけ指定できます",
        path: ["style", "axisUnit"],
      });
    }
    (input.effects ?? []).forEach((entry, index) => {
      const target = entry.target;
      if (
        (target.kind === "series" || target.kind === "point") &&
        !seriesKeys.has(target.seriesKey)
      ) {
        ctx.addIssue({
          code: "custom",
          message: `効果の系列キーが未定義です: ${target.seriesKey}`,
          path: ["effects", index, "target", "seriesKey"],
        });
      }
      if (
        (target.kind === "category" || target.kind === "point") &&
        !categories.has(target.categoryKey)
      ) {
        ctx.addIssue({
          code: "custom",
          message: `効果のカテゴリが未定義です: ${target.categoryKey}`,
          path: ["effects", index, "target", "categoryKey"],
        });
      }
      if (!targetEffectAllowed(target, entry.effect)) {
        ctx.addIssue({
          code: "custom",
          message: "この対象には指定できない効果です",
          path: ["effects", index, "effect"],
        });
      }
      if (entry.effect.kind === "emphasize") {
        if (entry.effect.style === "background") {
          ctx.addIssue({
            code: "custom",
            message: "折れ線グラフの強調は frame か spotlight を指定してください",
            path: ["effects", index, "effect", "style"],
          });
        }
        if (
          entry.effect.onset !== undefined &&
          target.kind !== "category" &&
          target.kind !== "point"
        ) {
          ctx.addIssue({
            code: "custom",
            message: "onset はカテゴリか個別点にだけ指定できます",
            path: ["effects", index, "effect", "onset"],
          });
        }
      }
      if (
        entry.effect.kind === "value" &&
        (input.style?.valueLabels ?? false) === false
      ) {
        ctx.addIssue({
          code: "custom",
          message: "数値のカウントには値ラベルを有効にしてください",
          path: ["effects", index, "effect"],
        });
      }
    });
  });
export type ChartLineInput = z.infer<typeof chartLineInputSchema>;

const CHART_LINE_STYLE_PRESET_OPTIONS = [
  { value: "clean", label: "シンプル" },
  { value: "grid", label: "目盛り線" },
] as const;

export const chartLineV1: VisualTemplateDefinition = {
  id: "chart.line",
  version: 1,
  inputSchema: chartLineInputSchema,
  layers: ["card", "overlay"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: {
    label: "折れ線グラフ",
    description: "等間隔カテゴリに対する数値系列の推移",
    category: "data",
  },
  inputFields: [
    { kind: "optionalText", key: "title", label: "タイトル" },
    {
      kind: "grid",
      key: "data",
      label: "グラフデータ",
      maxColumns: CHART_LINE_MAX_COLUMNS,
      maxRows: CHART_LINE_MAX_CATEGORIES,
      dataKind: "chart-line",
    },
    {
      kind: "select",
      key: "style.preset",
      label: "目盛り線",
      options: CHART_LINE_STYLE_PRESET_OPTIONS,
    },
    {
      kind: "select",
      key: "style.width",
      label: "幅",
      options: FIGURE_WIDTH_OPTIONS,
      defaultValue: "wide",
    },
    { kind: "optionalText", key: "style.axisUnit", label: "軸の単位" },
    { kind: "boolean", key: "style.valueLabels", label: "値ラベル" },
    { kind: "effects", key: "effects", label: "セリフ同期の効果", variant: "line" },
  ],
  exampleInput: {
    title: "月別売上",
    data: {
      columns: [
        { key: "month", label: "月", type: "text" },
        { key: "sales", label: "売上", type: "number", format: "currency" },
        { key: "plan", label: "計画", type: "number", format: "currency" },
      ],
      rows: [
        { month: "1月", sales: 120, plan: 100 },
        { month: "2月", sales: 150, plan: 130 },
      ],
    },
    style: { preset: "grid", width: "wide", valueLabels: false },
    effects: [
      {
        target: { kind: "allSeries" },
        trigger: EXAMPLE_LINE_TRIGGER,
        effect: { kind: "appear", preset: "draw", durationMs: 600 },
      },
    ],
  } satisfies z.input<typeof chartLineInputSchema>,
  collectAssetRefs: () => [],
  collectLineRefs: createEffectsLineRefCollector(),
};
