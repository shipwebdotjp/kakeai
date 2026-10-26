import { z } from "zod";
import { DEFAULT_TRANSITION_POLICY } from "../content/layers";
import { DEFAULT_ANIMATION_POLICY } from "../content/animation";
import {
  appearEffectSchema,
  cueEffectSchema,
  lineTriggerSchema,
} from "../content/cue-effect";
import type { VisualTemplateDefinition } from "./shared";
import { EXAMPLE_LINE_TRIGGER } from "./common";
import { collectTriggerLineRefs, readInputField } from "./line-refs";

export const LIST_CALLOUT_MAX_ITEMS = 8;

export const listCalloutItemSchema = z
  .strictObject({
    text: z.string(),
    trigger: lineTriggerSchema.optional(),
    effect: cueEffectSchema.optional(),
  })
  .superRefine((item, ctx) => {
    if ((item.trigger === undefined) !== (item.effect === undefined)) {
      ctx.addIssue({
        code: "custom",
        message: "trigger と effect は同時に指定してください",
        path: ["trigger"],
      });
    }
  });
export type ListCalloutItem = z.infer<typeof listCalloutItemSchema>;

export const listCalloutItemsSchema = z
  .array(listCalloutItemSchema)
  .min(1)
  .max(LIST_CALLOUT_MAX_ITEMS);

export const listCalloutAppearSchema = z.strictObject({
  trigger: lineTriggerSchema,
  effect: appearEffectSchema,
});
export type ListCalloutAppear = z.infer<typeof listCalloutAppearSchema>;

export const listCalloutWidthSchema = z.enum(["long", "medium", "short"]);
export type ListCalloutWidth = z.infer<typeof listCalloutWidthSchema>;

export const listCalloutAlignSchema = z.enum(["left", "center", "right"]);
export type ListCalloutAlign = z.infer<typeof listCalloutAlignSchema>;

export const listCalloutInputSchema = z.strictObject({
  title: z.string().optional(),
  width: listCalloutWidthSchema.optional(),
  align: listCalloutAlignSchema.optional(),
  items: listCalloutItemsSchema,
  appear: listCalloutAppearSchema.optional(),
});
export type ListCalloutInput = z.infer<typeof listCalloutInputSchema>;

export const listCalloutV1: VisualTemplateDefinition = {
  id: "list.callout",
  version: 1,
  inputSchema: listCalloutInputSchema,
  layers: ["card", "overlay"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: {
    label: "ポイント",
    description: "セリフに同期して強調する箇条書き",
    category: "text",
  },
  inputFields: [
    { kind: "optionalText", key: "title", label: "見出し" },
    {
      kind: "select",
      key: "width",
      label: "幅",
      options: [
        { value: "long", label: "長い" },
        { value: "medium", label: "中くらい" },
        { value: "short", label: "短い" },
      ],
    },
    {
      kind: "select",
      key: "align",
      label: "揃え",
      options: [
        { value: "left", label: "左揃え" },
        { value: "center", label: "中央揃え" },
        { value: "right", label: "右揃え" },
      ],
    },
    { kind: "calloutItems", key: "items", label: "ポイント" },
  ],
  exampleInput: {
    title: "この動画のポイント",
    width: "medium",
    align: "left",
    items: [
      {
        text: "台本は正本JSONで保持される",
        trigger: EXAMPLE_LINE_TRIGGER,
        effect: { kind: "appear", preset: "fade", durationMs: 300 },
      },
      { text: "レンダーは何度でもやり直せる" },
    ],
    appear: {
      trigger: { kind: "cue" },
      effect: { kind: "appear", preset: "slide-up", durationMs: 400 },
    },
  } satisfies z.input<typeof listCalloutInputSchema>,
  collectAssetRefs: () => [],
  collectLineRefs: (input, path) => {
    const rawItems = readInputField(input, "items");
    const refs = Array.isArray(rawItems)
      ? rawItems.flatMap((raw, index) => {
          const parsed = listCalloutItemSchema.safeParse(raw);
          if (!parsed.success) {
            return [];
          }
          return collectTriggerLineRefs(parsed.data.trigger, [
            ...path,
            "items",
            index,
            "trigger",
          ]);
        })
      : [];
    const appear = listCalloutAppearSchema.safeParse(readInputField(input, "appear"));
    if (appear.success) {
      refs.push(...collectTriggerLineRefs(appear.data.trigger, [...path, "appear", "trigger"]));
    }
    return refs;
  },
};
