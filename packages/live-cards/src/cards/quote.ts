import type { LiveQuoteCard, LiveQuoteState } from "@kakeai/contracts";
import { createElement, setHidden, setText } from "../dom";
import { applyCardAlign, applyCardTone, createCardShell } from "./shell";
import type { CardUpdate, CardView } from "./types";

export function createQuoteView(card: LiveQuoteCard, document: Document): CardView {
  const element = createCardShell(document, "quote", card.id);
  const body = createElement(document, "blockquote", "kc-quote");
  const text = createElement(document, "p", "kc-quote-text");
  const meta = createElement(document, "footer", "kc-quote-meta");
  const author = createElement(document, "cite", "kc-quote-author");
  const source = createElement(document, "span", "kc-quote-source");
  meta.append(author, source);
  body.append(text, meta);
  element.append(body);

  return {
    element,
    update(state): CardUpdate {
      const typed = state as LiveQuoteState;
      const updateTargets: Element[] = [];
      applyCardTone(element, typed.tone);
      applyCardAlign(element, typed.align);
      if (setText(text, typed.quote)) updateTargets.push(text);
      if (setText(author, typed.author)) updateTargets.push(author);
      if (setText(source, typed.source)) updateTargets.push(source);
      setHidden(meta, !typed.author && !typed.source);
      return { updateTargets, chartTargets: [], exitTargets: [] };
    },
  };
}
