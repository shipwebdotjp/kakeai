import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultAnimationAdapter,
  createRecordingAnimationAdapter,
  type LiveCardAnimationRequest,
} from "./index";
import { createLiveCardRenderer } from "./renderer";
import {
  cardVisual,
  createEnvironment,
  mustQuery,
  parseCard,
  queryAll,
} from "./test-helpers";

const EXIT = 200;
const EXIT_SETTLE = EXIT + 32;

function listCard() {
  return parseCard({
    id: "card-list",
    type: "list",
    animation: {
      enter: { preset: "fade", durationMs: 100, delayMs: 0, staggerMs: 0 },
      update: { preset: "slide-up", durationMs: EXIT, delayMs: 0, staggerMs: 25 },
    },
    states: [
      {
        id: "state-1",
        title: "ポイント",
        items: [
          { id: "item-a", text: "A" },
          { id: "item-b", text: "B" },
          { id: "item-c", text: "C" },
        ],
      },
      {
        id: "state-2",
        title: "ポイント",
        items: [
          { id: "item-a", text: "A" },
          { id: "item-c", text: "C" },
        ],
      },
      {
        id: "state-3",
        title: "ポイント",
        items: [
          { id: "item-a", text: "A" },
          { id: "item-b", text: "B" },
          { id: "item-c", text: "C" },
        ],
      },
      {
        id: "state-4",
        title: "ポイント",
        items: [{ id: "item-a", text: "A" }],
      },
    ],
  });
}

function barCard() {
  return parseCard({
    id: "card-bar",
    type: "chart",
    variant: "bar",
    chartAnimation: "grow",
    animation: {
      enter: { preset: "fade", durationMs: 100, delayMs: 0, staggerMs: 0 },
      update: { preset: "fade", durationMs: EXIT, delayMs: 0, staggerMs: 0 },
    },
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
      },
      {
        id: "bar-2",
        title: "四半期",
        categories: [{ key: "q1", label: "Q1" }],
        series: [{ key: "revenue", label: "売上", values: { q1: 12 } }],
      },
    ],
  });
}

function lineCard() {
  return parseCard({
    id: "card-line",
    type: "chart",
    variant: "line",
    chartAnimation: "draw",
    animation: {
      enter: { preset: "fade", durationMs: 100, delayMs: 0, staggerMs: 0 },
      update: { preset: "fade", durationMs: EXIT, delayMs: 0, staggerMs: 0 },
    },
    states: [
      {
        id: "line-1",
        title: "推移",
        categories: [
          { key: "c1", label: "1月" },
          { key: "c2", label: "2月" },
        ],
        series: [
          { key: "visitors", label: "来場者", values: { c1: 10, c2: 20 } },
          { key: "revenue", label: "売上", values: { c1: 100, c2: 200 } },
        ],
      },
      {
        id: "line-2",
        title: "推移",
        categories: [{ key: "c1", label: "1月" }],
        series: [{ key: "visitors", label: "来場者", values: { c1: 12 } }],
      },
    ],
  });
}

