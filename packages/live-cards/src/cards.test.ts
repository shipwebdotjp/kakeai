import { describe, expect, it } from "vitest";
import { createLiveCardRenderer } from "./renderer";
import {
  cardVisual,
  createEnvironment,
  flushAsync,
  mustQuery,
  parseCard,
  queryAll,
} from "./test-helpers";

describe("live card types", () => {
  it("renders headline, image, list, chart and quote semantic content", async () => {
    const { host } = createEnvironment();
    const renderer = createLiveCardRenderer(host, {
      resolveAsset: (assetId) => `/assets/${assetId}.png`,
    });
    const headline = parseCard({
      id: "card-headline",
      type: "headline",
      states: [
        {
          id: "headline-1",
          kicker: "速報",
          title: "新しい発表",
          subtitle: "詳しく解説します",
          tone: "secondary",
          align: "left",
        },
      ],
    });
    const image = parseCard({
      id: "card-image",
      type: "image",
      states: [
        {
          id: "image-1",
          assetId: "asset-1",
          alt: "図版の説明",
          caption: "図版キャプション",
          credit: "出典",
          fit: "contain",
        },
      ],
    });
    const list = parseCard({
      id: "card-list",
      type: "list",
      states: [
        {
          id: "list-1",
          title: "三つのポイント",
          items: [
            { id: "item-1", text: "一つ目" },
            { id: "item-2", text: "二つ目", note: "補足" },
          ],
          activeItemId: "item-1",
          ordered: true,
        },
      ],
    });
    const chart = parseCard({
      id: "card-chart",
      type: "chart",
      variant: "bar",
      chartAnimation: "none",
      states: [
        {
          id: "chart-1",
          title: "来場者数",
          categories: [
            { key: "c1", label: "1月" },
            { key: "c2", label: "2月" },
          ],
          series: [
            {
              key: "s1",
              label: "来場者",
              values: { c1: 10, c2: 20 },
              tone: "success",
            },
          ],
          unit: "人",
        },
      ],
    });
    const quote = parseCard({
      id: "card-quote",
      type: "quote",
      states: [
        {
          id: "quote-1",
          quote: "継続は力なり",
          author: "誰か",
          source: "どこか",
          tone: "tertiary",
          align: "center",
        },
      ],
    });
    renderer.setCards([headline, image, list, chart, quote]);

    renderer.setVisual(cardVisual("card-headline", "headline-1"));
    expect(mustQuery(renderer.shadowRoot, ".kc-card").getAttribute("data-card-id")).toBe(
      "card-headline",
    );
    expect(mustQuery(renderer.shadowRoot, ".kc-kicker").textContent).toBe("速報");
    expect(mustQuery(renderer.shadowRoot, ".kc-title").textContent).toBe("新しい発表");
    expect(mustQuery(renderer.shadowRoot, ".kc-subtitle").textContent).toBe(
      "詳しく解説します",
    );
    expect(mustQuery(renderer.shadowRoot, ".kc-card").getAttribute("data-tone")).toBe(
      "secondary",
    );
    expect(mustQuery(renderer.shadowRoot, ".kc-card").getAttribute("data-align")).toBe(
      "left",
    );

    renderer.setVisual(cardVisual("card-image", "image-1"));
    const imageElement = mustQuery<HTMLImageElement>(renderer.shadowRoot, "img");
    expect(imageElement.getAttribute("src")).toBe("/assets/asset-1.png");
    await flushAsync();
    expect(imageElement.getAttribute("alt")).toBe("図版の説明");
    expect(mustQuery(renderer.shadowRoot, ".kc-image-caption").textContent).toBe(
      "図版キャプション",
    );
    expect(mustQuery(renderer.shadowRoot, ".kc-image-credit").textContent).toBe("出典");
    expect(mustQuery(renderer.shadowRoot, ".kc-card").getAttribute("data-fit")).toBe(
      "contain",
    );

    renderer.setVisual(cardVisual("card-list", "list-1"));
    expect(mustQuery(renderer.shadowRoot, ".kc-list-title").textContent).toBe(
      "三つのポイント",
    );
    expect(queryAll(renderer.shadowRoot, ".kc-list-item")).toHaveLength(2);
    expect(
      mustQuery(renderer.shadowRoot, '[data-item-id="item-1"]').getAttribute("data-active"),
    ).toBe("true");
    expect(
      mustQuery(renderer.shadowRoot, '[data-item-id="item-1"] .kc-list-marker').textContent,
    ).toBe("1");
    expect(
      mustQuery(renderer.shadowRoot, '[data-item-id="item-2"] .kc-list-note').textContent,
    ).toBe("補足");

    renderer.setVisual(cardVisual("card-chart", "chart-1"));
    expect(mustQuery(renderer.shadowRoot, ".kc-chart-title").textContent).toBe("来場者数");
    expect(
      queryAll(renderer.shadowRoot, ".kc-chart-category").map(
        (element) => element.textContent,
      ),
    ).toEqual(["1月", "2月"]);
    expect(queryAll(renderer.shadowRoot, ".kc-chart-bar")).toHaveLength(2);
    expect(
      mustQuery(renderer.shadowRoot, '.kc-chart-legend-item[data-series-key="s1"]')
        .textContent,
    ).toContain("来場者");
    expect(mustQuery(renderer.shadowRoot, ".kc-chart-unit").textContent).toBe("人");

    renderer.setVisual(cardVisual("card-quote", "quote-1"));
    expect(mustQuery(renderer.shadowRoot, ".kc-quote-text").textContent).toBe(
      "継続は力なり",
    );
    expect(mustQuery(renderer.shadowRoot, ".kc-quote-author").textContent).toBe("誰か");
    expect(mustQuery(renderer.shadowRoot, ".kc-quote-source").textContent).toBe("どこか");
    expect(mustQuery(renderer.shadowRoot, ".kc-card").getAttribute("data-tone")).toBe(
      "tertiary",
    );
    expect(mustQuery(renderer.shadowRoot, ".kc-card").getAttribute("data-align")).toBe(
      "center",
    );
  });
});
