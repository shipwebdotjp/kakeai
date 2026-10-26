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
import { tableColumnSchema, tableRowSchema } from "./table";
import { createEffectsLineRefCollector } from "./line-refs";

export const CHART_MAX_CATEGORIES = 8;
export const CHART_MAX_SERIES = 4;
export const CHART_MAX_COLUMNS = CHART_MAX_SERIES + 1;

export const chartOrientationSchema = z.enum(["vertical", "horizontal"]);
export type ChartOrientation = z.infer<typeof chartOrientationSchema>;

export const chartColorBySchema = z.enum(["series", "category"]);
export type ChartColorBy = z.infer<typeof chartColorBySchema>;

export const chartStylePresetSchema = z.enum(["clean", "grid"]);
export type ChartStylePreset = z.infer<typeof chartStylePresetSchema>;

export const chartAppearPresetSchema = z.enum(["grow", "bounce", "fade"]);
export type ChartAppearPreset = z.infer<typeof chartAppearPresetSchema>;
export const CHART_APPEAR_PRESETS = chartAppearPresetSchema.options;

export const chartDataSchema = z
  .strictObject({
    columns: z.array(tableColumnSchema).min(2).max(CHART_MAX_COLUMNS),
    rows: z.array(tableRowSchema).min(1).max(CHART_MAX_CATEGORIES),
  })
  .superRefine((data, ctx) => {
    refineFigureData(data, ctx);
    if (data.columns[0]?.type !== "text") {
      ctx.addIssue({
        code: "custom",
        message: "先頭の列はカテゴリ（文字列）にしてください",
        path: ["columns", 0, "type"],
      });
    }
    data.columns.slice(1).forEach((column, index) => {
      if (column.type !== "number") {
        ctx.addIssue({
          code: "custom",
          message: "2列目以降は系列（数値）にしてください",
          path: ["columns", index + 1, "type"],
        });
        return;
      }
      data.rows.forEach((row, rowIndex) => {
        const value = row[column.key];
        if (value === undefined) {
          return;
        }
        const numeric = typeof value === "number" ? value : Number(value);
        if (typeof value === "string" && value.trim() !== "" && !Number.isFinite(numeric)) {
          ctx.addIssue({
            code: "custom",
            message: `系列「${column.label}」の値は数値にしてください`,
            path: ["rows", rowIndex, column.key],
          });
        }
      });
    });
  });
export type ChartData = z.infer<typeof chartDataSchema>;

export const chartStyleSchema = z.strictObject({
  preset: chartStylePresetSchema.default("clean"),
  orientation: chartOrientationSchema.default("vertical"),
  valueLabels: z.boolean().default(true),
  colorBy: chartColorBySchema.optional(),
  axisUnit: z.string().max(8).optional(),
});
export type ChartStyle = z.infer<typeof chartStyleSchema>;

export const chartEffectTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("category"), index: nonNegativeInt }),
  z.strictObject({ kind: z.literal("series"), index: nonNegativeInt }),
  z.strictObject({ kind: z.literal("bars") }),
]);
export type ChartEffectTarget = z.infer<typeof chartEffectTargetSchema>;

export const chartAppearEffectSchema = z.strictObject({
  kind: z.literal("appear"),
  preset: chartAppearPresetSchema,
  durationMs: nonNegativeInt,
  staggerMs: nonNegativeInt.optional(),
});
export type ChartAppearEffect = z.infer<typeof chartAppearEffectSchema>;

export const chartCueEffectSchema = z.discriminatedUnion("kind", [
  chartAppearEffectSchema,
  emphasizeEffectSchema,
  valueEffectSchema,
]);
export type ChartCueEffect = z.infer<typeof chartCueEffectSchema>;

export const chartEffectSchema = z.strictObject({
  target: chartEffectTargetSchema,
  trigger: lineTriggerSchema,
  effect: chartCueEffectSchema,
});
export type ChartEffect = z.infer<typeof chartEffectSchema>;

export const chartEffectsSchema = z.array(chartEffectSchema).max(32);

