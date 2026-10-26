import {
  DEFAULT_ANIMATION_POLICY,
  chartBarInputSchema,
  type ChartAppearPreset,
  type ChartColorBy,
  type ChartEffect,
  type EmphasizeEffect,
  type FigureEase,
  type OnsetPreset,
  type TableColumn,
  type TableRow,
  type VisualThemeDefinition,
} from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlText } from "../escape";
import type {
  AnimationItem,
  RenderedCue,
  RenderContext,
  StateInterval,
  ValueAnimation,
} from "../render-context";
import {
  onsetOverlayId,
  planOnsetEffect,
  planValueAnimation,
  resolveTriggerWindow,
  SPOTLIGHT_DIM_OFF,
  SPOTLIGHT_DIM_ON,
  tableNumberFormatToValueFormat,
} from "../cue-effects";
import { themeRoleFontStyle } from "../theme";
import { formatNumber } from "./table-format";
import { toneHex } from "./tone";

const PLOT_HEIGHT_PX = 560;
const CATEGORY_BAND_PX = 48;
const PLOT_WIDTH_PX = 1280;
const ROW_LABEL_WIDTH_PX = 220;
/** Left edge of the horizontal bar area: the row label plus the row gap (CSS). */
const HORIZONTAL_BAR_LEFT_PX = ROW_LABEL_WIDTH_PX + 16;
/** Minimum right gutter kept free so value labels stay inside the plot. */
const HORIZONTAL_VALUE_GUTTER_PX = 96;
const HORIZONTAL_VALUE_GUTTER_MAX_PX = 240;
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

