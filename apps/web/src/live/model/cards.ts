import type {
  LiveCard,
  LiveChartCard,
  LiveChartCategory,
  LiveChartSeries,
  LiveChartState,
  LiveHeadlineCard,
  LiveHeadlineState,
  LiveImageCard,
  LiveImageState,
  LiveListCard,
  LiveListState,
  LiveListStateItem,
  LiveProgramDocument,
  LiveProgramSegment,
  LiveQuoteCard,
  LiveQuoteState,
  LiveVisualRef,
} from "@kakeai/contracts";

type StateOfCard = LiveCard["states"][number];

export function findCard(cards: readonly LiveCard[], cardId: string): LiveCard | null {
  return cards.find((card) => card.id === cardId) ?? null;
}

export function cardState(
  card: LiveCard,
  stateId: string,
): StateOfCard | null {
  return card.states.find((state) => state.id === stateId) ?? null;
}

function withStates(card: LiveCard, states: StateOfCard[]): LiveCard {
  switch (card.type) {
    case "headline":
      return { ...card, states: states as LiveHeadlineState[] };
    case "image":
      return { ...card, states: states as LiveImageState[] };
    case "list":
      return { ...card, states: states as LiveListState[] };
    case "chart":
      return { ...card, states: states as LiveChartState[] };
    case "quote":
      return { ...card, states: states as LiveQuoteState[] };
    default:
      throw new Error("未対応のカード型です。");
  }
}

export function updateCardState(
  card: LiveCard,
  stateId: string,
  updater: (state: StateOfCard) => StateOfCard,
): LiveCard {
  return withStates(
    card,
    card.states.map((state) => (state.id === stateId ? updater(state) : state)),
  );
}

export function addCardState(
  card: LiveCard,
  state: StateOfCard,
  index?: number,
): LiveCard {
  if (card.states.some((entry) => entry.id === state.id)) {
    return card;
  }
  const requested = index ?? card.states.length;
  const bounded = Math.min(Math.max(requested, 0), card.states.length);
  return withStates(card, [
    ...card.states.slice(0, bounded),
    state,
    ...card.states.slice(bounded),
  ]);
}

export function duplicateCardState(
  card: LiveCard,
  stateId: string,
  newStateId: string,
): LiveCard {
  if (card.states.some((entry) => entry.id === newStateId)) {
    return card;
  }
  const state = cardState(card, stateId);
  if (state === null) {
    return card;
  }
  const index = card.states.findIndex((entry) => entry.id === stateId);
  const clone =
    typeof structuredClone === "function"
      ? structuredClone(state)
      : (JSON.parse(JSON.stringify(state)) as StateOfCard);
  const copy = { ...clone, id: newStateId } as StateOfCard;
  return addCardState(card, copy, index + 1);
}

/**
 * Removes a state unless it is the last one. A card must always keep at least
 * one state, matching the contract.
 */
export function removeCardState(card: LiveCard, stateId: string): LiveCard {
  if (card.states.length <= 1) {
    return card;
  }
  if (!card.states.some((state) => state.id === stateId)) {
    return card;
  }
  return withStates(
    card,
    card.states.filter((state) => state.id !== stateId),
  );
}

export function replaceCardInDocument(
  document: LiveProgramDocument,
  card: LiveCard,
): LiveProgramDocument {
  return {
    ...document,
    cards: document.cards.map((entry) => (entry.id === card.id ? card : entry)),
  };
}

export function addCardToDocument(
  document: LiveProgramDocument,
  card: LiveCard,
): LiveProgramDocument {
  if (document.cards.some((entry) => entry.id === card.id)) {
    return document;
  }
  return { ...document, cards: [...document.cards, card] };
}

function withoutVisual(
  visual: LiveVisualRef | null | undefined,
  cardId: string,
  stateId?: string,
): LiveVisualRef | null | undefined {
  if (visual === null || visual === undefined || visual.kind !== "card") {
    return visual;
  }
  if (visual.cardId !== cardId) {
    return visual;
  }
  if (stateId !== undefined && visual.stateId !== stateId) {
    return visual;
  }
  return undefined;
}

