import {
  DEFAULT_ANIMATION_POLICY,
  chartBarInputSchema,
  type ChartAppearPreset,
  type ChartColorBy,
  type ChartEffect,
  type FigureEase,
  type TableColumn,
  type TableRow,
} from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlText } from "../escape";
import type { AnimationItem, RenderedCue, RenderContext, StateInterval } from "../render-context";
import { resolveTriggerWindow } from "../cue-effects";
import { formatNumber } from "./table-format";

const PLOT_HEIGHT_PX = 560;
const CATEGORY_BAND_PX = 48;
const PLOT_WIDTH_PX = 1280;
const ROW_LABEL_WIDTH_PX = 220;
const TARGET_TICKS = 5;
const BAR_GAP_PX = 10;
const CATEGORY_GAP_PX = 28;
const MAX_BAR_THICKNESS_PX = 64;
const MIN_BAR_THICKNESS_PX = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function barThickness(availableBand: number, count: number, max: number): number {
  if (count <= 0) {
    return max;
  }
  const raw = Math.floor((availableBand - BAR_GAP_PX * (count - 1)) / count);
  return clamp(raw, MIN_BAR_THICKNESS_PX, max);
}

interface Scale {
  max: number;
  ticks: number[];
}

function niceScale(maxValue: number): Scale {
  if (!Number.isFinite(maxValue) || maxValue <= 0) {
    return { max: 0, ticks: [0] };
  }
  const rough = maxValue / TARGET_TICKS;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / magnitude;
  const stepBase = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = stepBase * magnitude;
  const steps = Math.ceil(maxValue / step);
  const max = Math.round(steps * step * 1000) / 1000;
  const ticks = Array.from({ length: steps + 1 }, (_, index) => Math.round(index * step * 1000) / 1000);
  return { max, ticks };
}

function numericValue(value: string | number | undefined): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }
  return numeric;
}

function categoryLabel(row: TableRow, column: TableColumn): string {
  const value = row[column.key];
  return value === undefined ? "" : String(value);
}

function valueLabel(value: number, column: TableColumn): string {
  return escapeHtmlText(formatNumber(value, column.format));
}

function chartAction(
  preset: ChartAppearPreset,
): { action: "grow" | "fade"; ease: FigureEase } {
  switch (preset) {
    case "grow":
      return { action: "grow", ease: "normal" };
    case "bounce":
      return { action: "grow", ease: "overshoot" };
    case "fade":
      return { action: "fade", ease: "normal" };
  }
}

function roundPx(value: number): number {
  return Math.round(value * 100) / 100;
}

interface RenderArgs {
  context: RenderContext;
  rows: TableRow[];
  values: number[][];
  stats: Scale;
  seriesColumns: TableColumn[];
  categoryColumn: TableColumn;
  colorFor: (categoryIndex: number, seriesIndex: number) => string;
  valueLabels: boolean;
  axisUnit: string;
  axisFormat: TableColumn | undefined;
}

function axisTickLabel(tick: number, column: TableColumn | undefined, unit: string): string {
  const formatted = column === undefined ? String(tick) : formatNumber(tick, column.format);
  return escapeHtmlText(`${formatted}${unit}`);
}

function renderVertical(args: RenderArgs): string {
  const { context, rows, values, stats, seriesColumns, categoryColumn, colorFor, valueLabels, axisUnit, axisFormat } = args;
  const available = PLOT_HEIGHT_PX - CATEGORY_BAND_PX;
  const availableWidth = PLOT_WIDTH_PX - ROW_LABEL_WIDTH_PX;
  const bandWidth = rows.length === 0 ? availableWidth : availableWidth / rows.length;
  const width = barThickness(bandWidth - CATEGORY_GAP_PX, seriesColumns.length, MAX_BAR_THICKNESS_PX);
  const lines = stats.ticks
    .map((tick) => {
      const bottom = CATEGORY_BAND_PX + (stats.max === 0 ? 0 : (tick / stats.max) * available);
      return `<div class="kakeai-chartline" style="bottom:${roundPx(bottom)}px"><span class="kakeai-charttick">${axisTickLabel(tick, axisFormat, axisUnit)}</span></div>`;
    })
    .join("");
  const cols = rows
    .map((row, categoryIndex) => {
      const bars = seriesColumns
        .map((column, seriesIndex) => {
          const value = values[categoryIndex]![seriesIndex]!;
          const height = stats.max === 0 ? 0 : (value / stats.max) * available;
          const id = context.scope.id(`bar-${categoryIndex}-${seriesIndex}`);
          const label = valueLabels
            ? `<span class="kakeai-chartvalue">${valueLabel(value, column)}</span>`
            : "";
          return `<div id="${id}" class="kakeai-chartbar" style="width:${width}px;height:${roundPx(height)}px;background:${colorFor(categoryIndex, seriesIndex)}">${label}</div>`;
        })
        .join("");
      return `<div class="kakeai-chartcol"><div class="kakeai-chartbars">${bars}</div><div class="kakeai-chartcat">${escapeHtmlText(categoryLabel(row, categoryColumn))}</div></div>`;
    })
    .join("");
  return `<div class="kakeai-chartplot" style="height:${PLOT_HEIGHT_PX}px"><div class="kakeai-chartlines" style="bottom:${CATEGORY_BAND_PX}px">${lines}</div><div class="kakeai-chartcols" style="left:${ROW_LABEL_WIDTH_PX}px">${cols}</div></div>`;
}

