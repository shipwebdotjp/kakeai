import { z } from "zod";
import { idSchema, nonNegativeInt, positiveInt } from "../content/primitives";
import { tableToneSchema } from "../content/tone";
import { livePackageRelativePathSchema } from "./paths";

export const liveCardTypeSchema = z.enum([
  "headline",
  "image",
  "list",
  "chart",
  "quote",
]);
export type LiveCardType = z.infer<typeof liveCardTypeSchema>;

export const liveCardAlignSchema = z.enum(["left", "center"]);
export type LiveCardAlign = z.infer<typeof liveCardAlignSchema>;

export const liveCardAnimationPresetSchema = z.enum([
  "none",
  "fade",
  "slide-up",
  "slide-down",
  "slide-left",
  "slide-right",
  "scale-in",
]);
export type LiveCardAnimationPreset = z.infer<typeof liveCardAnimationPresetSchema>;

const MAX_ANIMATION_MS = 5_000;

/**
 * One entry or update animation. Cards never own a seekable timeline: this
 * describes the cosmetic animation that runs when a card is shown or when a
 * state transition adds or changes an element.
 */
export const liveCardAnimationSchema = z.strictObject({
  preset: liveCardAnimationPresetSchema.default("fade"),
  durationMs: nonNegativeInt.max(MAX_ANIMATION_MS).default(400),
  delayMs: nonNegativeInt.max(MAX_ANIMATION_MS).default(0),
  staggerMs: nonNegativeInt.max(1_000).default(0),
});
export type LiveCardAnimation = z.infer<typeof liveCardAnimationSchema>;

const DEFAULT_ENTER_ANIMATION = {
  preset: "fade",
  durationMs: 400,
  delayMs: 0,
  staggerMs: 0,
} as const;

const DEFAULT_UPDATE_ANIMATION = {
  preset: "fade",
  durationMs: 300,
  delayMs: 0,
  staggerMs: 0,
} as const;

export const liveCardAnimationConfigSchema = z.strictObject({
  enter: liveCardAnimationSchema.default(DEFAULT_ENTER_ANIMATION),
  update: liveCardAnimationSchema.default(DEFAULT_UPDATE_ANIMATION),
});
export type LiveCardAnimationConfig = z.infer<typeof liveCardAnimationConfigSchema>;

const DEFAULT_ANIMATION_CONFIG = {
  enter: DEFAULT_ENTER_ANIMATION,
  update: DEFAULT_UPDATE_ANIMATION,
} as const;

export const liveHeadlineStateSchema = z.strictObject({
  id: idSchema,
  title: z.string().trim().min(1),
  subtitle: z.string().trim().min(1).optional(),
  kicker: z.string().trim().min(1).optional(),
  tone: tableToneSchema.default("primary"),
  align: liveCardAlignSchema.default("center"),
});
export type LiveHeadlineState = z.infer<typeof liveHeadlineStateSchema>;

export const liveImageStateSchema = z.strictObject({
  id: idSchema,
  assetId: idSchema,
  alt: z.string().trim().min(1).optional(),
  caption: z.string().trim().min(1).optional(),
  credit: z.string().trim().min(1).optional(),
  fit: z.enum(["cover", "contain"]).default("cover"),
});
export type LiveImageState = z.infer<typeof liveImageStateSchema>;

export const liveListStateItemSchema = z.strictObject({
  id: idSchema,
  text: z.string().trim().min(1),
  note: z.string().trim().min(1).optional(),
});
export type LiveListStateItem = z.infer<typeof liveListStateItemSchema>;

/**
 * A list state is a complete snapshot of the visible items. An item that is
 * absent from the state is not visible; the next state adds it with a stable
 * item id so the renderer can animate only the delta.
 */