function segmentWithoutCardVisual(
  segment: LiveProgramSegment,
  cardId: string,
  stateId?: string,
): LiveProgramSegment {
  if (segment.kind === "cut_in") {
    return segment;
  }
  const visual = segment.visual;
  if (
    visual === undefined ||
    visual.kind !== "card" ||
    visual.cardId !== cardId ||
    (stateId !== undefined && visual.stateId !== stateId)
  ) {
    return segment;
  }
  const { visual: _removed, ...rest } = segment;
  return rest;
}

/**
 * Removes a card and every explicit cue/segment visual that pointed at it. The
 * field is removed (inherit), not replaced with `null` (explicit hide).
 */
export function removeCardFromDocument(
  document: LiveProgramDocument,
  cardId: string,
): LiveProgramDocument {
  return {
    ...document,
    cards: document.cards.filter((card) => card.id !== cardId),
    cues: document.cues.map((cue) => {
      const visual = withoutVisual(cue.visual, cardId);
      if (visual === undefined) {
        const { visual: _removed, ...rest } = cue;
        return rest;
      }
      return { ...cue, visual };
    }),
    segments: document.segments.map((segment) =>
      segmentWithoutCardVisual(segment, cardId),
    ),
  };
}

export function removeCardStateFromDocument(
  document: LiveProgramDocument,
  cardId: string,
  stateId: string,
): LiveProgramDocument {
  const card = findCard(document.cards, cardId);
  if (card === null) {
    return document;
  }
  const nextCard = removeCardState(card, stateId);
  if (nextCard === card) {
    return document;
  }
  return {
    ...replaceCardInDocument(document, nextCard),
    cues: document.cues.map((cue) => {
      const visual = withoutVisual(cue.visual, cardId, stateId);
      if (visual === undefined) {
        const { visual: _removed, ...rest } = cue;
        return rest;
      }
      return { ...cue, visual };
    }),
    segments: document.segments.map((segment) =>
      segmentWithoutCardVisual(segment, cardId, stateId),
    ),
  };
}

function emptyChartState(id: string): LiveChartState {
  return {
    id,
    categories: [{ key: "category-1", label: "カテゴリ 1" }],
    series: [
      {
        key: "series-1",
        label: "系列 1",
        values: { "category-1": 0 },
      },
    ],
    highlight: { seriesKeys: [], categoryKeys: [] },
  };
}

export interface CreateCardInput {
  id: string;
  stateId: string;
  type: LiveCard["type"];
  imageAssetId?: string;
  name?: string;
}

/**
 * Creates a card with one valid starter state. Image cards need an existing
 * asset id; callers disable the type when the asset library has none.
 */
