import type { LiveCardAlign, TableTone } from "@kakeai/contracts";
import { createElement, setAttribute } from "../dom";

export function createCardShell(
  document: Document,
  type: string,
  cardId: string,
): HTMLElement {
  const element = createElement(document, "article", `kc-card kc-card--${type}`);
  element.setAttribute("data-card-id", cardId);
  element.setAttribute("data-card-type", type);
  element.setAttribute("role", "group");
  return element;
}

export function applyCardTone(element: Element, tone: TableTone): void {
  setAttribute(element, "data-tone", tone);
}

export function applyCardAlign(element: Element, align: LiveCardAlign): void {
  setAttribute(element, "data-align", align);
}