function exitRequest(
  requests: readonly LiveCardAnimationRequest[],
): LiveCardAnimationRequest | undefined {
  return requests.find((request) => request.kind === "exit");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("live card exit animations", () => {
  it("animates a removed list item out before detaching it", () => {
    vi.useFakeTimers();
    const { host } = createEnvironment();
    const adapter = createRecordingAnimationAdapter();
    const renderer = createLiveCardRenderer(host, { animationAdapter: adapter });
    renderer.setCards([listCard()]);
    renderer.setVisual(cardVisual("card-list", "state-1"));
    renderer.markSettled();
    adapter.clear();
    const itemA = mustQuery(renderer.shadowRoot, '[data-item-id="item-a"]');
    const itemB = mustQuery(renderer.shadowRoot, '[data-item-id="item-b"]');
    const itemC = mustQuery(renderer.shadowRoot, '[data-item-id="item-c"]');

    renderer.setVisual(cardVisual("card-list", "state-2"));

    const exit = exitRequest(adapter.requests);
    expect(exit).toBeDefined();
    expect(exit?.preset).toBe("slide-up");
    expect(exit?.durationMs).toBe(EXIT);
    expect(exit?.targets).toEqual([itemB]);
    expect(itemB.parentNode).not.toBeNull();
    // The exiting node keeps its slot; survivors are not rebuilt.
    expect(queryAll(renderer.shadowRoot, ".kc-list-item")).toEqual([
      itemA,
      itemB,
      itemC,
    ]);
    expect(mustQuery(renderer.shadowRoot, '[data-item-id="item-a"]')).toBe(itemA);
    expect(mustQuery(renderer.shadowRoot, '[data-item-id="item-c"]')).toBe(itemC);

    vi.advanceTimersByTime(EXIT_SETTLE - 1);
    expect(itemB.parentNode).not.toBeNull();
    vi.advanceTimersByTime(2);
    expect(itemB.parentNode).toBeNull();
    expect(queryAll(renderer.shadowRoot, ".kc-list-item")).toEqual([itemA, itemC]);
  });

  it("removes immediately for animate:false, reduced motion and per-call opt-out", () => {
    vi.useFakeTimers();
    const cases: Array<{
      label: string;
      options: Parameters<typeof createLiveCardRenderer>[1];
      animate?: boolean;
    }> = [
      {
        label: "animate:false",
        options: { animate: false },
      },
      {
        label: "reduced motion",
        options: { reducedMotion: true },
      },
      {
        label: "per-call",
        options: {},
        animate: false,
      },
    ];
    for (const testCase of cases) {
      const { host } = createEnvironment();
      const adapter = createRecordingAnimationAdapter();
      const renderer = createLiveCardRenderer(host, {
        ...testCase.options,
        animationAdapter: adapter,
      });
      renderer.setCards([listCard()]);
      renderer.setVisual(cardVisual("card-list", "state-1"));
      renderer.markSettled();

      renderer.setVisual(
        cardVisual("card-list", "state-2"),
        testCase.animate === undefined ? undefined : { animate: testCase.animate },
      );

      expect(exitRequest(adapter.requests), testCase.label).toBeUndefined();
      expect(
        renderer.shadowRoot.querySelector('[data-item-id="item-b"]'),
        testCase.label,
      ).toBeNull();
      expect(queryAll(renderer.shadowRoot, ".kc-list-item")).toHaveLength(2);
    }
  });

  it("settles a running exit before rendering the next state", () => {
    vi.useFakeTimers();
    const { host } = createEnvironment();
    const adapter = createRecordingAnimationAdapter();
    const renderer = createLiveCardRenderer(host, { animationAdapter: adapter });
    renderer.setCards([listCard()]);
    renderer.setVisual(cardVisual("card-list", "state-1"));
    renderer.markSettled();
    adapter.clear();

    const oldB = mustQuery(renderer.shadowRoot, '[data-item-id="item-b"]');
    renderer.setVisual(cardVisual("card-list", "state-2"));
    expect(exitRequest(adapter.requests)?.targets).toEqual([oldB]);
    expect(oldB.parentNode).not.toBeNull();

    // Re-add item-b while its old node is still animating out.
    renderer.setVisual(cardVisual("card-list", "state-3"));
    const newB = mustQuery(renderer.shadowRoot, '[data-item-id="item-b"]');
    expect(newB).not.toBe(oldB);
    expect(oldB.parentNode).toBeNull();
    expect(queryAll(renderer.shadowRoot, '[data-item-id="item-b"]')).toHaveLength(1);
    expect(queryAll(renderer.shadowRoot, ".kc-list-item")).toHaveLength(3);

    // Remove two items, then restore them before the exit finishes.
    renderer.setVisual(cardVisual("card-list", "state-4"));
    expect(queryAll(renderer.shadowRoot, ".kc-list-item")).toHaveLength(3);
    renderer.setVisual(cardVisual("card-list", "state-1"));
    expect(queryAll(renderer.shadowRoot, ".kc-list-item")).toHaveLength(3);
    expect(
      queryAll(renderer.shadowRoot, ".kc-list-item").map((element) =>
        element.getAttribute("data-item-id"),
      ),
    ).toEqual(["item-a", "item-b", "item-c"]);

    vi.advanceTimersByTime(EXIT_SETTLE * 4);
    expect(queryAll(renderer.shadowRoot, ".kc-list-item")).toHaveLength(3);
  });

  it("animates removed bar chart categories, series and legend entries", () => {
    vi.useFakeTimers();
    const { host } = createEnvironment();
    const adapter = createRecordingAnimationAdapter();
    const renderer = createLiveCardRenderer(host, { animationAdapter: adapter });
    renderer.setCards([barCard()]);
    renderer.setVisual(cardVisual("card-bar", "bar-1"));
    renderer.markSettled();
    adapter.clear();
    const q1 = mustQuery(renderer.shadowRoot, '.kc-chart-group[data-category-key="q1"]');
    const q2 = mustQuery(renderer.shadowRoot, '.kc-chart-group[data-category-key="q2"]');
    const costLegend = mustQuery(
      renderer.shadowRoot,
      '.kc-chart-legend-item[data-series-key="cost"]',
    );
    const q1Cost = mustQuery(
      renderer.shadowRoot,
      '.kc-chart-bar[data-category-key="q1"][data-series-key="cost"]',
    );

    renderer.setVisual(cardVisual("card-bar", "bar-2"));

    const exit = exitRequest(adapter.requests);
    expect(exit).toBeDefined();
    expect(exit?.targets).toContain(q2);
    expect(exit?.targets).toContain(costLegend);
    expect(exit?.targets).toContain(q1Cost);
    expect(exit?.targets).not.toContain(q1);
    expect(q2.parentNode).not.toBeNull();
    expect(costLegend.parentNode).not.toBeNull();
    expect(q1Cost.parentNode).not.toBeNull();
    expect(
      mustQuery(renderer.shadowRoot, '.kc-chart-group[data-category-key="q1"]'),
    ).toBe(q1);

    vi.advanceTimersByTime(EXIT_SETTLE);
    expect(q2.parentNode).toBeNull();
    expect(costLegend.parentNode).toBeNull();
    expect(q1Cost.parentNode).toBeNull();
    expect(q1.parentNode).not.toBeNull();
    expect(
      mustQuery(renderer.shadowRoot, '.kc-chart-bar[data-category-key="q1"][data-series-key="revenue"]'),
    ).not.toBeNull();
  });

  it("animates removed line chart series, points and axis labels", () => {
    vi.useFakeTimers();
    const { host } = createEnvironment();
    const adapter = createRecordingAnimationAdapter();
    const renderer = createLiveCardRenderer(host, { animationAdapter: adapter });
    renderer.setCards([lineCard()]);
    renderer.setVisual(cardVisual("card-line", "line-1"));
    renderer.markSettled();
    adapter.clear();
    const visitors = mustQuery(
      renderer.shadowRoot,
      '.kc-chart-line-series[data-series-key="visitors"]',
    );
    const revenue = mustQuery(
      renderer.shadowRoot,
      '.kc-chart-line-series[data-series-key="revenue"]',
    );
    const pointC2 = mustQuery(
      renderer.shadowRoot,
      '.kc-chart-line-series[data-series-key="visitors"] .kc-chart-point[data-category-key="c2"]',
    );
    const axisC2 = mustQuery(
      renderer.shadowRoot,
      '.kc-chart-axis-label[data-category-key="c2"]',
    );
    const revenueLegend = mustQuery(
      renderer.shadowRoot,
      '.kc-chart-legend-item[data-series-key="revenue"]',
    );

    renderer.setVisual(cardVisual("card-line", "line-2"));

    const exit = exitRequest(adapter.requests);
    expect(exit).toBeDefined();
    expect(exit?.targets).toContain(revenue);
    expect(exit?.targets).toContain(pointC2);
    expect(exit?.targets).toContain(axisC2);
    expect(exit?.targets).toContain(revenueLegend);
    expect(exit?.targets).not.toContain(visitors);
    expect(revenue.parentNode).not.toBeNull();
    expect(pointC2.parentNode).not.toBeNull();
    expect(axisC2.parentNode).not.toBeNull();
    expect(
      mustQuery(renderer.shadowRoot, '.kc-chart-line-series[data-series-key="visitors"]'),
    ).toBe(visitors);

    vi.advanceTimersByTime(EXIT_SETTLE);
    expect(revenue.parentNode).toBeNull();
    expect(pointC2.parentNode).toBeNull();
    expect(axisC2.parentNode).toBeNull();
    expect(revenueLegend.parentNode).toBeNull();
    expect(visitors.parentNode).not.toBeNull();
  });

  it("does not block a state update when the exit adapter throws", () => {
    vi.useFakeTimers();
    const { host } = createEnvironment();
    const renderer = createLiveCardRenderer(host, {
      animationAdapter: {
        run: () => {
          throw new Error("exit failure");
        },
      },
    });
    renderer.setCards([listCard()]);
    renderer.setVisual(cardVisual("card-list", "state-1"));
    renderer.markSettled();

    expect(() =>
      renderer.setVisual(cardVisual("card-list", "state-2")),
    ).not.toThrow();
    expect(renderer.current).toEqual({ cardId: "card-list", stateId: "state-2" });
    const removed = renderer.shadowRoot.querySelector('[data-item-id="item-b"]');
    expect(removed).not.toBeNull();
    vi.advanceTimersByTime(EXIT_SETTLE);
    expect(removed?.parentNode).toBeNull();
  });

  it("plays the exit preset backwards and cleans up the CSS fallback", () => {
    const { document } = createEnvironment();
    const target = document.createElement("div");
    const adapter = createDefaultAnimationAdapter({ reducedMotion: () => false });
    const request: LiveCardAnimationRequest = {
      kind: "exit",
      cardId: "card",
      stateId: "state",
      preset: "fade",
      durationMs: 1_000,
      delayMs: 0,
      staggerMs: 0,
      targets: [target],
    };
    adapter.run?.(request);
    expect(target.classList.contains("kc-anim-fade")).toBe(true);
    expect((target as HTMLElement).style.getPropertyValue("animation-direction")).toBe(
      "reverse",
    );
    adapter.cancel?.();
    expect(target.classList.contains("kc-anim-fade")).toBe(false);
    expect((target as HTMLElement).style.getPropertyValue("animation-direction")).toBe(
      "",
    );
  });
});
