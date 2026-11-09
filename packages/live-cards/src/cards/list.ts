import type {
  LiveListCard,
  LiveListState,
  LiveListStateItem,
} from "@kakeai/contracts";
import { reconcileKeyedChildren } from "../diff";
import { createElement, setAttribute, setText } from "../dom";
import { createCardShell } from "./shell";
import type { CardUpdate, CardView } from "./types";

interface ListItemView {
  element: HTMLElement;
  marker: HTMLElement;
  text: HTMLElement;
  note: HTMLElement;
  textValue: string;
  markerValue: string;
  active: boolean;
}

function createItemView(document: Document, itemId: string): ListItemView {
  const element = createElement(document, "div", "kc-list-item");
  element.setAttribute("data-item-id", itemId);
  element.setAttribute("role", "listitem");
  const marker = createElement(document, "span", "kc-list-marker");
  marker.setAttribute("aria-hidden", "true");
  const copy = createElement(document, "div", "kc-list-copy");
  const text = createElement(document, "span", "kc-list-text");
  const note = createElement(document, "span", "kc-list-note");
  copy.append(text, note);
  element.append(marker, copy);
  return {
    element,
    marker,
    text,
    note,
    textValue: "",
    markerValue: "",
    active: false,
  };
}

function applyItem(
  view: ListItemView,
  item: LiveListStateItem,
  index: number,
  state: LiveListState,
): boolean {
  let changed = false;
  if (view.textValue !== item.text) {
    view.textValue = item.text;
    setText(view.text, item.text);
    changed = true;
  }
  // Call through even for the initial undefined note so the element gets the
  // hidden attribute instead of remaining as an empty visible span.
  if (setText(view.note, item.note)) {
    changed = true;
  }
  const markerValue = state.ordered ? String(index + 1) : "•";
  if (view.markerValue !== markerValue) {
    view.markerValue = markerValue;
    view.marker.textContent = markerValue;
    changed = true;
  }
  const active = state.activeItemId === item.id;
  if (view.active !== active) {
    view.active = active;
    setAttribute(view.element, "data-active", active ? "true" : null);
    setAttribute(view.element, "aria-current", active ? "true" : null);
    changed = true;
  }
  return changed;
}

export function createListView(card: LiveListCard, document: Document): CardView {
  const element = createCardShell(document, "list", card.id);
  const body = createElement(document, "section", "kc-list");
  const title = createElement(document, "h2", "kc-list-title");
  const items = createElement(document, "div", "kc-list-items");
  items.setAttribute("role", "list");
  body.append(title, items);
  element.append(body);
  const itemViews = new Map<string, ListItemView>();

  return {
    element,
    update(state): CardUpdate {
      const typed = state as LiveListState;
      const updateTargets: Element[] = [];
      const exitTargets: Element[] = [];
      if (setText(title, typed.title)) updateTargets.push(title);
      setAttribute(items, "data-ordered", typed.ordered ? "true" : null);

      const itemsById = new Map(typed.items.map((item) => [item.id, item]));
      const result = reconcileKeyedChildren({
        container: items,
        keys: typed.items.map((item) => item.id),
        existing: itemViews,
        create: (key) => {
          const view = createItemView(document, key);
          const item = itemsById.get(key);
          if (item !== undefined) {
            applyItem(view, item, typed.items.indexOf(item), typed);
          }
          return view;
        },
        elementOf: (view) => view.element,
        update: (view, key) => {
          const item = itemsById.get(key);
          if (item === undefined) {
            return false;
          }
          return applyItem(view, item, typed.items.indexOf(item), typed);
        },
        remove: (view) => exitTargets.push(view.element),
      });

      updateTargets.push(
        ...result.added.map((view) => view.element),
        ...result.updated.map((view) => view.element),
      );
      return { updateTargets, chartTargets: [], exitTargets };
    },
  };
}
