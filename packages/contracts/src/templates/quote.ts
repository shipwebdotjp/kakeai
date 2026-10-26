import { z } from "zod";
import { DEFAULT_TRANSITION_POLICY } from "../content/layers";
import { DEFAULT_ANIMATION_POLICY } from "../content/animation";
import { tableToneSchema } from "../content/tone";
import { cueEffectSchema, lineTriggerSchema } from "../content/cue-effect";
import type { VisualTemplateDefinition } from "./shared";
import { TONE_OPTIONS } from "./common";
import { createEffectsLineRefCollector } from "./line-refs";

export const QUOTE_STYLE_PRESETS = ["plain", "card"] as const;
export const quoteStylePresetSchema = z.enum(QUOTE_STYLE_PRESETS);
export type QuoteStylePreset = z.infer<typeof quoteStylePresetSchema>;

export const quoteStyleSchema = z.strictObject({
  tone: tableToneSchema.default("primary"),
  preset: quoteStylePresetSchema.default("plain"),
});
export type QuoteStyle = z.infer<typeof quoteStyleSchema>;

export const quoteEffectSchema = z.strictObject({
  trigger: lineTriggerSchema,
  effect: cueEffectSchema,
});
export type QuoteEffect = z.infer<typeof quoteEffectSchema>;

export const quoteEffectsSchema = z.array(quoteEffectSchema).max(16);

export const quoteInputSchema = z.strictObject({
  quote: z.string(),
  author: z.string().optional(),
  source: z.string().optional(),
  style: quoteStyleSchema.optional(),
  effects: quoteEffectsSchema.optional(),
});
export type QuoteInput = z.infer<typeof quoteInputSchema>;

const QUOTE_STYLE_PRESET_OPTIONS = [
  { value: "plain", label: "シンプル" },
  { value: "card", label: "カード" },
] as const;

export const quoteV1: VisualTemplateDefinition = {
  id: "quote",
  version: 1,
  inputSchema: quoteInputSchema,
  layers: ["card", "overlay"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "引用", description: "著者・出典付きの引用カード", category: "text" },
  inputFields: [
    { kind: "text", key: "quote", label: "引用" },
    { kind: "optionalText", key: "author", label: "著者" },
    { kind: "optionalText", key: "source", label: "出典" },
    { kind: "select", key: "style.tone", label: "色", options: TONE_OPTIONS },
    { kind: "select", key: "style.preset", label: "スタイル", options: QUOTE_STYLE_PRESET_OPTIONS },
    { kind: "effects", key: "effects", label: "セリフ同期の効果", variant: "quote" },
  ],
  exampleInput: {
    quote: "測れるものしか改善できない",
    author: "Peter Drucker",
    source: "Management",
    style: { tone: "primary", preset: "card" },
    effects: [
      {
        trigger: { kind: "cue" },
        effect: { kind: "appear", preset: "fade", durationMs: 400 },
      },
    ],
  } satisfies z.input<typeof quoteInputSchema>,
  collectAssetRefs: () => [],
  collectLineRefs: createEffectsLineRefCollector(),
};