function valueLabel(value: number, column: TableColumn, locale: string): string {
  return escapeHtmlText(formatNumber(value, column.format, locale));
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

const WIDE_CHAR_PATTERN = /[\u3000-\u9fff\uff00-\uffef]/;
const WIDE_CHAR_WIDTH_PX = 24;
const NARROW_CHAR_WIDTH_PX = 13.2;

/**
 * Rough advance width of a value label at the template's 24px font. CJK and
 * fullwidth glyphs are about one em wide; digits, commas, and dots are not.
 */
function estimateLabelWidthPx(text: string): number {
  let width = 0;
  for (const char of text) {
    width += WIDE_CHAR_PATTERN.test(char) ? WIDE_CHAR_WIDTH_PX : NARROW_CHAR_WIDTH_PX;
  }
  return width;
}

function horizontalValueGutter(
  values: number[][],
  columns: TableColumn[],
  valueLabels: boolean,
  locale: string,
): number {
  if (!valueLabels) {
    return 0;
  }
  let widest = 0;
  values.forEach((row) => {
    row.forEach((value, index) => {
      const column = columns[index];
      if (column === undefined) {
        return;
      }
      widest = Math.max(widest, estimateLabelWidthPx(formatNumber(value, column.format, locale)));
    });
  });
  return clamp(
    Math.ceil(widest) + 24,
    HORIZONTAL_VALUE_GUTTER_PX,
    HORIZONTAL_VALUE_GUTTER_MAX_PX,
  );
}

interface RenderArgs {
  context: RenderContext;
  rows: TableRow[];
  values: number[][];
  stats: Scale;
  seriesColumns: TableColumn[];
  categoryColumn: TableColumn;
  colorFor: (categoryIndex: number, seriesIndex: number) => string;
  onsetFor: (categoryIndex: number, seriesIndex: number) => ChartOnset | undefined;
  labelId: (categoryIndex: number, seriesIndex: number) => string;
  valueLabels: boolean;
  axisUnit: string;
  axisFormat: TableColumn | undefined;
}

interface ChartOnset {
  preset: OnsetPreset;
  color: string;
}

function barOverlayHtml(onset: ChartOnset | undefined, overlayId: string): string {
  if (onset === undefined) {
    return "";
  }
  return `<span id="${overlayId}" class="kakeai-onsetoverlay kakeai-onset-${onset.preset}" style="--kakeai-onset-color:${onset.color}"></span>`;
}

function axisTickLabel(
  tick: number,
  column: TableColumn | undefined,
  unit: string,
  locale: string,
): string {
  const formatted = column === undefined ? String(tick) : formatNumber(tick, column.format, locale);
  return escapeHtmlText(`${formatted}${unit}`);
}

function renderVertical(args: RenderArgs): string {
  const { context, rows, values, stats, seriesColumns, categoryColumn, colorFor, onsetFor, labelId, valueLabels, axisUnit, axisFormat } = args;
  const locale = context.document.locale;
  const available = PLOT_HEIGHT_PX - CATEGORY_BAND_PX;
  const availableWidth = PLOT_WIDTH_PX - ROW_LABEL_WIDTH_PX;
  const bandWidth = rows.length === 0 ? availableWidth : availableWidth / rows.length;
  const width = barThickness(bandWidth - CATEGORY_GAP_PX, seriesColumns.length, MAX_BAR_THICKNESS_PX);
  const lines = stats.ticks
    .map((tick) => {
      const bottom = stats.max === 0 ? 0 : (tick / stats.max) * available;
      const offset = `bottom:${roundPx(bottom)}px`;
      return `<div class="kakeai-chartline" style="${offset}"></div><span class="kakeai-charttick" style="${offset}">${axisTickLabel(tick, axisFormat, axisUnit, locale)}</span>`;
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
            ? `<span id="${labelId(categoryIndex, seriesIndex)}" class="kakeai-chartvalue">${valueLabel(value, column, locale)}</span>`
            : "";
          const overlay = barOverlayHtml(onsetFor(categoryIndex, seriesIndex), onsetOverlayId(id));
          return `<div id="${id}" class="kakeai-chartbar" style="width:${width}px;height:${roundPx(height)}px;background:${colorFor(categoryIndex, seriesIndex)}">${label}${overlay}</div>`;
        })
        .join("");
      return `<div class="kakeai-chartcol"><div class="kakeai-chartbars">${bars}</div><div class="kakeai-chartcat">${escapeHtmlText(categoryLabel(row, categoryColumn))}</div></div>`;
    })
    .join("");
  return `<div class="kakeai-chartplot" style="height:${PLOT_HEIGHT_PX}px;--kakeai-chart-label-w:${ROW_LABEL_WIDTH_PX}px"><div class="kakeai-chartlines" style="bottom:${CATEGORY_BAND_PX}px">${lines}</div><div class="kakeai-chartcols" style="left:${ROW_LABEL_WIDTH_PX}px">${cols}</div></div>`;
}

