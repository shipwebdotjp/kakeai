import { describe, expect, it } from "vitest";
import { buildCardStateDraft } from "./card-state-draft";

describe("card state drafts", () => {
  it("returns null when the state has no usable id", () => {
    expect(buildCardStateDraft("headline", null)).toBeNull();
    expect(buildCardStateDraft("headline", [])).toBeNull();
    expect(buildCardStateDraft("headline", { title: "見出し" })).toBeNull();
    expect(buildCardStateDraft("headline", { id: "" })).toBeNull();
  });

  it("keeps a valid state issue-free", () => {
    const draft = buildCardStateDraft("headline", {
      id: "state-1",
      title: "見出し",
    });
    expect(draft?.cardType).toBe("headline");
    expect(draft?.issues).toEqual([]);
  });

  it("makes missing headline and quote text editable instead of rejecting the state", () => {
    const headline = buildCardStateDraft("headline", {
      id: "state-headline",
      tone: "unknown",
    });
    if (headline?.cardType !== "headline") {
      throw new Error("expected headline draft");
    }
    expect(headline.state.title).toBe("");
    expect(headline.state.tone).toBe("primary");
    expect(headline.issues.length).toBeGreaterThan(0);

    const quote = buildCardStateDraft("quote", { id: "state-quote" });
    if (quote?.cardType !== "quote") {
      throw new Error("expected quote draft");
    }
    expect(quote.state.quote).toBe("");
    expect(quote.state.align).toBe("left");
    expect(quote.issues.length).toBeGreaterThan(0);
  });

  it("coerces list items, drops duplicate ids, and ignores a dangling active item", () => {
    const draft = buildCardStateDraft("list", {
      id: "state-list",
      items: [
        { id: "item-1", text: 42 },
        { id: "item-1", text: "重複" },
        { text: "id なし" },
      ],
      activeItemId: "missing",
    });
    if (draft?.cardType !== "list") {
      throw new Error("expected list draft");
    }
    expect(draft.state.items).toEqual([{ id: "item-1", text: "" }]);
    expect(draft.state.activeItemId).toBeUndefined();
    expect(draft.issues.length).toBeGreaterThan(0);
  });

  it("keeps chart labels editable and fills missing category values", () => {
    const draft = buildCardStateDraft("chart", {
      id: "state-chart",
      categories: [
        { key: "category-1", label: 1 },
        { key: "category-1", label: "重複" },
      ],
      series: [{ key: "series-1", label: null, values: {} }],
    });
    if (draft?.cardType !== "chart") {
      throw new Error("expected chart draft");
    }
    expect(draft.state.categories).toEqual([
      { key: "category-1", label: "" },
    ]);
    expect(draft.state.series).toEqual([
      {
        key: "series-1",
        label: "",
        values: { "category-1": 0 },
      },
    ]);
    expect(draft.issues.length).toBeGreaterThan(0);
  });

  it("leaves an image asset empty so the select can repair it", () => {
    const draft = buildCardStateDraft("image", { id: "state-image" });
    if (draft?.cardType !== "image") {
      throw new Error("expected image draft");
    }
    expect(draft.state.assetId).toBe("");
    expect(draft.state.fit).toBe("cover");
    expect(draft.issues.length).toBeGreaterThan(0);
  });
});
