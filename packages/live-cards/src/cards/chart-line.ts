import type {
  LiveChartCard,
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

const SVG_NS = "http://www.w3.org/2000/svg";
const PAD_X = 3;
const PAD_Y = 6;

interface PointView {
  element: SVGCircleElement;
  x: number;
  y: number;
  highlighted: boolean;
}

interface LineSeriesView {
  group: SVGGElement;
  path: SVGPathElement;
  points: Map<string, PointView>;
  dValue: string;
  tone: string | undefined;
  highlighted: boolean;
}

interface AxisLabelView {
  element: HTMLElement;
  label: string;
  highlighted: boolean;
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(
  document: Document,
  tag: K,
  className: string,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  element.setAttribute("class", className);
  return element as SVGElementTagNameMap[K];
}

function pointFor(
  value: number,
  index: number,
  count: number,
  scale: ChartScale,
): { x: number; y: number } {
  const x = count <= 1 ? 50 : PAD_X + (index / (count - 1)) * (100 - PAD_X * 2);
  const y = 100 - PAD_Y - ((value - scale.min) / scale.span) * (100 - PAD_Y * 2);
  return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
}

function applyPoint(
  view: PointView,
  x: number,
  y: number,
  highlighted: boolean,
): boolean {
  let changed = false;
  if (view.x !== x) {
    view.x = x;
    view.element.setAttribute("cx", String(x));
    changed = true;
  }
  if (view.y !== y) {
    view.y = y;
    view.element.setAttribute("cy", String(y));
    changed = true;
  }
  if (view.highlighted !== highlighted) {
    view.highlighted = highlighted;
    setAttribute(view.element, "data-highlight", highlighted ? "true" : "false");
    changed = true;
  }
  return changed;
}

function createSeriesView(document: Document, key: string): LineSeriesView {
  const group = createSvgElement(document, "g", "kc-chart-line-series");
  group.setAttribute("data-series-key", key);
  const path = createSvgElement(document, "path", "kc-chart-line-path");
  path.setAttribute("pathLength", "1");
  path.setAttribute("vector-effect", "non-scaling-stroke");
  group.append(path);
  return {
    group,
    path,
    points: new Map(),
    dValue: "",
    tone: undefined,
    highlighted: true,
  };
}

function applySeries(
  view: LineSeriesView,
  state: LiveChartState,
  scale: ChartScale,
  seriesHighlight: Set<string> | null,
  categoryHighlight: Set<string> | null,
  document: Document,
): { changed: boolean; chartTarget: Element | null; exitTargets: Element[] } {
  const series = state.series.find((entry) => entry.key === view.group.getAttribute("data-series-key"));
  if (series === undefined) {
    return { changed: false, chartTarget: null, exitTargets: [] };
  }
  let changed = false;
  const points = state.categories.map((category, index) => {
    const value = series.values[category.key] ?? 0;
    const point = pointFor(value, index, state.categories.length, scale);
    return { category, point };
  });
  const d = points
    .map(({ point }, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`)
    .join(" ");
  if (view.dValue !== d) {
    view.dValue = d;
    view.path.setAttribute("d", d);
    changed = true;
  }
  if (view.tone !== series.tone) {
    view.tone = series.tone;
    setAttribute(view.group, "data-tone", series.tone ?? null);
    changed = true;
  }
  const highlighted = isHighlighted(seriesHighlight, series.key);
  if (view.highlighted !== highlighted) {
    view.highlighted = highlighted;
    setAttribute(view.path, "data-highlight", highlighted ? "true" : "false");
    changed = true;
  }
  const categoriesByKey = new Map(state.categories.map((category) => [category.key, category]));
  const exitTargets: Element[] = [];
  const pointResult = reconcileKeyedChildren({
    container: view.group,
    keys: state.categories.map((category) => category.key),
    existing: view.points,
    create: (key) => {
      const circle = createSvgElement(document, "circle", "kc-chart-point");
      circle.setAttribute("data-category-key", key);
      circle.setAttribute("r", "1.5");
      return { element: circle, x: Number.NaN, y: Number.NaN, highlighted: true };
    },
    elementOf: (point) => point.element,
    update: (point, key) => {
      const category = categoriesByKey.get(key);
      if (category === undefined) {
        return false;
      }
      const value = series.values[category.key] ?? 0;
      const position = pointFor(value, state.categories.indexOf(category), state.categories.length, scale);
      return applyPoint(
        point,
        position.x,
        position.y,
        highlighted && isHighlighted(categoryHighlight, key),
      );
    },
    remove: (point) => exitTargets.push(point.element),
  });
  for (const point of pointResult.added) {
    const key = point.element.getAttribute("data-category-key") ?? "";
    const category = categoriesByKey.get(key);
    if (category === undefined) {
      continue;
    }
    const value = series.values[category.key] ?? 0;
    const position = pointFor(value, state.categories.indexOf(category), state.categories.length, scale);
    applyPoint(
      point,
      position.x,
      position.y,
      highlighted && isHighlighted(categoryHighlight, key),
    );
  }
  if (pointResult.added.length > 0 || pointResult.updated.length > 0) {
    changed = true;
  }
  return { changed, chartTarget: changed ? view.path : null, exitTargets };
}

function createAxisLabelView(document: Document, key: string): AxisLabelView {
  const element = createElement(document, "span", "kc-chart-axis-label");
  element.setAttribute("data-category-key", key);
  return { element, label: "", highlighted: true };
}

export function createLineChartView(
  card: LiveChartCard,
  document: Document,
): CardView {
  const common = createChartCommon(card, document);
  const svg = createSvgElement(document, "svg", "kc-chart-line-svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  // Keep circles circular and strokes uniform instead of stretching the
  // coordinate system to the container's aspect ratio.
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("role", "img");
  const axis = createElement(document, "div", "kc-chart-axis");
  common.body.insertBefore(svg, common.legend);
  common.body.insertBefore(axis, common.legend);
  const seriesViews = new Map<string, LineSeriesView>();
  const axisViews = new Map<string, AxisLabelView>();

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

      const seriesResult = reconcileKeyedChildren({
        container: svg,
        keys: typed.series.map((series) => series.key),
        existing: seriesViews,
        create: (key) => createSeriesView(document, key),
        elementOf: (view) => view.group,
        update: (view) => {
          const result = applySeries(
            view,
            typed,
            scale,
            highlights.series,
            highlights.categories,
            document,
          );
          if (result.changed) {
            updateTargets.push(view.group);
            if (result.chartTarget !== null) {
              chartTargets.push(result.chartTarget);
            }
          }
          exitTargets.push(...result.exitTargets);
          return result.changed;
        },
        remove: (view) => exitTargets.push(view.group),
      });
      for (const view of seriesResult.added) {
        const result = applySeries(
          view,
          typed,
          scale,
          highlights.series,
          highlights.categories,
          document,
        );
        updateTargets.push(view.group);
        if (result.chartTarget !== null) {
          chartTargets.push(result.chartTarget);
        }
        exitTargets.push(...result.exitTargets);
      }

      const categoriesByKey = new Map(
        typed.categories.map((category) => [category.key, category]),
      );
      const axisResult = reconcileKeyedChildren({
        container: axis,
        keys: typed.categories.map((category) => category.key),
        existing: axisViews,
        create: (key) => createAxisLabelView(document, key),
        elementOf: (view) => view.element,
        update: (view, key) => {
          const category = categoriesByKey.get(key);
          if (category === undefined) {
            return false;
          }
          let changed = false;
          if (view.label !== category.label) {
            view.label = category.label;
            setText(view.element, category.label);
            changed = true;
          }
          const highlighted = isHighlighted(highlights.categories, key);
          if (view.highlighted !== highlighted) {
            view.highlighted = highlighted;
            setAttribute(view.element, "data-highlight", highlighted ? "true" : "false");
            changed = true;
          }
          return changed;
        },
        remove: (view) => exitTargets.push(view.element),
      });
      for (const view of axisResult.added) {
        const category = categoriesByKey.get(view.element.getAttribute("data-category-key") ?? "");
        if (category === undefined) {
          continue;
        }
        view.label = category.label;
        setText(view.element, category.label);
        const highlighted = isHighlighted(highlights.categories, category.key);
        view.highlighted = highlighted;
        setAttribute(view.element, "data-highlight", highlighted ? "true" : "false");
      }
      updateTargets.push(...axisResult.added.map((view) => view.element));
      updateTargets.push(...axisResult.updated.map((view) => view.element));
      const ariaParts = typed.series.map((series) => {
        const values = typed.categories
          .map((category) => `${category.label} ${formatChartValue(series.values[category.key] ?? 0)}`)
          .join("、");
        return `${series.label}: ${values}`;
      });
      setAttribute(svg, "aria-label", ariaParts.join(" / "));
      return { updateTargets, chartTargets, exitTargets };
    },
  };
}
