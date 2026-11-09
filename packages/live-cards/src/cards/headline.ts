import type { LiveHeadlineCard, LiveHeadlineState } from "@kakeai/contracts";
import { createElement, setText } from "../dom";
import { applyCardAlign, applyCardTone, createCardShell } from "./shell";
import type { CardUpdate, CardView } from "./types";

export function createHeadlineView(
  card: LiveHeadlineCard,
  document: Document,
): CardView {
  const element = createCardShell(document, "headline", card.id);
  const body = createElement(document, "div", "kc-headline");
  const kicker = createElement(document, "p", "kc-kicker");
  const title = createElement(document, "h1", "kc-title");
  const subtitle = createElement(document, "p", "kc-subtitle");
  body.append(kicker, title, subtitle);
  element.append(body);

  return {
    element,
    update(state): CardUpdate {
      const typed = state as LiveHeadlineState;
      const updateTargets: Element[] = [];
      applyCardTone(element, typed.tone);
      applyCardAlign(element, typed.align);
      if (setText(kicker, typed.kicker)) updateTargets.push(kicker);
      if (setText(title, typed.title)) updateTargets.push(title);
      if (setText(subtitle, typed.subtitle)) updateTargets.push(subtitle);
      return { updateTargets, chartTargets: [], exitTargets: [] };
    },
  };
}
