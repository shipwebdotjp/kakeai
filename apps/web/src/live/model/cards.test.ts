import { describe, expect, it } from "vitest";
import {
  addChartCategory,
  addChartSeries,
  addCardState,
  addListItem,
  createLiveCard,
  createStarterState,
  duplicateCardState,
  LIVE_LIST_MAX_ITEMS,
  removeCardFromDocument,
  removeCardState,
  removeCardStateFromDocument,
  removeChartCategory,
  removeChartSeries,
  removeListItem,
  setActiveListItem,
  setChartValue,
  toggleChartHighlight,
} from "./cards";
import { setCueVisual } from "./visual";
import { makeListCard, makeProgramDocument } from "./test-helpers";

describe("card library edits", () => {
  it("removes a card and clears cue/segment visual references", () => {
    const document = makeProgramDocument();
    const next = removeCardFromDocument(document, "card-1");

    expect(next.cards).toEqual([]);
    expect(next.cues.find((cue) => cue.id === "cue-news")?.visual).toBeUndefined();
    const script = next.segments.find((segment) => segment.id === "seg-script");
    expect(script !== undefined && "visual" in script).toBe(false);
  });

  it("removes a state and only clears visuals that referenced it", () => {
    const document = makeProgramDocument();
    const next = removeCardStateFromDocument(document, "card-1", "state-2");

    expect(next.cards[0]?.states.map((state) => state.id)).toEqual(["state-1"]);
    expect(next.cues.find((cue) => cue.id === "cue-news")?.visual).toBeUndefined();
    const script = next.segments.find((segment) => segment.id === "seg-script");
    if (script?.kind === "script") {
      expect(script.visual).toEqual({
        kind: "card",
        cardId: "card-1",
        stateId: "state-1",
      });
    }
  });

  it("never removes the last state", () => {
    const card = makeListCard();
    const single = removeCardState({ ...card, states: [card.states[0]!] }, "state-1");
    expect(single.states).toHaveLength(1);
  });

  it("ignores duplicate state ids instead of creating ambiguous states", () => {
    const card = makeListCard();
    const existing = card.states[0]!;
    expect(addCardState(card, existing)).toBe(card);
    expect(duplicateCardState(card, "state-1", "state-2")).toBe(card);
  });

  it("ignores chart value writes for unknown keys", () => {
    const card = createLiveCard({ id: "card-chart", stateId: "state-chart", type: "chart" });
    if (card.type !== "chart") {
      throw new Error("expected chart card");
    }
    const state = card.states[0]!;
    if (!("categories" in state)) {
      throw new Error("expected chart state");
    }
    expect(setChartValue(state, "missing-series", "category-1", 1)).toBe(state);
    expect(setChartValue(state, "series-1", "missing-category", 1)).toBe(state);
    expect(setChartValue(state, "series-1", "category-1", Number.NaN)).toBe(state);
    expect(setChartValue(state, "series-1", "category-1", Infinity)).toBe(state);
    expect(setChartValue(state, "series-1", "category-1", -Infinity)).toBe(state);
  });

  it("stops adding chart categories and series at the contract limits", () => {
    const card = createLiveCard({ id: "card-chart", stateId: "state-chart", type: "chart" });
    if (card.type !== "chart") {
      throw new Error("expected chart card");
    }
    let state = card.states[0]!;
    for (let index = 2; index <= 12; index += 1) {
      state = addChartCategory(state, { key: `category-${index}`, label: `${index}` });
    }
    expect(state.categories).toHaveLength(12);
    expect(
      addChartCategory(state, { key: "category-13", label: "13" }),
    ).toBe(state);

    for (let index = 2; index <= 4; index += 1) {
      state = addChartSeries(state, {
        key: `series-${index}`,
        label: `${index}`,
        values: {},
      });
    }
    expect(state.series).toHaveLength(4);
    expect(
      addChartSeries(state, { key: "series-5", label: "5", values: {} }),
    ).toBe(state);
  });

  it("duplicates a full state snapshot with a new state id and stable item ids", () => {
    const card = duplicateCardState(makeListCard(), "state-2", "state-copy");
    const copy = card.states.find((state) => state.id === "state-copy")!;

    expect(copy.id).toBe("state-copy");
    if (!("items" in copy)) {
      throw new Error("expected list state");
    }
    expect(copy.items.map((item) => item.id)).toEqual(["item-1", "item-2"]);
    if ("activeItemId" in copy) {
      expect(copy.activeItemId).toBe("item-2");
    }
  });

  it("adds a state with a valid starter snapshot per card type", () => {
    const card = makeListCard();
    const starter = createStarterState(card, "state-new");
    if (starter === null) {
      throw new Error("expected a list starter state");
    }
    const list = addCardState(card, starter);
    expect(list.states.map((state) => state.id)).toContain("state-new");

    const image = createLiveCard({
      id: "card-image",
      stateId: "state-image",
      type: "image",
      imageAssetId: "asset-image",
    });
    expect(image.type).toBe("image");
  });

  it("returns null for an image starter state without an available asset", () => {
    const image = createLiveCard({
      id: "card-image",
      stateId: "state-image",
      type: "image",
      imageAssetId: "asset-image",
    });
    if (image.type !== "image") {
      throw new Error("expected image card");
    }
    const bare = { ...image, states: [] };
    expect(createStarterState(bare, "state-next")).toBeNull();
    expect(createStarterState(image, "state-next")).toMatchObject({
      id: "state-next",
      assetId: "asset-image",
      fit: "cover",
    });
  });

  it("keeps list item ids stable and clears the active item on removal", () => {
    const card = makeListCard();
    const state = card.states[0]!;
    if (!("items" in state)) {
      throw new Error("expected list state");
    }
    const withItem = addListItem(state, { id: "item-3", text: "みっつめ" });
    expect(withItem.items.map((item) => item.id)).toEqual(["item-1", "item-3"]);

    const active = setActiveListItem(withItem, "item-3");
    expect(active.activeItemId).toBe("item-3");
    const removed = removeListItem(active, "item-3");
    expect(removed.items.map((item) => item.id)).toEqual(["item-1"]);
    expect(removed.activeItemId).toBeUndefined();
  });

  it("rejects duplicate and over-limit list items", () => {
    const card = makeListCard();
    const state = card.states[0]!;
    if (!("items" in state)) {
      throw new Error("expected list state");
    }
    expect(addListItem(state, { id: "item-1", text: "重複" })).toBe(state);

    let full = state;
    for (let index = state.items.length + 1; index <= LIVE_LIST_MAX_ITEMS; index += 1) {
      full = addListItem(full, { id: `item-${index}`, text: `${index}` });
    }
    expect(full.items).toHaveLength(LIVE_LIST_MAX_ITEMS);
    expect(addListItem(full, { id: "item-extra", text: "追加" })).toBe(full);
  });

  it("fills chart values when categories and series are added, and cleans highlights", () => {
    const card = createLiveCard({ id: "card-chart", stateId: "state-chart", type: "chart" });
    if (card.type !== "chart") {
      throw new Error("expected chart card");
    }
    const state = card.states[0]!;
    if (!("categories" in state)) {
      throw new Error("expected chart state");
    }

    const withCategory = addChartCategory(state, { key: "category-2", label: "2" });
    expect(withCategory.series[0]?.values).toEqual({ "category-1": 0, "category-2": 0 });

    const highlighted = toggleChartHighlight(withCategory, "category", "category-2");
    const withoutCategory = removeChartCategory(highlighted, "category-2");
    expect(withoutCategory.series[0]?.values).toEqual({ "category-1": 0 });
    expect(withoutCategory.highlight?.categoryKeys).toEqual([]);

    const withSeries = addChartSeries(withoutCategory, {
      key: "series-2",
      label: "系列 2",
      values: {},
    });
    expect(withSeries.series[1]?.values).toEqual({ "category-1": 0 });
    const valued = setChartValue(withSeries, "series-2", "category-1", 42);
    expect(valued.series[1]?.values["category-1"]).toBe(42);

    const removedSeries = removeChartSeries(valued, "series-2");
    expect(removedSeries.series.map((series) => series.key)).toEqual(["series-1"]);
  });

  it("writes explicit hide via setCueVisual without erasing inheritance semantics", () => {
    const document = setCueVisual(makeProgramDocument(), "cue-news", null);
    expect(document.cues.find((cue) => cue.id === "cue-news")?.visual).toBeNull();
  });
});
