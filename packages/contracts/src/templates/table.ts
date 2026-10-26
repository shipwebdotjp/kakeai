import { z } from "zod";
import { nonNegativeInt } from "../content/primitives";
import { DEFAULT_TRANSITION_POLICY } from "../content/layers";
import { DEFAULT_ANIMATION_POLICY } from "../content/animation";
import { themeAccentTokenSchema } from "../content/theme";
import { lineTriggerSchema, numericEffectSchema } from "../content/cue-effect";
import type { VisualTemplateDefinition } from "./shared";
import { EXAMPLE_LINE_TRIGGER } from "./common";
import { refineFigureData } from "./figure";
import { createEffectsLineRefCollector } from "./line-refs";

export const TABLE_MAX_COLUMNS = 8;
export const TABLE_MAX_ROWS = 12;

export const tableColumnTypeSchema = z.enum(["text", "number"]);
export type TableColumnType = z.infer<typeof tableColumnTypeSchema>;

export const tableCellAlignSchema = z.enum(["left", "center", "right"]);
export type TableCellAlign = z.infer<typeof tableCellAlignSchema>;

export const tableNumberFormatSchema = z.enum(["integer", "decimal", "percent", "currency"]);
export type TableNumberFormat = z.infer<typeof tableNumberFormatSchema>;

export const tableStylePresetSchema = z.enum(["clean", "striped", "bordered"]);
export type TableStylePreset = z.infer<typeof tableStylePresetSchema>;

export const tableColumnSchema = z.strictObject({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
  label: z.string(),
  type: tableColumnTypeSchema,
  align: tableCellAlignSchema.optional(),
  format: tableNumberFormatSchema.optional(),
});
export type TableColumn = z.infer<typeof tableColumnSchema>;

export const tableRowSchema = z.record(
  z.string().min(1).max(64),
  z.union([z.string(), z.number()]),
);
export type TableRow = z.infer<typeof tableRowSchema>;

export const tableDataSchema = z
  .strictObject({
    columns: z.array(tableColumnSchema).min(1).max(TABLE_MAX_COLUMNS),
    rows: z.array(tableRowSchema).max(TABLE_MAX_ROWS),
  })
  .superRefine((data, ctx) => {
    refineFigureData(data, ctx);
  });
export type TableData = z.infer<typeof tableDataSchema>;

export const tableStyleSchema = z.strictObject({
  preset: tableStylePresetSchema.default("clean"),
  zebra: z.boolean().optional(),
  headerAccent: themeAccentTokenSchema.optional(),
});
export type TableStyle = z.infer<typeof tableStyleSchema>;

export const tableEffectTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("row"), index: nonNegativeInt }),
  z.strictObject({ kind: z.literal("cell"), row: nonNegativeInt, key: z.string().min(1).max(64) }),
  z.strictObject({ kind: z.literal("rows") }),
  z.strictObject({ kind: z.literal("columns") }),
]);
export type TableEffectTarget = z.infer<typeof tableEffectTargetSchema>;

export const tableEffectSchema = z.strictObject({
  target: tableEffectTargetSchema,
  trigger: lineTriggerSchema,
  effect: numericEffectSchema,
});
export type TableEffect = z.infer<typeof tableEffectSchema>;

export const tableEffectsSchema = z.array(tableEffectSchema).max(32);

export const tableSimpleInputSchema = z
  .strictObject({
    caption: z.string().optional(),
    data: tableDataSchema,
    style: tableStyleSchema.optional(),
    effects: tableEffectsSchema.optional(),
  })
  .superRefine((input, ctx) => {
    const known = new Set(input.data.columns.map((column) => column.key));
    (input.effects ?? []).forEach((entry, index) => {
      if (
        entry.target.kind === "row" &&
        entry.target.index >= input.data.rows.length
      ) {
        ctx.addIssue({
          code: "custom",
          message: `効果の行番号が行数を超えています: ${entry.target.index}`,
          path: ["effects", index, "target", "index"],
        });
      }
      if (entry.target.kind === "cell") {
        if (entry.target.row >= input.data.rows.length) {
          ctx.addIssue({
            code: "custom",
            message: `効果の行番号が行数を超えています: ${entry.target.row}`,
            path: ["effects", index, "target", "row"],
          });
        }
        if (!known.has(entry.target.key)) {
          ctx.addIssue({
            code: "custom",
            message: `効果の列キーが未定義です: ${entry.target.key}`,
            path: ["effects", index, "target", "key"],
          });
        }
      }
      if (entry.effect.kind === "value") {
        const target = entry.target;
        if (target.kind !== "cell") {
          ctx.addIssue({
            code: "custom",
            message: "数値のカウントはセルを対象にしてください",
            path: ["effects", index, "target"],
          });
        } else {
          const column = input.data.columns.find((item) => item.key === target.key);
          if (column !== undefined && column.type !== "number") {
            ctx.addIssue({
              code: "custom",
              message: `数値のカウントは数値列にだけ指定できます: ${column.key}`,
              path: ["effects", index, "target", "key"],
            });
          }
        }
      }
    });
  });
export type TableSimpleInput = z.infer<typeof tableSimpleInputSchema>;

const TABLE_STYLE_PRESET_OPTIONS = [
  { value: "clean", label: "シンプル" },
  { value: "striped", label: "ストライプ" },
  { value: "bordered", label: "格子" },
] as const;

const TABLE_HEADER_ACCENT_OPTIONS = [
  { value: "primary", label: "プライマリ" },
  { value: "secondary", label: "セカンダリ" },
  { value: "tertiary", label: "ターシャリ" },
] as const;

export const tableSimpleV1: VisualTemplateDefinition = {
  id: "table.simple",
  version: 1,
  inputSchema: tableSimpleInputSchema,
  layers: ["card", "overlay"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "表", description: "列定義・行・セルを持つ表", category: "data" },
  inputFields: [
    { kind: "optionalText", key: "caption", label: "見出し" },
    {
      kind: "grid",
      key: "data",
      label: "表データ",
      maxColumns: TABLE_MAX_COLUMNS,
      maxRows: TABLE_MAX_ROWS,
      dataKind: "table",
    },
    { kind: "select", key: "style.preset", label: "スタイル", options: TABLE_STYLE_PRESET_OPTIONS },
    {
      kind: "select",
      key: "style.headerAccent",
      label: "見出しの色",
      options: TABLE_HEADER_ACCENT_OPTIONS,
      optional: true,
    },
    { kind: "boolean", key: "style.zebra", label: "ゼブラ" },
    { kind: "effects", key: "effects", label: "セリフ同期の効果", variant: "table" },
  ],
  exampleInput: {
    caption: "料金プラン",
    data: {
      columns: [
        { key: "plan", label: "プラン", type: "text" },
        { key: "price", label: "月額", type: "number", format: "currency" },
      ],
      rows: [
        { plan: "Free", price: 0 },
        { plan: "Pro", price: 1500 },
      ],
    },
    style: { preset: "striped", headerAccent: "primary", zebra: true },
    effects: [
      {
        target: { kind: "row", index: 1 },
        trigger: EXAMPLE_LINE_TRIGGER,
        effect: { kind: "emphasize", style: "background", tone: "primary" },
      },
    ],
  } satisfies z.input<typeof tableSimpleInputSchema>,
  collectAssetRefs: () => [],
  collectLineRefs: createEffectsLineRefCollector(),
};
