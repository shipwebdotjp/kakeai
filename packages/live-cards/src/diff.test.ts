import { describe, expect, it } from "vitest";
import { reconcileKeyedChildren } from "./diff";
import { createEnvironment } from "./test-helpers";

interface TestItem {
  element: HTMLSpanElement;
  text: string;
}

describe("reconcileKeyedChildren", () => {
  it("keeps keyed nodes, adds missing ones, removes stale ones and reorders", () => {
    const { document } = createEnvironment();
    const container = document.createElement("div");
    const existing = new Map<string, TestItem>();
    const texts = new Map([
      ["a", "A"],
      ["b", "B"],
      ["c", "C"],
      ["d", "D"],
    ]);
    const create = (key: string): TestItem => {
      const element = document.createElement("span");
      const text = texts.get(key) ?? "";
      element.textContent = text;
      return { element, text };
    };
    const update = (item: TestItem, key: string): boolean => {
      const next = texts.get(key) ?? "";
      if (item.text === next) {
        return false;
      }
      item.text = next;
      item.element.textContent = next;
      return true;
    };
    const elementOf = (item: TestItem): Element => item.element;

    const first = reconcileKeyedChildren({
      container,
      keys: ["a", "b", "c"],
      existing,
      create,
      update,
      elementOf,
    });
    expect(first.added).toHaveLength(3);
    const nodeA = existing.get("a")?.element;
    const nodeB = existing.get("b")?.element;
    const nodeC = existing.get("c")?.element;

    texts.set("b", "B2");
    const second = reconcileKeyedChildren({
      container,
      keys: ["a", "c", "b", "d"],
      existing,
      create,
      update,
      elementOf,
    });

    expect(existing.get("a")?.element).toBe(nodeA);
    expect(existing.get("c")?.element).toBe(nodeC);
    expect(existing.get("b")?.element).toBe(nodeB);
    expect(second.added.map((item) => item.element.textContent)).toEqual(["D"]);
    expect(second.updated.map((item) => item.element)).toEqual([nodeB]);
    expect(second.removed).toHaveLength(0);
    expect([...container.children].map((child) => child.textContent)).toEqual([
      "A",
      "C",
      "B2",
      "D",
    ]);
  });

  it("removes items that are no longer in the desired keys", () => {
    const { document } = createEnvironment();
    const container = document.createElement("div");
    const existing = new Map<string, TestItem>();
    const create = (key: string): TestItem => {
      const element = document.createElement("span");
      element.textContent = key;
      return { element, text: key };
    };
    reconcileKeyedChildren({
      container,
      keys: ["a", "b"],
      existing,
      create,
      update: () => false,
      elementOf: (item) => item.element,
    });
    const removedNode = existing.get("b")?.element;
    const result = reconcileKeyedChildren({
      container,
      keys: ["a"],
      existing,
      create,
      update: () => false,
      elementOf: (item) => item.element,
    });
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0]?.element).toBe(removedNode);
    expect(existing.has("b")).toBe(false);
    expect(container.querySelector("span")).not.toBeNull();
    expect(container.children).toHaveLength(1);
  });

  it("defers removal and keeps an exiting node in its slot when remove is supplied", () => {
    const { document } = createEnvironment();
    const container = document.createElement("div");
    const existing = new Map<string, TestItem>();
    const create = (key: string): TestItem => {
      const element = document.createElement("span");
      element.textContent = key;
      return { element, text: key };
    };
    reconcileKeyedChildren({
      container,
      keys: ["a", "b", "c"],
      existing,
      create,
      update: () => false,
      elementOf: (item) => item.element,
    });
    const nodeB = existing.get("b")?.element;
    const removed: Element[] = [];

    const result = reconcileKeyedChildren({
      container,
      keys: ["a", "c"],
      existing,
      create,
      update: () => false,
      elementOf: (item) => item.element,
      remove: (item) => removed.push(item.element),
    });

    expect(removed).toEqual([nodeB]);
    expect(result.removed.map((item) => item.element)).toEqual([nodeB]);
    expect(nodeB?.parentNode).toBe(container);
    expect([...container.children].map((child) => child.textContent)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});