export const liveListStateSchema = z
  .strictObject({
    id: idSchema,
    title: z.string().trim().min(1).optional(),
    items: z.array(liveListStateItemSchema).max(8).default([]),
    activeItemId: idSchema.optional(),
    ordered: z.boolean().default(false),
  })
  .superRefine((state, ctx) => {
    const itemIds = new Set<string>();
    for (const [index, item] of state.items.entries()) {
      if (itemIds.has(item.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "id"],
          message: `リスト項目 ID が重複しています: ${item.id}`,
        });
      }
      itemIds.add(item.id);
    }
    if (state.activeItemId !== undefined && !itemIds.has(state.activeItemId)) {
      ctx.addIssue({
        code: "custom",
        path: ["activeItemId"],
        message: `アクティブ項目が見つかりません: ${state.activeItemId}`,
      });
    }
  });
export type LiveListState = z.infer<typeof liveListStateSchema>;

export const liveChartVariantSchema = z.enum(["bar", "line"]);
export type LiveChartVariant = z.infer<typeof liveChartVariantSchema>;

export const liveChartCategorySchema = z.strictObject({
  key: idSchema,
  label: z.string().trim().min(1),
});
export type LiveChartCategory = z.infer<typeof liveChartCategorySchema>;

export const liveChartSeriesSchema = z.strictObject({
  key: idSchema,
  label: z.string().trim().min(1),
  values: z.record(idSchema, z.number().finite()),
  tone: tableToneSchema.optional(),
});
export type LiveChartSeries = z.infer<typeof liveChartSeriesSchema>;

export const liveChartHighlightSchema = z.strictObject({
  seriesKeys: z.array(idSchema).max(8).default([]),
  categoryKeys: z.array(idSchema).max(12).default([]),
});
export type LiveChartHighlight = z.infer<typeof liveChartHighlightSchema>;

export const liveChartStateSchema = z
  .strictObject({
    id: idSchema,
    title: z.string().trim().min(1).optional(),
    categories: z.array(liveChartCategorySchema).min(1).max(12),
    series: z.array(liveChartSeriesSchema).min(1).max(4),
    unit: z.string().trim().min(1).optional(),
    highlight: liveChartHighlightSchema.optional(),
  })
  .superRefine((state, ctx) => {
    const categoryKeys = new Set<string>();
    for (const [index, category] of state.categories.entries()) {
      if (categoryKeys.has(category.key)) {
        ctx.addIssue({
          code: "custom",
          path: ["categories", index, "key"],
          message: `カテゴリキーが重複しています: ${category.key}`,
        });
      }
      categoryKeys.add(category.key);
    }

    const seriesKeys = new Set<string>();
    for (const [seriesIndex, series] of state.series.entries()) {
      if (seriesKeys.has(series.key)) {
        ctx.addIssue({
          code: "custom",
          path: ["series", seriesIndex, "key"],
          message: `系列キーが重複しています: ${series.key}`,
        });
      }
      seriesKeys.add(series.key);
      for (const categoryKey of categoryKeys) {
        if (series.values[categoryKey] === undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["series", seriesIndex, "values"],
            message: `カテゴリ ${categoryKey} の値がありません。`,
          });
        }
      }
      for (const valueKey of Object.keys(series.values)) {
        if (!categoryKeys.has(valueKey)) {
          ctx.addIssue({
            code: "custom",
            path: ["series", seriesIndex, "values"],
            message: `存在しないカテゴリの値があります: ${valueKey}`,
          });
        }
      }
    }

    if (state.highlight !== undefined) {
      for (const seriesKey of state.highlight.seriesKeys) {
        if (!seriesKeys.has(seriesKey)) {
          ctx.addIssue({
            code: "custom",
            path: ["highlight", "seriesKeys"],
            message: `強調する系列が見つかりません: ${seriesKey}`,
          });
        }
      }
      for (const categoryKey of state.highlight.categoryKeys) {
        if (!categoryKeys.has(categoryKey)) {
          ctx.addIssue({
            code: "custom",
            path: ["highlight", "categoryKeys"],
            message: `強調するカテゴリが見つかりません: ${categoryKey}`,
          });
        }
      }
    }
  });
export type LiveChartState = z.infer<typeof liveChartStateSchema>;

export const liveQuoteStateSchema = z.strictObject({
  id: idSchema,
  quote: z.string().trim().min(1),
  author: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1).optional(),
  tone: tableToneSchema.default("primary"),
  align: liveCardAlignSchema.default("left"),
});
export type LiveQuoteState = z.infer<typeof liveQuoteStateSchema>;