export function createLiveCard(input: CreateCardInput): LiveCard {
  const base = {
    id: input.id,
    ...(input.name === undefined ? {} : { name: input.name }),
  };
  switch (input.type) {
    case "headline": {
      const state: LiveHeadlineState = {
        id: input.stateId,
        title: "新しい見出し",
        tone: "primary",
        align: "center",
      };
      const card: LiveHeadlineCard = {
        ...base,
        type: "headline",
        animation: {
          enter: { preset: "fade", durationMs: 400, delayMs: 0, staggerMs: 0 },
          update: { preset: "fade", durationMs: 300, delayMs: 0, staggerMs: 0 },
        },
        states: [state],
      };
      return card;
    }
    case "image": {
      if (input.imageAssetId === undefined || input.imageAssetId.length === 0) {
        throw new Error("画像カードには画像アセットが必要です。");
      }
      const state: LiveImageState = {
        id: input.stateId,
        assetId: input.imageAssetId,
        fit: "cover",
      };
      const card: LiveImageCard = {
        ...base,
        type: "image",
        animation: {
          enter: { preset: "fade", durationMs: 400, delayMs: 0, staggerMs: 0 },
          update: { preset: "fade", durationMs: 300, delayMs: 0, staggerMs: 0 },
        },
        states: [state],
      };
      return card;
    }
    case "list": {
      const state: LiveListState = {
        id: input.stateId,
        items: [],
        ordered: false,
      };
      const card: LiveListCard = {
        ...base,
        type: "list",
        animation: {
          enter: { preset: "fade", durationMs: 400, delayMs: 0, staggerMs: 0 },
          update: { preset: "slide-up", durationMs: 300, delayMs: 0, staggerMs: 120 },
        },
        states: [state],
      };
      return card;
    }
    case "chart": {
      const card: LiveChartCard = {
        ...base,
        type: "chart",
        variant: "bar",
        chartAnimation: "grow",
        animation: {
          enter: { preset: "fade", durationMs: 400, delayMs: 0, staggerMs: 0 },
          update: { preset: "fade", durationMs: 300, delayMs: 0, staggerMs: 0 },
        },
        states: [emptyChartState(input.stateId)],
      };
      return card;
    }
    case "quote": {
      const state: LiveQuoteState = {
        id: input.stateId,
        quote: "引用文を入力してください。",
        tone: "primary",
        align: "left",
      };
      const card: LiveQuoteCard = {
        ...base,
        type: "quote",
        animation: {
          enter: { preset: "fade", durationMs: 400, delayMs: 0, staggerMs: 0 },
          update: { preset: "fade", durationMs: 300, delayMs: 0, staggerMs: 0 },
        },
        states: [state],
      };
      return card;
    }
  }
}

/** Image cards return `null` when no asset is available instead of throwing. */
export function createStarterState(
  card: LiveCard,
  stateId: string,
  imageAssetId?: string,
): StateOfCard | null {
  switch (card.type) {
    case "headline":
      return {
        id: stateId,
        title: "新しい見出し",
        tone: "primary",
        align: "center",
      } satisfies LiveHeadlineState;
    case "image": {
      const existing = card.states[0];
      const assetId = existing?.assetId ?? imageAssetId;
      if (assetId === undefined || assetId.length === 0) {
        return null;
      }
      return {
        id: stateId,
        assetId,
        fit: existing?.fit ?? "cover",
      } satisfies LiveImageState;
    }
    case "list":
      return { id: stateId, items: [], ordered: card.states[0]?.ordered ?? false } satisfies LiveListState;
    case "chart": {
      const source = card.states[0];
      return (
        source === undefined
          ? emptyChartState(stateId)
          : {
              ...(typeof structuredClone === "function"
                ? structuredClone(source)
                : (JSON.parse(JSON.stringify(source)) as LiveChartState)),
              id: stateId,
            }
      ) satisfies LiveChartState;
    }
    case "quote":
      return {
        id: stateId,
        quote: "引用文を入力してください。",
        tone: "primary",
        align: "left",
      } satisfies LiveQuoteState;
  }
}

/* ---------- list state helpers ---------- */

export const LIVE_LIST_MAX_ITEMS = 8;

export function addListItem(state: LiveListState, item: LiveListStateItem): LiveListState {
  if (state.items.length >= LIVE_LIST_MAX_ITEMS || state.items.some((entry) => entry.id === item.id)) {
    return state;
  }
  return { ...state, items: [...state.items, item] };
}

export function updateListItem(
  state: LiveListState,
  itemId: string,
  patch: Partial<Omit<LiveListStateItem, "id">>,
): LiveListState {
  return {
    ...state,
    items: state.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
  };
}

export function removeListItem(state: LiveListState, itemId: string): LiveListState {
  if (state.activeItemId !== itemId) {
    return { ...state, items: state.items.filter((item) => item.id !== itemId) };
  }
  const { activeItemId: _removed, ...rest } = state;
  return { ...rest, items: state.items.filter((item) => item.id !== itemId) };
}

