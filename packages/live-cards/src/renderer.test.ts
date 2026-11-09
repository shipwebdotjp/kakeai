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

describe("live card renderer", () => {
  it("updates list items by stable id without rebuilding the card", () => {
    const card = parseCard({
      id: "card-list",
      type: "list",
      animation: {
        enter: { preset: "fade", durationMs: 400, delayMs: 0, staggerMs: 0 },
        update: { preset: "slide-up", durationMs: 300, delayMs: 0, staggerMs: 120 },
      },
      states: [
        {
          id: "state-1",
          title: "今日のポイント",
          items: [
            { id: "item-a", text: "新しい取り組み" },
            { id: "item-b", text: "地域の変化" },
          ],
        },
        {
          id: "state-2",
          title: "今日のポイント",
          items: [
            { id: "item-a", text: "新しい取り組み" },
            { id: "item-b", text: "地域の変化（更新）" },
            { id: "item-c", text: "来週の予定" },
          ],
          activeItemId: "item-b",
        },
        {
          id: "state-3",
          title: "今日のポイント",
          items: [
            { id: "item-a", text: "新しい取り組み" },
            { id: "item-c", text: "来週の予定" },
          ],
          activeItemId: "item-c",
        },
      ],
    });
    const { host } = createEnvironment();
    const renderer = createLiveCardRenderer(host);
    renderer.setCards([card]);
    renderer.setVisual(cardVisual("card-list", "state-1"));
    const firstRoot = mustQuery(renderer.shadowRoot, ".kc-card");
    const itemA = mustQuery(renderer.shadowRoot, '[data-item-id="item-a"]');
    const itemB = mustQuery(renderer.shadowRoot, '[data-item-id="item-b"]');
    expect(queryAll(renderer.shadowRoot, ".kc-list-item")).toHaveLength(2);

    renderer.setVisual(cardVisual("card-list", "state-2"));

    expect(mustQuery(renderer.shadowRoot, ".kc-card")).toBe(firstRoot);
    expect(mustQuery(renderer.shadowRoot, '[data-item-id="item-a"]')).toBe(itemA);
    expect(mustQuery(renderer.shadowRoot, '[data-item-id="item-b"]')).toBe(itemB);
    expect(itemB.textContent).toContain("地域の変化（更新）");
    expect(itemB.getAttribute("data-active")).toBe("true");
    const itemC = mustQuery(renderer.shadowRoot, '[data-item-id="item-c"]');
    expect(itemC.textContent).toContain("来週の予定");

    renderer.setVisual(cardVisual("card-list", "state-3"));

    expect(mustQuery(renderer.shadowRoot, '[data-item-id="item-a"]')).toBe(itemA);
    expect(mustQuery(renderer.shadowRoot, '[data-item-id="item-c"]')).toBe(itemC);
    expect(renderer.shadowRoot.querySelector('[data-item-id="item-b"]')).toBeNull();
    expect(itemC.getAttribute("data-active")).toBe("true");
  });

  it("keys bar chart category and series nodes", () => {
    const card = parseCard({
      id: "card-bar",
      type: "chart",
      variant: "bar",
      chartAnimation: "grow",
      states: [
        {
          id: "bar-1",
          title: "四半期",
          categories: [
            { key: "q1", label: "Q1" },
            { key: "q2", label: "Q2" },
          ],
          series: [
            { key: "revenue", label: "売上", values: { q1: 10, q2: 20 } },
            { key: "cost", label: "費用", values: { q1: 4, q2: 8 } },
          ],
          unit: "億円",
        },
        {
          id: "bar-2",
          title: "四半期",
          categories: [
            { key: "q1", label: "Q1" },
            { key: "q3", label: "Q3" },
            { key: "q2", label: "Q2" },
          ],
          series: [
            { key: "revenue", label: "売上", values: { q1: 12, q2: 22, q3: 6 } },
            { key: "cost", label: "費用", values: { q1: 5, q2: 9, q3: 3 } },
          ],
          unit: "億円",
        },
      ],
    });
    const { host } = createEnvironment();
    const renderer = createLiveCardRenderer(host);
    renderer.setCards([card]);
    renderer.setVisual(cardVisual("card-bar", "bar-1"));
    const q1 = mustQuery(renderer.shadowRoot, '.kc-chart-group[data-category-key="q1"]');
    const q1Revenue = mustQuery(
      renderer.shadowRoot,
      '.kc-chart-bar[data-category-key="q1"][data-series-key="revenue"]',
    );
    const revenueLegend = mustQuery(
      renderer.shadowRoot,
      '.kc-chart-legend-item[data-series-key="revenue"]',
    );
    const previousStyle = q1Revenue.getAttribute("style");

    renderer.setVisual(cardVisual("card-bar", "bar-2"));

    expect(
      mustQuery(renderer.shadowRoot, '.kc-chart-group[data-category-key="q1"]'),
    ).toBe(q1);
    expect(
      mustQuery(
        renderer.shadowRoot,
        '.kc-chart-bar[data-category-key="q1"][data-series-key="revenue"]',
      ),
    ).toBe(q1Revenue);
    expect(
      mustQuery(renderer.shadowRoot, '.kc-chart-legend-item[data-series-key="revenue"]'),
    ).toBe(revenueLegend);
    expect(q1Revenue.getAttribute("style")).not.toBe(previousStyle);
    expect(
      mustQuery(renderer.shadowRoot, '.kc-chart-group[data-category-key="q3"]'),
    ).not.toBeNull();
    expect(
      queryAll(renderer.shadowRoot, ".kc-chart-group").map((element) =>
        element.getAttribute("data-category-key"),
      ),
    ).toEqual(["q1", "q3", "q2"]);
  });

  it("keys line chart series and category points", () => {
    const card = parseCard({
      id: "card-line",
      type: "chart",
      variant: "line",
      chartAnimation: "draw",
      states: [
        {
          id: "line-1",
          title: "推移",
          categories: [
            { key: "c1", label: "1月" },
            { key: "c2", label: "2月" },
          ],
          series: [{ key: "visitors", label: "来場者", values: { c1: 10, c2: 20 } }],
        },
        {
          id: "line-2",
          title: "推移",
          categories: [
            { key: "c1", label: "1月" },
            { key: "c2", label: "2月" },
            { key: "c3", label: "3月" },
          ],
          series: [
            { key: "visitors", label: "来場者", values: { c1: 12, c2: 22, c3: 30 } },
          ],
        },
      ],
    });
    const { host } = createEnvironment();
    const renderer = createLiveCardRenderer(host);
    renderer.setCards([card]);
    renderer.setVisual(cardVisual("card-line", "line-1"));
    const seriesGroup = mustQuery(
      renderer.shadowRoot,
      '.kc-chart-line-series[data-series-key="visitors"]',
    );
    const path = mustQuery<SVGPathElement>(
      renderer.shadowRoot,
      '.kc-chart-line-series[data-series-key="visitors"] .kc-chart-line-path',
    );
    const point = mustQuery(
      renderer.shadowRoot,
      '.kc-chart-point[data-category-key="c1"]',
    );
    const previousPath = path.getAttribute("d");

    renderer.setVisual(cardVisual("card-line", "line-2"));

    expect(
      mustQuery(renderer.shadowRoot, '.kc-chart-line-series[data-series-key="visitors"]'),
    ).toBe(seriesGroup);
    expect(
      mustQuery(
        renderer.shadowRoot,
        '.kc-chart-line-series[data-series-key="visitors"] .kc-chart-line-path',
      ),
    ).toBe(path);
    expect(
      mustQuery(renderer.shadowRoot, '.kc-chart-point[data-category-key="c1"]'),
    ).toBe(point);
    expect(path.getAttribute("d")).not.toBe(previousPath);
    expect(
      mustQuery(renderer.shadowRoot, '.kc-chart-point[data-category-key="c3"]'),
    ).not.toBeNull();
    expect(
      mustQuery(renderer.shadowRoot, '.kc-chart-axis-label[data-category-key="c3"]')
        .textContent,
    ).toBe("3月");
  });

  it("injects card CSS into the shadow root and inherits host theme variables", () => {
    const { document, host } = createEnvironment();
    host.setAttribute(
      "style",
      "--kakeai-accent-primary: rgb(196, 85, 45); --kakeai-font-title: TestFont;",
    );
    const pageStyle = document.createElement("style");
    pageStyle.textContent = ".kc-card { color: red; display: none; }";
    document.head.appendChild(pageStyle);

    const card = parseCard({
      id: "card-headline",
      type: "headline",
      states: [{ id: "headline-1", title: "見出し", tone: "primary" }],
    });
    const renderer = createLiveCardRenderer(host);
    renderer.setCards([card]);
    renderer.setVisual(cardVisual("card-headline", "headline-1"));
    const shadowStyle = mustQuery(
      renderer.shadowRoot,
      "style[data-live-card-styles]",
    );
    const cardRoot = mustQuery(renderer.shadowRoot, ".kc-card");

    expect(shadowStyle.textContent).toContain(".kc-card");
    expect(shadowStyle.textContent).toContain("var(--kakeai-accent-primary");
    expect(shadowStyle.textContent).toContain("var(--kakeai-font-title");
    expect(renderer.shadowRoot.host).toBe(host);
    expect(renderer.shadowRoot.contains(pageStyle)).toBe(false);
    expect(document.head.contains(shadowStyle)).toBe(false);
    expect(document.querySelector("style[data-live-card-styles]")).toBeNull();
    expect(cardRoot.getRootNode()).toBe(renderer.shadowRoot);
    expect(host.getAttribute("style")).toContain("--kakeai-accent-primary");
    expect(host.getAttribute("style")).toContain("--kakeai-font-title");
  });

  it("hides the whole card when the image resolver fails", async () => {
    const errors: unknown[] = [];
    const { host } = createEnvironment();
    const renderer = createLiveCardRenderer(host, {
      resolveAsset: () => Promise.reject(new Error("missing asset")),
      onError: (error) => errors.push(error),
    });
    const card = parseCard({
      id: "card-image",
      type: "image",
      states: [{ id: "image-1", assetId: "asset-missing", alt: "図版" }],
    });
    renderer.setCards([card]);
    renderer.setVisual(cardVisual("card-image", "image-1"));
    expect(renderer.current).toEqual({ cardId: "card-image", stateId: "image-1" });

    await flushAsync();

    expect(renderer.current).toBeNull();
    expect(renderer.slot.hasAttribute("hidden")).toBe(true);
    expect(renderer.shadowRoot.querySelector(".kc-card")).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });

  it("hides on an image error event and does not throw", async () => {
    const errors: unknown[] = [];
    const { host, window } = createEnvironment();
    const renderer = createLiveCardRenderer(host, {
      resolveAsset: (assetId) => `/assets/${assetId}.png`,
      onError: (error) => errors.push(error),
    });
    const card = parseCard({
      id: "card-image",
      type: "image",
      states: [{ id: "image-1", assetId: "asset-1", alt: "図版" }],
    });
    renderer.setCards([card]);
    renderer.setVisual(cardVisual("card-image", "image-1"));
    await flushAsync();
    const image = mustQuery<HTMLImageElement>(renderer.shadowRoot, "img");
    expect(image.getAttribute("src")).toBe("/assets/asset-1.png");

    const EventConstructor = (window as unknown as { Event: typeof Event }).Event;
    image.dispatchEvent(new EventConstructor("error"));

    expect(renderer.current).toBeNull();
    expect(renderer.slot.hasAttribute("hidden")).toBe(true);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("hides when the resolver throws synchronously", async () => {
    const { host } = createEnvironment();
    const renderer = createLiveCardRenderer(host, {
      resolveAsset: () => {
        throw new Error("sync failure");
      },
    });
    const card = parseCard({
      id: "card-image",
      type: "image",
      states: [{ id: "image-1", assetId: "asset-1" }],
    });
    renderer.setCards([card]);
    renderer.setVisual(cardVisual("card-image", "image-1"));
    await flushAsync();
    expect(renderer.current).toBeNull();
    expect(renderer.shadowRoot.querySelector(".kc-card")).toBeNull();
  });

  it("hides when a visual cannot be resolved", () => {
    const { host } = createEnvironment();
    const errors: unknown[] = [];
    const renderer = createLiveCardRenderer(host, {
      onError: (error) => errors.push(error),
    });
    renderer.setCards([]);
    renderer.setVisual(cardVisual("missing-card", "missing-state"));
    expect(renderer.current).toBeNull();
    expect(renderer.slot.hasAttribute("hidden")).toBe(true);
    expect(errors.length).toBeGreaterThan(0);
  });
});
