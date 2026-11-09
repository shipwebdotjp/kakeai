import type { LiveCard } from "@kakeai/contracts";
import { createChartView } from "./chart";
import { createHeadlineView } from "./headline";
import { createImageView } from "./image";
import { createListView } from "./list";
import { createQuoteView } from "./quote";
import type { CardView, CardViewDependencies } from "./types";

export type { CardUpdate, CardView, CardViewDependencies } from "./types";

/** Narrows the card union, then builds the matching typed view. */
export function createCardView(
  card: LiveCard,
  document: Document,
  dependencies: CardViewDependencies,
): CardView {
  switch (card.type) {
    case "headline":
      return createHeadlineView(card, document);
    case "image":
      return createImageView(card, document, dependencies);
    case "list":
      return createListView(card, document);
    case "chart":
      return createChartView(card, document);
    case "quote":
      return createQuoteView(card, document);
    default:
      throw new Error(
        `未対応のカード型です: ${String((card as { type?: unknown }).type)}`,
      );
  }
}
