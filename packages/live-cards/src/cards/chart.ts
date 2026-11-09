import type { LiveChartCard } from "@kakeai/contracts";
import { createBarChartView } from "./chart-bar";
import { createLineChartView } from "./chart-line";
import type { CardView } from "./types";

export function createChartView(card: LiveChartCard, document: Document): CardView {
  return card.variant === "bar"
    ? createBarChartView(card, document)
    : createLineChartView(card, document);
}
