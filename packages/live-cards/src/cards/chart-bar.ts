import type {
  LiveChartCard,
  LiveChartCategory,
  LiveChartSeries,
  LiveChartState,
} from "@kakeai/contracts";
import { reconcileKeyedChildren } from "../diff";
import { createElement, setAttribute, setText } from "../dom";
import {
  chartHighlightSets,
  createChartCommon,
  createChartScale,
  formatChartValue,
  isHighlighted,
  type ChartScale,
} from "./chart-shared";
import type { CardUpdate, CardView } from "./types";

interface BarView {
  element: HTMLElement;
  valueLabel: HTMLElement;
  styleValue: string;
  valueText: string;
  tone: string | undefined;
  negative: boolean;
  highlighted: boolean;
}

interface CategoryView {
  element: HTMLElement;
  plot: HTMLElement;
  label: HTMLElement;
  labelValue: string;
  bars: Map<string, BarView>;
}

interface CategoryDelta {
  changed: boolean;
  updateTargets: Element[];
  chartTargets: Element[];
  exitTargets: Element[];
}

function createBarView(document: Document, categoryKey: string, seriesKey: string): BarView {
  const element = createElement(document, "div", "kc-chart-bar");
  element.setAttribute("data-category-key", categoryKey);
  element.setAttribute("data-series-key", seriesKey);
  const valueLabel = createElement(document, "span", "kc-chart-bar-value");
  element.append(valueLabel);
  return {
    element,
    valueLabel,
    styleValue: "",
    valueText: "",
    tone: undefined,
    negative: false,
    highlighted: true,
  };
}

function applyBar(
  view: BarView,
  category: LiveChartCategory,
  series: LiveChartSeries,
  seriesIndex: number,
  seriesCount: number,
  scale: ChartScale,
  categoryHighlighted: boolean,
  seriesHighlighted: boolean,
  unit: string | undefined,
): boolean {
  const value = series.values[category.key] ?? 0;
  const barHeight = (Math.abs(value) / scale.span) * 100;
  const bottom =
    value >= 0
      ? scale.zeroRatio * 100
      : ((Math.min(value, 0) - scale.min) / scale.span) * 100;
  const width = 100 / Math.max(seriesCount, 1);
  const left = seriesIndex * width + Math.min(width * 0.08, 1.2);
  const barWidth = Math.max(width - Math.min(width * 0.16, 2.4), 1);
  const styleValue = `bottom:${bottom}%;height:${barHeight}%;left:${left}%;width:${barWidth}%;`;
  let changed = false;
  if (view.styleValue !== styleValue) {
    view.styleValue = styleValue;
    setAttribute(view.element, "style", styleValue);
    changed = true;
  }
  const valueText = formatChartValue(value);
  if (view.valueText !== valueText) {
    view.valueText = valueText;
    setText(view.valueLabel, valueText);
    changed = true;
  }
  if (view.tone !== series.tone) {
    view.tone = series.tone;
    setAttribute(view.element, "data-tone", series.tone ?? null);
    changed = true;
  }
  const negative = value < 0;
  if (view.negative !== negative) {
    view.negative = negative;
    setAttribute(view.element, "data-negative", negative ? "true" : null);
    changed = true;
  }
  const highlighted = categoryHighlighted && seriesHighlighted;
  if (view.highlighted !== highlighted) {
    view.highlighted = highlighted;
    setAttribute(view.element, "data-series-highlight", highlighted ? "true" : "false");
    changed = true;
  }
  const label = `${series.label}: ${valueText}${unit === undefined ? "" : ` ${unit}`}`;
  if (view.element.getAttribute("aria-label") !== label) {
    view.element.setAttribute("aria-label", label);
    changed = true;
  }
  return changed;
}

function createCategoryView(document: Document, key: string): CategoryView {
  const element = createElement(document, "div", "kc-chart-group");
  element.setAttribute("data-category-key", key);
  const plot = createElement(document, "div", "kc-chart-plot-group");
  const label = createElement(document, "span", "kc-chart-category");
  element.append(plot, label);
  return { element, plot, label, labelValue: "", bars: new Map() };
}