const liveCardBaseShape = {
  id: idSchema,
  name: z.string().trim().min(1).optional(),
  animation: liveCardAnimationConfigSchema.default(DEFAULT_ANIMATION_CONFIG),
};

export const liveHeadlineCardSchema = z.strictObject({
  ...liveCardBaseShape,
  type: z.literal("headline"),
  states: z.array(liveHeadlineStateSchema).min(1).max(100),
});
export type LiveHeadlineCard = z.infer<typeof liveHeadlineCardSchema>;

export const liveImageCardSchema = z.strictObject({
  ...liveCardBaseShape,
  type: z.literal("image"),
  states: z.array(liveImageStateSchema).min(1).max(100),
});
export type LiveImageCard = z.infer<typeof liveImageCardSchema>;

export const liveListCardSchema = z.strictObject({
  ...liveCardBaseShape,
  type: z.literal("list"),
  states: z.array(liveListStateSchema).min(1).max(100),
});
export type LiveListCard = z.infer<typeof liveListCardSchema>;

export const liveChartCardSchema = z.strictObject({
  ...liveCardBaseShape,
  type: z.literal("chart"),
  variant: liveChartVariantSchema,
  chartAnimation: z.enum(["none", "grow", "draw"]).optional(),
  states: z.array(liveChartStateSchema).min(1).max(100),
});
export type LiveChartCard = z.infer<typeof liveChartCardSchema>;

export const liveQuoteCardSchema = z.strictObject({
  ...liveCardBaseShape,
  type: z.literal("quote"),
  states: z.array(liveQuoteStateSchema).min(1).max(100),
});
export type LiveQuoteCard = z.infer<typeof liveQuoteCardSchema>;

const liveCardUnionSchema = z.discriminatedUnion("type", [
  liveHeadlineCardSchema,
  liveImageCardSchema,
  liveListCardSchema,
  liveChartCardSchema,
  liveQuoteCardSchema,
]);

/**
 * A live card owns every state it can display. States are complete snapshots,
 * not patches; stable ids let the renderer update only the changed elements.
 */
export const liveCardSchema = liveCardUnionSchema.superRefine((card, ctx) => {
  const stateIds = new Set<string>();
  for (const [index, state] of card.states.entries()) {
    if (stateIds.has(state.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["states", index, "id"],
        message: `カード状態 ID が重複しています: ${state.id}`,
      });
    }
    stateIds.add(state.id);
  }
});
export type LiveCard = z.infer<typeof liveCardSchema>;

export const liveCardRefSchema = z.strictObject({
  cardId: idSchema,
  stateId: idSchema,
});
export type LiveCardRef = z.infer<typeof liveCardRefSchema>;

export const liveCardAssetMediaTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
export type LiveCardAssetMediaType = z.infer<typeof liveCardAssetMediaTypeSchema>;

/**
 * A resolved image asset inside a live package. Cards keep the source asset id;
 * the live app resolves it through this table instead of knowing package paths.
 */
export const liveCardAssetSchema = z.strictObject({
  id: idSchema,
  file: livePackageRelativePathSchema,
  mediaType: liveCardAssetMediaTypeSchema,
  width: positiveInt,
  height: positiveInt,
});
export type LiveCardAsset = z.infer<typeof liveCardAssetSchema>;

export interface ResolvedLiveCardState {
  card: LiveCard;
  state: LiveCard["states"][number];
}

/** Resolves a card/state reference without loosening the discriminated union. */
export function resolveLiveCardState(
  cards: readonly LiveCard[],
  ref: LiveCardRef,
): ResolvedLiveCardState | null {
  const card = cards.find((entry) => entry.id === ref.cardId);
  if (card === undefined) {
    return null;
  }
  const state = card.states.find((entry) => entry.id === ref.stateId);
  if (state === undefined) {
    return null;
  }
  return { card, state };
}

/** Image asset ids referenced by a card. Non-image cards return an empty list. */
export function liveCardImageAssetIds(card: LiveCard): string[] {
  if (card.type !== "image") {
    return [];
  }
  return [...new Set(card.states.map((state) => state.assetId))];
}
