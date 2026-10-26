import { z } from "zod";
import { DEFAULT_TRANSITION_POLICY } from "../content/layers";
import { DEFAULT_ANIMATION_POLICY } from "../content/animation";
import { tableToneSchema } from "../content/tone";
import { lineTriggerSchema, numericEffectSchema } from "../content/cue-effect";
import type { VisualTemplateDefinition } from "./shared";
import { EXAMPLE_LINE_TRIGGER, TONE_OPTIONS } from "./common";
import { createEffectsLineRefCollector } from "./line-refs";

export const STAT_FORMATS = ["integer", "decimal", "percent", "currency"] as const;
export const statFormatSchema = z.enum(STAT_FORMATS);
export type StatFormat = z.infer<typeof statFormatSchema>;

export const statStylePresetSchema = z.enum(["plain", "card"]);
export type StatStylePreset = z.infer<typeof statStylePresetSchema>;

export const statStyleSchema = z.strictObject({
  tone: tableToneSchema.default("primary"),
  preset: statStylePresetSchema.default("plain"),
});
export type StatStyle = z.infer<typeof statStyleSchema>;

export const statEffectSchema = z.strictObject({
  trigger: lineTriggerSchema,
  effect: numericEffectSchema,
});
export type StatEffect = z.infer<typeof statEffectSchema>;

export const statEffectsSchema = z.array(statEffectSchema).max(16);

export const statInputSchema = z.strictObject({
  value: z.number().finite(),
  label: z.string().optional(),
  caption: z.string().optional(),
  format: statFormatSchema.default("integer"),
  style: statStyleSchema.optional(),
  effects: statEffectsSchema.optional(),
});
export type StatInput = z.infer<typeof statInputSchema>;

const STAT_FORMAT_OPTIONS = [
  { value: "integer", label: "整数" },
  { value: "decimal", label: "小数" },
  { value: "percent", label: "パーセント" },
  { value: "currency", label: "金額" },
] as const;

const STAT_STYLE_PRESET_OPTIONS = [
  { value: "plain", label: "シンプル" },
  { value: "card", label: "カード" },
] as const;

export const statV1: VisualTemplateDefinition = {
  id: "stat",
  version: 1,
  inputSchema: statInputSchema,
  layers: ["card", "overlay"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "数値", description: "大きな数値とラベルの1点強調", category: "data" },
  inputFields: [
    { kind: "decimal", key: "value", label: "数値（カウント後の値）", defaultValue: 100 },
    { kind: "optionalText", key: "label", label: "ラベル" },
    { kind: "optionalText", key: "caption", label: "補足" },
    { kind: "select", key: "format", label: "書式", options: STAT_FORMAT_OPTIONS },
    { kind: "select", key: "style.tone", label: "色", options: TONE_OPTIONS },
    { kind: "select", key: "style.preset", label: "スタイル", options: STAT_STYLE_PRESET_OPTIONS },
    { kind: "effects", key: "effects", label: "セリフ同期の効果", variant: "stat" },
  ],
  exampleInput: {
    value: 120,
    label: "前年比",
    caption: "2026年 第1四半期",
    format: "percent",
    style: { tone: "success", preset: "card" },
    effects: [
      {
        trigger: EXAMPLE_LINE_TRIGGER,
        effect: { kind: "value", from: 0, durationMs: 800 },
      },
    ],
  } satisfies z.input<typeof statInputSchema>,
  collectAssetRefs: () => [],
  collectLineRefs: createEffectsLineRefCollector(),
};