function applyCategory(
  view: CategoryView,
  category: LiveChartCategory,
  state: LiveChartState,
  scale: ChartScale,
  categoryHighlighted: boolean,
  seriesHighlight: Set<string> | null,
  document: Document,
): CategoryDelta {
  const updateTargets: Element[] = [];
  const chartTargets: Element[] = [];
  const exitTargets: Element[] = [];
  let changed = false;
  if (view.labelValue !== category.label) {
    view.labelValue = category.label;
    setText(view.label, category.label);
    updateTargets.push(view.label);
    changed = true;
  }
  if (
    setAttribute(
      view.element,
      "data-highlight",
      categoryHighlighted ? "true" : "false",
    )
  ) {
    changed = true;
    updateTargets.push(view.element);
  }
  const seriesByKey = new Map(state.series.map((series) => [series.key, series]));
  const result = reconcileKeyedChildren({
    container: view.plot,
    keys: state.series.map((series) => series.key),
    existing: view.bars,
    create: (key) => createBarView(document, category.key, key),
    elementOf: (bar) => bar.element,
    update: (bar, key) => {
      const series = seriesByKey.get(key);
      if (series === undefined) {
        return false;
      }
      const index = state.series.indexOf(series);
      return applyBar(
        bar,
        category,
        series,
        index,
        state.series.length,
        scale,
        categoryHighlighted,
        isHighlighted(seriesHighlight, key),
        state.unit,
      );
    },
    remove: (bar) => exitTargets.push(bar.element),
  });
  for (const bar of result.added) {
    const series = seriesByKey.get(bar.element.getAttribute("data-series-key") ?? "");
    if (series !== undefined) {
      applyBar(
        bar,
        category,
        series,
        state.series.indexOf(series),
        state.series.length,
        scale,
        categoryHighlighted,
        isHighlighted(seriesHighlight, series.key),
        state.unit,
      );
    }
  }
  chartTargets.push(...result.added.map((bar) => bar.element));
  chartTargets.push(...result.updated.map((bar) => bar.element));
  if (result.added.length > 0 || result.updated.length > 0) {
    changed = true;
  }
  return { changed, updateTargets, chartTargets, exitTargets };
}

export function createBarChartView(
  card: LiveChartCard,
  document: Document,
): CardView {
  const common = createChartCommon(card, document);
  const groups = createElement(document, "div", "kc-chart-groups");
  common.body.insertBefore(groups, common.legend);
  const categoryViews = new Map<string, CategoryView>();

  return {
    element: common.root,
    update(state): CardUpdate {
      const typed = state as LiveChartState;
      const commonUpdate = common.update(typed);
      const updateTargets = commonUpdate.updateTargets;
      const exitTargets = commonUpdate.exitTargets;
      const chartTargets: Element[] = [];
      const scale = createChartScale(typed);
      const highlights = chartHighlightSets(typed.highlight);
      const categoriesByKey = new Map(
        typed.categories.map((category) => [category.key, category]),
      );
      const result = reconcileKeyedChildren({
        container: groups,
        keys: typed.categories.map((category) => category.key),
        existing: categoryViews,
        create: (key) => createCategoryView(document, key),
        elementOf: (view) => view.element,
        update: (view, key) => {
          const category = categoriesByKey.get(key);
          if (category === undefined) {
            return false;
          }
          const delta = applyCategory(
            view,
            category,
            typed,
            scale,
            isHighlighted(highlights.categories, key),
            highlights.series,
            document,
          );
          updateTargets.push(...delta.updateTargets);
          chartTargets.push(...delta.chartTargets);
          exitTargets.push(...delta.exitTargets);
          return delta.changed;
        },
        remove: (view) => exitTargets.push(view.element),
      });
      for (const view of result.added) {
        const category = categoriesByKey.get(view.element.getAttribute("data-category-key") ?? "");
        if (category === undefined) {
          continue;
        }
        const delta = applyCategory(
          view,
          category,
          typed,
          scale,
          isHighlighted(highlights.categories, category.key),
          highlights.series,
          document,
        );
        updateTargets.push(...delta.updateTargets);
        chartTargets.push(...delta.chartTargets);
        exitTargets.push(...delta.exitTargets);
      }
      updateTargets.push(...result.added.map((view) => view.element));
      return { updateTargets, chartTargets, exitTargets };
    },
  };
}
