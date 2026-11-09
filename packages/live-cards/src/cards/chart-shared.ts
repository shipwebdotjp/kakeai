import type {
  LiveChartCard,
  LiveChartHighlight,
  LiveChartSeries,
  LiveChartState,
} from "@kakeai/contracts";
import { reconcileKeyedChildren } from "../diff";
import { createElement, setAttribute, setText } from "../dom";
import { createCardShell } from "./shell";

export interface ChartScale {
  min: number;
  max: number;
  span: number;
  /** Position of zero measured from the bottom, in the range 0..1. */
  zeroRatio: number;
}

export function createChartScale(state: LiveChartState): ChartScale {
  const values = state.series.flatMap((series) =>
    state.categories.map((category) => series.values[category.key] ?? 0),
  );
  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = 0;
  if (max - min < Number.EPSILON) {
    max = min + 1;
  }
  const span = max - min;
  return { min, max, span, zeroRatio: (0 - min) / span };
}

export function formatChartValue(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Math.round(value * 100) / 100);
}

export function highlightedKeys(keys: readonly string[] | undefined): Set<string> | null {
  return keys !== undefined && keys.length > 0 ? new Set(keys) : null;
}

export function isHighlighted(set: Set<string> | null, key: string): boolean {
  return set === null || set.has(key);
}

interface LegendItemView {
  element: HTMLElement;
  swatch: HTMLElement;
  label: HTMLElement;
  tone: string | undefined;
  labelValue: string;
  highlighted: boolean;
}

function applyLegendItem(
  view: LegendItemView,
  series: LiveChartSeries,
  highlighted: boolean,
): boolean {
  let changed = false;
  if (view.labelValue !== series.label) {
    view.labelValue = series.label;
    setText(view.label, series.label);
    changed = true;
  }
  if (view.tone !== series.tone) {
    view.tone = series.tone;
    setAttribute(view.swatch, "data-tone", series.tone ?? null);
    changed = true;
  }
  if (view.highlighted !== highlighted) {
    view.highlighted = highlighted;
    setAttribute(view.element, "data-highlight", highlighted ? "true" : "false");
    changed = true;
  }
  return changed;
}

function createLegendItem(document: Document, key: string): LegendItemView {
  const element = createElement(document, "span", "kc-chart-legend-item");
  element.setAttribute("data-series-key", key);
  const swatch = createElement(document, "span", "kc-chart-swatch");
  const label = createElement(document, "span", "kc-chart-legend-label");
  element.append(swatch, label);
  return {
    element,
    swatch,
    label,
    tone: undefined,
    labelValue: "",
    highlighted: true,
  };
}

export interface ChartCommonUpdate {
  updateTargets: Element[];
  /** Legend entries removed by this update, kept for their exit animation. */
  exitTargets: Element[];
}

export interface ChartCommonView {
  root: HTMLElement;
  surface: HTMLElement;
  body: HTMLElement;
  legend: HTMLElement;
  unit: HTMLElement;
  update(state: LiveChartState): ChartCommonUpdate;
}

/**
 * Shared chart shell: title, plot body, legend and unit. The bar/line view
 * inserts its plot before the legend.
 */
export function createChartCommon(
  card: LiveChartCard,
  document: Document,
): ChartCommonView {
  const root = createCardShell(document, "chart", card.id);
  const surface = createElement(document, "section", "kc-chart");
  const title = createElement(document, "h2", "kc-chart-title");
  const body = createElement(document, "div", "kc-chart-body");
  const legend = createElement(document, "div", "kc-chart-legend");
  const unit = createElement(document, "p", "kc-chart-unit");
  body.append(legend, unit);
  surface.append(title, body);
  root.append(surface);
  const legendItems = new Map<string, LegendItemView>();

  return {
    root,
    surface,
    body,
    legend,
    unit,
    update(state): ChartCommonUpdate {
      const updateTargets: Element[] = [];
      const exitTargets: Element[] = [];
      if (setText(title, state.title)) updateTargets.push(title);
      if (setText(unit, state.unit)) updateTargets.push(unit);
      const highlight = state.highlight;
      const seriesHighlight =
        highlight?.seriesKeys !== undefined && highlight.seriesKeys.length > 0
          ? highlight.seriesKeys
          : undefined;
      const seriesSet = highlightedKeys(seriesHighlight);
      const categorySet = highlightedKeys(highlight?.categoryKeys);
      setAttribute(
        surface,
        "data-has-highlight",
        seriesSet === null && categorySet === null ? null : "true",
      );
      const seriesByKey = new Map(state.series.map((series) => [series.key, series]));
      const result = reconcileKeyedChildren({
        container: legend,
        keys: state.series.map((series) => series.key),
        existing: legendItems,
        create: (key) => createLegendItem(document, key),
        elementOf: (view) => view.element,
        update: (view, key) => {
          const series = seriesByKey.get(key);
          if (series === undefined) {
            return false;
          }
          return applyLegendItem(view, series, isHighlighted(seriesSet, key));
        },
        remove: (view) => exitTargets.push(view.element),
      });
      // New legend entries need their content populated; update also reports
      // changed entries.
      for (const view of result.added) {
        const series = seriesByKey.get(view.element.getAttribute("data-series-key") ?? "");
        if (series !== undefined) {
          applyLegendItem(view, series, isHighlighted(seriesSet, series.key));
        }
      }
      updateTargets.push(...result.added.map((view) => view.element));
      updateTargets.push(...result.updated.map((view) => view.element));
      return { updateTargets, exitTargets };
    },
  };
}

/** Highlight sets shared by bar and line charts. */
export function chartHighlightSets(highlight: LiveChartHighlight | undefined): {
  categories: Set<string> | null;
  series: Set<string> | null;
} {
  return {
    categories: highlightedKeys(highlight?.categoryKeys),
    series: highlightedKeys(highlight?.seriesKeys),
  };
}