export function setActiveListItem(
  state: LiveListState,
  itemId: string | undefined,
): LiveListState {
  if (itemId === undefined) {
    const { activeItemId: _removed, ...rest } = state;
    return rest;
  }
  return { ...state, activeItemId: itemId };
}

/* ---------- chart state helpers ---------- */

/** Mirrors the contract limits in `liveChartStateSchema`. */
export const LIVE_CHART_MAX_CATEGORIES = 12;
export const LIVE_CHART_MAX_SERIES = 4;

function valuesForCategories(
  categories: readonly LiveChartCategory[],
  previous: Readonly<Record<string, number>> = {},
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const category of categories) {
    values[category.key] = previous[category.key] ?? 0;
  }
  return values;
}

export function addChartCategory(
  state: LiveChartState,
  category: LiveChartCategory,
): LiveChartState {
  if (
    state.categories.length >= LIVE_CHART_MAX_CATEGORIES ||
    state.categories.some((entry) => entry.key === category.key)
  ) {
    return state;
  }
  const categories = [...state.categories, category];
  return {
    ...state,
    categories,
    series: state.series.map((series) => ({
      ...series,
      values: valuesForCategories(categories, series.values),
    })),
  };
}

export function removeChartCategory(
  state: LiveChartState,
  categoryKey: string,
): LiveChartState {
  if (state.categories.length <= 1) {
    return state;
  }
  const categories = state.categories.filter((entry) => entry.key !== categoryKey);
  return {
    ...state,
    categories,
    series: state.series.map((series) => ({
      ...series,
      values: valuesForCategories(categories, series.values),
    })),
    ...(state.highlight === undefined
      ? {}
      : {
          highlight: {
            ...state.highlight,
            categoryKeys: state.highlight.categoryKeys.filter((key) => key !== categoryKey),
          },
        }),
  };
}

export function addChartSeries(
  state: LiveChartState,
  series: LiveChartSeries,
): LiveChartState {
  if (
    state.series.length >= LIVE_CHART_MAX_SERIES ||
    state.series.some((entry) => entry.key === series.key)
  ) {
    return state;
  }
  return {
    ...state,
    series: [
      ...state.series,
      { ...series, values: valuesForCategories(state.categories, series.values) },
    ],
  };
}

export function removeChartSeries(
  state: LiveChartState,
  seriesKey: string,
): LiveChartState {
  if (state.series.length <= 1) {
    return state;
  }
  return {
    ...state,
    series: state.series.filter((entry) => entry.key !== seriesKey),
    ...(state.highlight === undefined
      ? {}
      : {
          highlight: {
            ...state.highlight,
            seriesKeys: state.highlight.seriesKeys.filter((key) => key !== seriesKey),
          },
        }),
  };
}

export function setChartValue(
  state: LiveChartState,
  seriesKey: string,
  categoryKey: string,
  value: number,
): LiveChartState {
  if (
    !Number.isFinite(value) ||
    !state.series.some((series) => series.key === seriesKey) ||
    !state.categories.some((category) => category.key === categoryKey)
  ) {
    return state;
  }
  return {
    ...state,
    series: state.series.map((series) =>
      series.key === seriesKey
        ? { ...series, values: { ...series.values, [categoryKey]: value } }
        : series,
    ),
  };
}

export function toggleChartHighlight(
  state: LiveChartState,
  kind: "series" | "category",
  key: string,
): LiveChartState {
  const highlight = state.highlight ?? { seriesKeys: [], categoryKeys: [] };
  const current = kind === "series" ? highlight.seriesKeys : highlight.categoryKeys;
  const next = current.includes(key)
    ? current.filter((entry) => entry !== key)
    : [...current, key];
  return {
    ...state,
    highlight:
      kind === "series"
        ? { ...highlight, seriesKeys: next }
        : { ...highlight, categoryKeys: next },
  };
}

export function setChartVariant(card: LiveChartCard, variant: LiveChartCard["variant"]): LiveChartCard {
  return { ...card, variant };
}
