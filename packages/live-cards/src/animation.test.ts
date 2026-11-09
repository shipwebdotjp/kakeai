import { describe, expect, it } from "vitest";
import {
  createDefaultAnimationAdapter,
  createRecordingAnimationAdapter,
  type LiveCardAnimationRequest,
} from "./index";
import { createLiveCardPreview } from "./preview";
import { createLiveCardRenderer } from "./renderer";
import { cardVisual, createEnvironment, parseCard } from "./test-helpers";

function listCard() {
  return parseCard({
    id: "card-list",
    type: "list",
    animation: {
      enter: { preset: "fade", durationMs: 400, delayMs: 0, staggerMs: 0 },
      update: { preset: "slide-up", durationMs: 300, delayMs: 50, staggerMs: 120 },
    },
    states: [
      {
        id: "state-1",
        title: "ポイント",
        items: [{ id: "item-a", text: "A" }],
      },
      {
        id: "state-2",
        title: "ポイント",
        items: [
          { id: "item-a", text: "A" },
          { id: "item-b", text: "B" },
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
    ],
  });
}

function quoteCard() {
  return parseCard({
    id: "card-quote",
    type: "quote",
    animation: {
      enter: { preset: "scale-in", durationMs: 650, delayMs: 70, staggerMs: 30 },
      update: { preset: "fade", durationMs: 200, delayMs: 0, staggerMs: 0 },
    },
    states: [{ id: "quote-1", quote: "引用です", author: "著者" }],
  });
}

function lastRequest(
  requests: readonly LiveCardAnimationRequest[],
): LiveCardAnimationRequest {
  const request = requests[requests.length - 1];
  if (request === undefined) {
    throw new Error("アニメーションリクエストがありません");
  }
  return request;
}

describe("live card animation lifecycle", () => {
  it("renders the initial snapshot silently, then sends update details", () => {
    const { host } = createEnvironment();
    const adapter = createRecordingAnimationAdapter();
    const renderer = createLiveCardRenderer(host, { animationAdapter: adapter });
    renderer.setCards([listCard()]);
    renderer.setVisual(cardVisual("card-list", "state-1"));
    expect(adapter.requests).toHaveLength(0);

    renderer.markSettled();
    renderer.setVisual(cardVisual("card-list", "state-2"));

    expect(adapter.requests).toHaveLength(1);
    const request = adapter.requests[0];
    expect(request?.kind).toBe("update");
    expect(request?.cardId).toBe("card-list");
    expect(request?.stateId).toBe("state-2");
    expect(request?.preset).toBe("slide-up");
    expect(request?.durationMs).toBe(300);
    expect(request?.delayMs).toBe(50);
    expect(request?.staggerMs).toBe(120);
    expect(
      request?.targets.some(
        (target) => target.getAttribute("data-item-id") === "item-b",
      ),
    ).toBe(true);
  });

  it("does nothing for the same state, switches cards with enter, and replays enter after hide", () => {
    const { host } = createEnvironment();
    const adapter = createRecordingAnimationAdapter();
    const renderer = createLiveCardRenderer(host, { animationAdapter: adapter });
    renderer.setCards([listCard(), quoteCard()]);
    renderer.setVisual(cardVisual("card-list", "state-1"));
    renderer.markSettled();
    renderer.setVisual(cardVisual("card-list", "state-2"));
    const count = adapter.requests.length;
    renderer.setVisual(cardVisual("card-list", "state-2"));
    expect(adapter.requests).toHaveLength(count);

    renderer.setVisual(cardVisual("card-quote", "quote-1"));
    const enter = lastRequest(adapter.requests);
    expect(enter.kind).toBe("enter");
    expect(enter.cardId).toBe("card-quote");
    expect(enter.preset).toBe("scale-in");
    expect(enter.durationMs).toBe(650);
    expect(enter.delayMs).toBe(70);
    expect(enter.staggerMs).toBe(30);
    expect(renderer.shadowRoot.querySelector('[data-card-id="card-list"]')).toBeNull();
    expect(
      renderer.shadowRoot.querySelector('[data-card-id="card-quote"]'),
    ).not.toBeNull();

    renderer.setVisual(null);
    expect(renderer.current).toBeNull();
    expect(renderer.slot.hasAttribute("hidden")).toBe(true);
    renderer.setVisual(cardVisual("card-quote", "quote-1"));
    expect(lastRequest(adapter.requests).kind).toBe("enter");
  });

  it("keeps the editor preview completed and silent", () => {
    const { host } = createEnvironment();
    const adapter = createRecordingAnimationAdapter();
    const renderer = createLiveCardPreview(host, { animationAdapter: adapter });
    renderer.setCards([listCard()]);
    renderer.setVisual(cardVisual("card-list", "state-1"));
    renderer.setVisual(cardVisual("card-list", "state-2"));
    renderer.setVisual(cardVisual("card-list", "state-3"));
    expect(adapter.requests).toHaveLength(0);
    expect(renderer.current).toEqual({ cardId: "card-list", stateId: "state-3" });
  });

  it("completes immediately when prefers-reduced-motion is active", () => {
    const scope = globalThis as unknown as {
      matchMedia?: (query: string) => { matches: boolean };
    };
    const original = scope.matchMedia;
    scope.matchMedia = () => ({ matches: true });
    try {
      const { host } = createEnvironment();
      const adapter = createRecordingAnimationAdapter();
      const renderer = createLiveCardRenderer(host, {
        animate: true,
        animationAdapter: adapter,
      });
      renderer.setCards([listCard()]);
      renderer.setVisual(cardVisual("card-list", "state-1"));
      renderer.markSettled();
      renderer.setVisual(cardVisual("card-list", "state-2"));
      expect(adapter.requests).toHaveLength(0);
      expect(renderer.current).toEqual({ cardId: "card-list", stateId: "state-2" });
    } finally {
      if (original === undefined) {
        delete scope.matchMedia;
      } else {
        scope.matchMedia = original;
      }
    }
  });

  it("suppresses animation for a reconnect snapshot until settled again", () => {
    const { host } = createEnvironment();
    const adapter = createRecordingAnimationAdapter();
    const renderer = createLiveCardRenderer(host, { animationAdapter: adapter });
    renderer.setCards([listCard()]);
    renderer.setVisual(cardVisual("card-list", "state-1"));
    renderer.markSettled();
    adapter.clear();

    renderer.setConnected(true);
    renderer.setVisual(cardVisual("card-list", "state-2"));
    expect(adapter.requests).toHaveLength(0);
    expect(renderer.current).toEqual({ cardId: "card-list", stateId: "state-2" });

    renderer.markSettled();
    renderer.setVisual(cardVisual("card-list", "state-3"));
    expect(lastRequest(adapter.requests).kind).toBe("update");
  });

  it("runs chart grow and draw on same-card changes", () => {
    const bar = parseCard({
      id: "card-bar",
      type: "chart",
      variant: "bar",
      chartAnimation: "grow",
      states: [
        {
          id: "bar-1",
          categories: [{ key: "c1", label: "C1" }],
          series: [{ key: "s1", label: "S1", values: { c1: 10 } }],
        },
        {
          id: "bar-2",
          categories: [{ key: "c1", label: "C1" }],
          series: [{ key: "s1", label: "S1", values: { c1: 20 } }],
        },
      ],
    });
    const line = parseCard({
      id: "card-line",
      type: "chart",
      variant: "line",
      chartAnimation: "draw",
      states: [
        {
          id: "line-1",
          categories: [
            { key: "c1", label: "C1" },
            { key: "c2", label: "C2" },
          ],
          series: [{ key: "s1", label: "S1", values: { c1: 1, c2: 2 } }],
        },
        {
          id: "line-2",
          categories: [
            { key: "c1", label: "C1" },
            { key: "c2", label: "C2" },
          ],
          series: [{ key: "s1", label: "S1", values: { c1: 3, c2: 5 } }],
        },
      ],
    });
    const { host } = createEnvironment();
    const adapter = createRecordingAnimationAdapter();
    const renderer = createLiveCardRenderer(host, { animationAdapter: adapter });
    renderer.setCards([bar, line]);
    renderer.setVisual(cardVisual("card-bar", "bar-1"));
    renderer.markSettled();
    adapter.clear();
    renderer.setVisual(cardVisual("card-bar", "bar-2"));
    const grow = adapter.requests.find((request) => request.chartAnimation === "grow");
    expect(grow?.kind).toBe("update");
    expect(grow?.targets.length).toBeGreaterThan(0);
    expect(
      grow?.targets.every((target) => target.classList.contains("kc-chart-bar")),
    ).toBe(true);

    renderer.setVisual(cardVisual("card-line", "line-1"));
    renderer.markSettled();
    adapter.clear();
    renderer.setVisual(cardVisual("card-line", "line-2"));
    const draw = adapter.requests.find((request) => request.chartAnimation === "draw");
    expect(draw?.kind).toBe("update");
    expect(
      draw?.targets.every((target) => target.classList.contains("kc-chart-line-path")),
    ).toBe(true);
  });

  it("honors the reduced-motion override and cancels CSS fallbacks", () => {
    const { document } = createEnvironment();
    const target = document.createElement("div");
    const request: LiveCardAnimationRequest = {
      kind: "update",
      cardId: "card",
      stateId: "state",
      preset: "fade",
      durationMs: 1_000,
      delayMs: 0,
      staggerMs: 0,
      targets: [target],
    };
    const animated: Element[] = [];
    const animatable = target as unknown as {
      animate: () => { cancel: () => void; finished: Promise<void> };
    };
    animatable.animate = () => {
      animated.push(target);
      return { cancel: () => undefined, finished: Promise.resolve() };
    };
    const adapter = createDefaultAnimationAdapter({ reducedMotion: () => false });
    adapter.run?.(request);
    expect(animated).toEqual([target]);

    const fallbackTarget = document.createElement("div");
    const fallbackAdapter = createDefaultAnimationAdapter({
      reducedMotion: () => false,
    });
    fallbackAdapter.run?.({ ...request, targets: [fallbackTarget] });
    expect(fallbackTarget.classList.contains("kc-anim-fade")).toBe(true);
    fallbackAdapter.cancel?.();
    expect(fallbackTarget.classList.contains("kc-anim-fade")).toBe(false);

    const suppressed = createDefaultAnimationAdapter({
      reducedMotion: () => true,
    });
    suppressed.run?.({ ...request, targets: [target] });
    expect(animated).toEqual([target]);
  });

  it("never lets an animation adapter failure block state updates", () => {
    const { host } = createEnvironment();
    const renderer = createLiveCardRenderer(host, {
      animationAdapter: {
        run: () => {
          throw new Error("adapter failure");
        },
      },
    });
    renderer.setCards([listCard()]);
    renderer.setVisual(cardVisual("card-list", "state-1"));
    renderer.markSettled();
    expect(() => renderer.setVisual(cardVisual("card-list", "state-2"))).not.toThrow();
    expect(renderer.current).toEqual({ cardId: "card-list", stateId: "state-2" });
  });
});