function renderHorizontal(args: RenderArgs): string {
  const { context, rows, values, stats, seriesColumns, categoryColumn, colorFor, onsetFor, labelId, valueLabels, axisUnit, axisFormat } = args;
  const locale = context.document.locale;
  const available =
    PLOT_WIDTH_PX -
    HORIZONTAL_BAR_LEFT_PX -
    horizontalValueGutter(values, seriesColumns, valueLabels, locale);
  const availableHeight = PLOT_HEIGHT_PX;
  const rowHeight =
    rows.length === 0
      ? availableHeight
      : (availableHeight - CATEGORY_GAP_PX * (rows.length - 1)) / rows.length;
  const height = barThickness(rowHeight, seriesColumns.length, MAX_BAR_THICKNESS_PX);
  const lines = stats.ticks
    .map((tick) => {
      const left = stats.max === 0 ? 0 : (tick / stats.max) * available;
      return `<div class="kakeai-charthline" style="left:${roundPx(left)}px"><span class="kakeai-charthtick">${axisTickLabel(tick, axisFormat, axisUnit, locale)}</span></div>`;
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
            ? `<span id="${labelId(categoryIndex, seriesIndex)}" class="kakeai-charthvalue">${valueLabel(value, column, locale)}</span>`
            : "";
          const overlay = barOverlayHtml(onsetFor(categoryIndex, seriesIndex), onsetOverlayId(id));
          return `<div id="${id}" class="kakeai-chartbar kakeai-chartbar-h" style="width:${roundPx(width)}px;height:${height}px;background:${colorFor(categoryIndex, seriesIndex)}">${label}${overlay}</div>`;
        })
        .join("");
      return `<div class="kakeai-chartrow"><div class="kakeai-charthcat">${escapeHtmlText(categoryLabel(row, categoryColumn))}</div><div class="kakeai-chartbars-h">${bars}</div></div>`;
    })
    .join("");
  const linesOffset = HORIZONTAL_BAR_LEFT_PX - ROW_LABEL_WIDTH_PX;
  return `<div class="kakeai-chartplot kakeai-chartplot-h" style="width:${PLOT_WIDTH_PX}px;--kakeai-chart-label-w:${ROW_LABEL_WIDTH_PX}px"><div class="kakeai-chartlines-h" style="left:calc(var(--kakeai-chart-label-w) + ${linesOffset}px)">${lines}</div><div class="kakeai-chartrows">${rowsHtml}</div></div>`;
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

  const barId = (categoryIndex: number, seriesIndex: number): string =>
    context.scope.id(`bar-${categoryIndex}-${seriesIndex}`);
  const labelId = (categoryIndex: number, seriesIndex: number): string =>
    context.scope.id(`val-${categoryIndex}-${seriesIndex}`);
  const barIdsByCategory = rows.map((_row, categoryIndex) =>
    seriesColumns.map((_column, seriesIndex) => barId(categoryIndex, seriesIndex)),
  );

  const animation: AnimationItem[] = [];
  const stateIntervals: StateInterval[] = [];
  const valueAnimations: ValueAnimation[] = [];
  const onsets = new Map<string, ChartOnset>();

  applyChartEffects({
    effects: parsed.data.effects ?? [],
    orientation,
    theme: context.theme,
    barId,
    barIdsByCategory,
    labelId,
    values,
    seriesColumns,
    valueLabels: style?.valueLabels ?? true,
    categoryCount: rows.length,
    seriesCount,
    lineIntervals: context.lineIntervals ?? [],
    spanMs: context.cueTiming?.spanMs ?? 0,
    path: context.path,
    animation,
    stateIntervals,
    valueAnimations,
    onsets,
  });

  const args: RenderArgs = {
    context,
    rows,
    values,
    stats,
    seriesColumns,
    categoryColumn,
    colorFor,
    onsetFor: (categoryIndex, seriesIndex) => onsets.get(barId(categoryIndex, seriesIndex)),
    labelId,
    valueLabels: style?.valueLabels ?? true,
    axisUnit: style?.axisUnit ?? "",
    axisFormat:
      seriesColumns.every((column) => column.format === seriesColumns[0]?.format)
        ? seriesColumns[0]
        : undefined,
  };
  const body = orientation === "horizontal" ? renderHorizontal(args) : renderVertical(args);

  const titleHtml =
    title === undefined || title.trim().length === 0
      ? ""
      : `<figcaption class="kakeai-charttitle" style="${themeRoleFontStyle(context.theme, "heading", context.document.locale)}">${escapeHtmlText(title)}</figcaption>`;
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
    html: `<figure class="kakeai-chartwrap" style="${themeRoleFontStyle(context.theme, "body", context.document.locale)}"><div class="kakeai-chartframe${gridClass}${orientationClass}">${titleHtml}${legendHtml}${body}</div></figure>`,
    assetIds: [],
    animation,
    stateIntervals,
    valueAnimations,
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

function chartSpotlightSiblings(
  effect: ChartEffect,
  barIdsByCategory: readonly (readonly string[])[],
): string[] {
  if (effect.effect.kind !== "emphasize" || effect.effect.style !== "spotlight") {
    return [];
  }
  const target = effect.target;
  if (target.kind === "category") {
    return barIdsByCategory.flatMap((ids, categoryIndex) =>
      categoryIndex === target.index ? [] : [...ids],
    );
  }
  if (target.kind === "series") {
    return barIdsByCategory.flatMap((ids) =>
      ids.filter((_id, seriesIndex) => seriesIndex !== target.index),
    );
  }
  return [];
}