function renderHorizontal(args: RenderArgs): string {
  const { context, rows, values, stats, seriesColumns, categoryColumn, colorFor, valueLabels, axisUnit, axisFormat } = args;
  const available = PLOT_WIDTH_PX - ROW_LABEL_WIDTH_PX;
  const availableHeight = PLOT_HEIGHT_PX;
  const rowHeight =
    rows.length === 0
      ? availableHeight
      : (availableHeight - CATEGORY_GAP_PX * (rows.length - 1)) / rows.length;
  const height = barThickness(rowHeight, seriesColumns.length, MAX_BAR_THICKNESS_PX);
  const lines = stats.ticks
    .map((tick) => {
      const left = ROW_LABEL_WIDTH_PX + (stats.max === 0 ? 0 : (tick / stats.max) * available);
      return `<div class="kakeai-charthline" style="left:${roundPx(left)}px"><span class="kakeai-charthtick">${axisTickLabel(tick, axisFormat, axisUnit)}</span></div>`;
    })
    .join("");
  const rowsHtml = rows
    .map((row, categoryIndex) => {
      const bars = seriesColumns
        .map((column, seriesIndex) => {
          const value = values[categoryIndex]![seriesIndex]!;
          const width = stats.max === 0 ? 0 : (value / stats.max) * available;
          const id = context.scope.id(`bar-${categoryIndex}-${seriesIndex}`);
          const label = valueLabels
            ? `<span class="kakeai-charthvalue">${valueLabel(value, column)}</span>`
            : "";
          return `<div id="${id}" class="kakeai-chartbar kakeai-chartbar-h" style="width:${roundPx(width)}px;height:${height}px;background:${colorFor(categoryIndex, seriesIndex)}">${label}</div>`;
        })
        .join("");
      return `<div class="kakeai-chartrow"><div class="kakeai-charthcat">${escapeHtmlText(categoryLabel(row, categoryColumn))}</div><div class="kakeai-chartbars-h">${bars}</div></div>`;
    })
    .join("");
  return `<div class="kakeai-chartplot kakeai-chartplot-h" style="width:${PLOT_WIDTH_PX}px"><div class="kakeai-chartlines-h" style="left:${ROW_LABEL_WIDTH_PX}px">${lines}</div><div class="kakeai-chartrows">${rowsHtml}</div></div>`;
}

function buildLegend(
  seriesCount: number,
  colorBy: ChartColorBy,
  rows: TableRow[],
  seriesColumns: TableColumn[],
  categoryColumn: TableColumn,
  palette: readonly string[],
): string {
  if (seriesCount <= 1) {
    return "";
  }
  const entries =
    colorBy === "category"
      ? rows.map((row, index) => ({ color: palette[index % palette.length]!, label: categoryLabel(row, categoryColumn) }))
      : seriesColumns.map((column, index) => ({ color: palette[index % palette.length]!, label: column.label }));
  return `<div class="kakeai-chartlegend">${entries
    .map(
      (entry) =>
        `<span class="kakeai-chartlegenditem"><span class="kakeai-chartswatch" style="background:${entry.color}"></span>${escapeHtmlText(entry.label)}</span>`,
    )
    .join("")}</div>`;
}