export const chartBarInputSchema = z
  .strictObject({
    title: z.string().optional(),
    data: chartDataSchema,
    style: chartStyleSchema.optional(),
    effects: chartEffectsSchema.optional(),
  })
  .superRefine((input, ctx) => {
    const seriesCount = Math.max(0, input.data.columns.length - 1);
    (input.effects ?? []).forEach((entry, index) => {
      if (
        entry.target.kind === "category" &&
        entry.target.index >= input.data.rows.length
      ) {
        ctx.addIssue({
          code: "custom",
          message: `効果のカテゴリ番号が範囲外です: ${entry.target.index}`,
          path: ["effects", index, "target", "index"],
        });
      }
      if (entry.target.kind === "series" && entry.target.index >= seriesCount) {
        ctx.addIssue({
          code: "custom",
          message: `効果の系列番号が範囲外です: ${entry.target.index}`,
          path: ["effects", index, "target", "index"],
        });
      }
      if (entry.effect.kind === "emphasize" && entry.effect.style === "background") {
        ctx.addIssue({
          code: "custom",
          message: "棒グラフの強調は frame か spotlight を指定してください",
          path: ["effects", index, "effect", "style"],
        });
      }
      if (entry.effect.kind === "value" && (input.style?.valueLabels ?? true) === false) {
        ctx.addIssue({
          code: "custom",
          message: "数値のカウントには値ラベルを有効にしてください",
          path: ["effects", index, "effect"],
        });
      }
    });
  });
export type ChartBarInput = z.infer<typeof chartBarInputSchema>;

const CHART_STYLE_PRESET_OPTIONS = [
  { value: "clean", label: "シンプル" },
  { value: "grid", label: "目盛り線" },
] as const;

const CHART_ORIENTATION_OPTIONS = [
  { value: "vertical", label: "縦棒" },
  { value: "horizontal", label: "横棒" },
] as const;

const CHART_COLOR_BY_OPTIONS = [
  { value: "series", label: "系列ごと" },
  { value: "category", label: "カテゴリごと" },
] as const;

export const chartBarV1: VisualTemplateDefinition = {
  id: "chart.bar",
  version: 1,
  inputSchema: chartBarInputSchema,
  layers: ["card", "overlay"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "棒グラフ", description: "カテゴリと系列を持つ棒グラフ", category: "data" },
  inputFields: [
    { kind: "optionalText", key: "title", label: "タイトル" },
    {
      kind: "grid",
      key: "data",
      label: "グラフデータ",
      maxColumns: CHART_MAX_COLUMNS,
      maxRows: CHART_MAX_CATEGORIES,
      dataKind: "chart",
    },
    { kind: "select", key: "style.preset", label: "目盛り線", options: CHART_STYLE_PRESET_OPTIONS },
    { kind: "select", key: "style.orientation", label: "向き", options: CHART_ORIENTATION_OPTIONS },
    {
      kind: "select",
      key: "style.colorBy",
      label: "色分け",
      options: CHART_COLOR_BY_OPTIONS,
      optional: true,
    },
    { kind: "optionalText", key: "style.axisUnit", label: "軸の単位" },
    { kind: "boolean", key: "style.valueLabels", label: "値ラベル" },
    { kind: "effects", key: "effects", label: "セリフ同期の効果", variant: "chart" },
  ],
  exampleInput: {
    title: "四半期の売上",
    data: {
      columns: [
        { key: "quarter", label: "四半期", type: "text" },
        { key: "thisYear", label: "今年", type: "number", format: "integer" },
        { key: "lastYear", label: "昨年", type: "number", format: "integer" },
      ],
      rows: [
        { quarter: "Q1", thisYear: 120, lastYear: 98 },
        { quarter: "Q2", thisYear: 150, lastYear: 120 },
      ],
    },
    style: { preset: "grid", orientation: "vertical", valueLabels: true, axisUnit: "件" },
    effects: [
      {
        target: { kind: "bars" },
        trigger: EXAMPLE_LINE_TRIGGER,
        effect: { kind: "appear", preset: "grow", durationMs: 600, staggerMs: 80 },
      },
    ],
  } satisfies z.input<typeof chartBarInputSchema>,
  collectAssetRefs: () => [],
  collectLineRefs: createEffectsLineRefCollector(),
};