function chartEmphasizeOnVars(
  effect: EmphasizeEffect,
  theme: VisualThemeDefinition,
): Record<string, string | number> {
  return { boxShadow: `inset 0 0 0 4px ${toneHex(effect.tone, theme)}` };
}

function chartEmphasizeOffVars(): Record<string, string | number> {
  return { boxShadow: "none" };
}

function resolveChartValueTargets(
  effect: ChartEffect,
  categoryCount: number,
  seriesCount: number,
): { categoryIndex: number; seriesIndex: number }[] {
  const target = effect.target;
  const refs: { categoryIndex: number; seriesIndex: number }[] = [];
  for (let categoryIndex = 0; categoryIndex < categoryCount; categoryIndex += 1) {
    for (let seriesIndex = 0; seriesIndex < seriesCount; seriesIndex += 1) {
      if (
        target.kind === "bars" ||
        (target.kind === "category" && target.index === categoryIndex) ||
        (target.kind === "series" && target.index === seriesIndex)
      ) {
        refs.push({ categoryIndex, seriesIndex });
      }
    }
  }
  return refs;
}

function applyChartEffects(options: {
  effects: readonly ChartEffect[];
  orientation: "vertical" | "horizontal";
  theme: VisualThemeDefinition;
  barId: (categoryIndex: number, seriesIndex: number) => string;
  barIdsByCategory: readonly (readonly string[])[];
  labelId: (categoryIndex: number, seriesIndex: number) => string;
  values: readonly (readonly number[])[];
  seriesColumns: readonly TableColumn[];
  valueLabels: boolean;
  categoryCount: number;
  seriesCount: number;
  lineIntervals: RenderContext["lineIntervals"];
  spanMs: number;
  path: (string | number)[];
  animation: AnimationItem[];
  stateIntervals: StateInterval[];
  valueAnimations: ValueAnimation[];
  onsets: Map<string, ChartOnset>;
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
    if (entry.effect.kind === "value") {
      if (!options.valueLabels) {
        return;
      }
      for (const ref of resolveChartValueTargets(entry, options.categoryCount, options.seriesCount)) {
        const numeric = options.values[ref.categoryIndex]?.[ref.seriesIndex];
        const column = options.seriesColumns[ref.seriesIndex];
        if (numeric === undefined || column === undefined) {
          continue;
        }
        const plan = planValueAnimation({
          targetId: options.labelId(ref.categoryIndex, ref.seriesIndex),
          to: numeric,
          format: tableNumberFormatToValueFormat(column.format),
          effect: entry.effect,
          window,
          spanMs: options.spanMs,
        });
        if (plan !== null) {
          options.valueAnimations.push(plan);
        }
      }
      return;
    }
    if (entry.effect.kind === "emphasize") {
      const interval = [{ startMs: window.startMs, endMs: window.endMs }];
      for (const target of targets) {
        options.stateIntervals.push({
          targetId: target.id,
          intervals: interval,
          on: chartEmphasizeOnVars(entry.effect, options.theme),
          off: chartEmphasizeOffVars(),
        });
      }
      for (const siblingId of chartSpotlightSiblings(entry, options.barIdsByCategory)) {
        options.stateIntervals.push({
          targetId: siblingId,
          intervals: interval,
          on: SPOTLIGHT_DIM_ON,
          off: SPOTLIGHT_DIM_OFF,
        });
      }
      if (entry.effect.onset !== undefined) {
        const color = toneHex(entry.effect.tone, options.theme);
        for (const target of targets) {
          options.onsets.set(target.id, { preset: entry.effect.onset.preset, color });
          const onsetPlan = planOnsetEffect({
            overlayId: onsetOverlayId(target.id),
            effect: entry.effect,
            window,
            spanMs: options.spanMs,
          });
          options.animation.push(...onsetPlan.animation);
          options.stateIntervals.push(...onsetPlan.stateIntervals);
        }
      }
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