export function renderChartBar(input: unknown, context: RenderContext): RenderedCue {
  const parsed = chartBarInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path: context.path, code: "invalid_input", message: "chart.bar の入力が正しくありません。" },
    ]);
  }
  const { title, data, style } = parsed.data;
  const { columns, rows } = data;
  const categoryColumn = columns[0]!;
  const seriesColumns = columns.slice(1);
  const seriesCount = seriesColumns.length;

  const colorBy: ChartColorBy = style?.colorBy ?? (seriesCount > 1 ? "series" : "category");
  const palette = context.theme.categoryColors;
  const colorFor = (categoryIndex: number, seriesIndex: number): string =>
    colorBy === "category"
      ? palette[categoryIndex % palette.length]!
      : palette[seriesIndex % palette.length]!;

  const values = rows.map((row) => seriesColumns.map((column) => numericValue(row[column.key])));
  const maxValue = values.reduce(
    (max, row) => row.reduce((inner, value) => Math.max(inner, value), max),
    0,
  );
  const stats = niceScale(maxValue);
  const orientation = style?.orientation ?? "vertical";

  const args: RenderArgs = {
    context,
    rows,
    values,
    stats,
    seriesColumns,
    categoryColumn,
    colorFor,
    valueLabels: style?.valueLabels ?? true,
    axisUnit: style?.axisUnit ?? "",
    axisFormat:
      seriesColumns.every((column) => column.format === seriesColumns[0]?.format)
        ? seriesColumns[0]
        : undefined,
  };
  const body = orientation === "horizontal" ? renderHorizontal(args) : renderVertical(args);

  const animation: AnimationItem[] = [];
  const stateIntervals: StateInterval[] = [];

  applyChartEffects({
    effects: parsed.data.effects ?? [],
    orientation,
    barId: (categoryIndex, seriesIndex) =>
      context.scope.id(`bar-${categoryIndex}-${seriesIndex}`),
    categoryCount: rows.length,
    seriesCount,
    lineIntervals: context.lineIntervals ?? [],
    spanMs: context.cueTiming?.spanMs ?? 0,
    path: context.path,
    animation,
    stateIntervals,
  });

  const titleHtml =
    title === undefined || title.trim().length === 0
      ? ""
      : `<figcaption class="kakeai-charttitle">${escapeHtmlText(title)}</figcaption>`;
  const legendHtml = buildLegend(
    seriesCount,
    colorBy,
    rows,
    seriesColumns,
    categoryColumn,
    palette,
  );
  const gridClass = (style?.preset ?? "clean") === "grid" ? " kakeai-chart-grid" : "";
  const orientationClass = orientation === "horizontal" ? " kakeai-chart-horizontal" : "";

  return {
    html: `<figure class="kakeai-chartwrap"><div class="kakeai-chartframe${gridClass}${orientationClass}">${titleHtml}${legendHtml}${body}</div></figure>`,
    assetIds: [],
    animation,
    stateIntervals,
  };
}

interface ChartEffectTargetRef {
  id: string;
  step: number;
}

function resolveChartEffectTargets(
  effect: ChartEffect,
  barId: (categoryIndex: number, seriesIndex: number) => string,
  categoryCount: number,
  seriesCount: number,
): ChartEffectTargetRef[] {
  const target = effect.target;
  switch (target.kind) {
    case "bars": {
      const targets: ChartEffectTargetRef[] = [];
      for (let categoryIndex = 0; categoryIndex < categoryCount; categoryIndex += 1) {
        for (let seriesIndex = 0; seriesIndex < seriesCount; seriesIndex += 1) {
          targets.push({ id: barId(categoryIndex, seriesIndex), step: categoryIndex });
        }
      }
      return targets;
    }
    case "category": {
      const targets: ChartEffectTargetRef[] = [];
      for (let seriesIndex = 0; seriesIndex < seriesCount; seriesIndex += 1) {
        targets.push({ id: barId(target.index, seriesIndex), step: 0 });
      }
      return targets;
    }
    case "series": {
      const targets: ChartEffectTargetRef[] = [];
      for (let categoryIndex = 0; categoryIndex < categoryCount; categoryIndex += 1) {
        targets.push({ id: barId(categoryIndex, target.index), step: 0 });
      }
      return targets;
    }
  }
}

function applyChartEffects(options: {
  effects: readonly ChartEffect[];
  orientation: "vertical" | "horizontal";
  barId: (categoryIndex: number, seriesIndex: number) => string;
  categoryCount: number;
  seriesCount: number;
  lineIntervals: RenderContext["lineIntervals"];
  spanMs: number;
  path: (string | number)[];
  animation: AnimationItem[];
  stateIntervals: StateInterval[];
}): void {
  const lineIntervals = options.lineIntervals ?? [];
  const axis = options.orientation === "horizontal" ? "x" : "y";
  options.effects.forEach((entry, effectIndex) => {
    const targets = resolveChartEffectTargets(
      entry,
      options.barId,
      options.categoryCount,
      options.seriesCount,
    );
    if (targets.length === 0) {
      return;
    }
    const path = [...options.path, "effects", effectIndex];
    const window = resolveTriggerWindow(entry.trigger, lineIntervals, options.spanMs, path);
    if (window === null) {
      return;
    }
    const { action, ease } = chartAction(entry.effect.preset);
    const maxDurationMs = Math.min(
      entry.effect.durationMs,
      DEFAULT_ANIMATION_POLICY.maxDurationMs,
    );
    const staggerMs = entry.effect.staggerMs ?? 0;
    for (const target of targets) {
      const startMs = window.startMs + target.step * staggerMs;
      if (startMs >= options.spanMs || startMs >= window.endMs) {
        continue;
      }
      const durationMs = Math.max(0, Math.min(maxDurationMs, window.endMs - startMs));
      options.animation.push({ targetId: target.id, action, axis, ease, startMs, durationMs });
      if (startMs > 0) {
        options.stateIntervals.push({
          targetId: target.id,
          intervals: [{ startMs: 0, endMs: startMs }],
          on: { opacity: 0 },
          off: { opacity: 1 },
        });
      }
    }
  });
}
