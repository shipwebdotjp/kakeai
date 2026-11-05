import {
  CHART_LINE_PLOT_HEIGHT_PX,
  CHART_PLOT_MAX_WIDTH_PX,
  DEFAULT_ANIMATION_POLICY,
  chartLineInputSchema,
  computeChartLineGeometry,
  figureWidthScale,
  formatNumber,
  parseChartLineNumber,
  type ChartLineEffect,
  type ChartLineSeriesGeometry,
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
  PERSISTENT_ONSET_PRESETS,
  planValueAnimation,
  resolveTriggerWindow,
  SPOTLIGHT_DIM_OFF,
  SPOTLIGHT_DIM_ON,
  tableNumberFormatToValueFormat,
} from "../cue-effects";
import { themeRoleFontStyle } from "../theme";
import { toneHex } from "./tone";

const PATH_STROKE_WIDTH = 6;
const POINT_RADIUS = 7;
const ONSET_RADIUS = 14;

function roundPx(value: number): number {
  return Math.round(value * 100) / 100;
}

function categoryLabel(row: TableRow, column: TableColumn): string {
  const value = row[column.key];
  return value === undefined ? "" : String(value);
}

function axisTickLabel(
  tick: number,
  column: TableColumn | undefined,
  unit: string,
  locale: string,
): string {
  const formatted =
    column === undefined ? String(tick) : formatNumber(tick, column.format, locale);
  return escapeHtmlText(`${formatted}${unit}`);
}

interface LineOnset {
  preset: OnsetPreset;
  color: string;
}

function pathFrameOn(color: string): Record<string, string | number> {
  return { strokeWidth: 10, filter: `drop-shadow(0 0 8px ${color})` };
}

function pathFrameOff(): Record<string, string | number> {
  return { strokeWidth: PATH_STROKE_WIDTH, filter: "none" };
}

function pointFrameOn(color: string): Record<string, string | number> {
  return { strokeWidth: 6, filter: `drop-shadow(0 0 10px ${color})` };
}

function pointFrameOff(): Record<string, string | number> {
  return { strokeWidth: 3, filter: "none" };
}

interface SeriesLookup {
  seriesIndexByKey: ReadonlyMap<string, number>;
  categoryIndexByKey: ReadonlyMap<string, number>;
}

function seriesIndicesFor(
  effect: ChartLineEffect,
  lookup: SeriesLookup,
  seriesCount: number,
): number[] {
  const target = effect.target;
  switch (target.kind) {
    case "allSeries":
      return Array.from({ length: seriesCount }, (_, index) => index);
    case "series": {
      const index = lookup.seriesIndexByKey.get(target.seriesKey);
      return index === undefined ? [] : [index];
    }
    case "category":
    case "point":
      return [];
  }
}

function pointRefsFor(
  effect: ChartLineEffect,
  lookup: SeriesLookup,
  categoryCount: number,
  seriesCount: number,
): { categoryIndex: number; seriesIndex: number }[] {
  const target = effect.target;
  switch (target.kind) {
    case "allSeries": {
      const refs: { categoryIndex: number; seriesIndex: number }[] = [];
      for (let categoryIndex = 0; categoryIndex < categoryCount; categoryIndex += 1) {
        for (let seriesIndex = 0; seriesIndex < seriesCount; seriesIndex += 1) {
          refs.push({ categoryIndex, seriesIndex });
        }
      }
      return refs;
    }
    case "series": {
      const seriesIndex = lookup.seriesIndexByKey.get(target.seriesKey);
      if (seriesIndex === undefined) {
        return [];
      }
      return Array.from({ length: categoryCount }, (_, categoryIndex) => ({
        categoryIndex,
        seriesIndex,
      }));
    }
    case "category": {
      const categoryIndex = lookup.categoryIndexByKey.get(target.categoryKey);
      if (categoryIndex === undefined) {
        return [];
      }
      return Array.from({ length: seriesCount }, (_, seriesIndex) => ({
        categoryIndex,
        seriesIndex,
      }));
    }
    case "point": {
      const categoryIndex = lookup.categoryIndexByKey.get(target.categoryKey);
      const seriesIndex = lookup.seriesIndexByKey.get(target.seriesKey);
      return categoryIndex === undefined || seriesIndex === undefined
        ? []
        : [{ categoryIndex, seriesIndex }];
    }
  }
}

function hideBefore(
  targetId: string,
  startMs: number,
  on: Record<string, string | number>,
  off: Record<string, string | number>,
  stateIntervals: StateInterval[],
): void {
  if (startMs <= 0) {
    return;
  }
  stateIntervals.push({
    targetId,
    intervals: [{ startMs: 0, endMs: startMs }],
    on,
    off,
  });
}

function planPointOnset(options: {
  onsetId: string;
  preset: OnsetPreset;
  durationMs: number;
  window: { startMs: number; endMs: number };
  spanMs: number;
  animation: AnimationItem[];
  stateIntervals: StateInterval[];
}): void {
  const durationMs = Math.max(
    0,
    Math.min(
      options.durationMs,
      DEFAULT_ANIMATION_POLICY.maxDurationMs,
      options.window.endMs - options.window.startMs,
      options.spanMs - options.window.startMs,
    ),
  );
  if (durationMs <= 0 || options.window.startMs >= options.spanMs) {
    return;
  }
  hideBefore(
    options.onsetId,
    options.window.startMs,
    { opacity: 0 },
    { opacity: 1 },
    options.stateIntervals,
  );
  const persistent = PERSISTENT_ONSET_PRESETS.has(options.preset);
  const visibleEnd = persistent
    ? options.window.endMs
    : Math.min(options.window.endMs, options.window.startMs + durationMs);
  options.stateIntervals.push({
    targetId: options.onsetId,
    intervals: [{ startMs: options.window.startMs, endMs: visibleEnd }],
    on: { opacity: 1 },
    off: { opacity: 0 },
  });
  options.animation.push({
    targetId: options.onsetId,
    action: options.preset,
    ease: options.preset === "pop" ? "overshoot" : "normal",
    startMs: options.window.startMs,
    durationMs,
  });
}

function applyLineEffects(options: {
  effects: readonly ChartLineEffect[];
  geometry: ReturnType<typeof computeChartLineGeometry>;
  lookup: SeriesLookup;
  theme: VisualThemeDefinition;
  pathId: (seriesIndex: number) => string;
  pointId: (categoryIndex: number, seriesIndex: number) => string;
  labelId: (categoryIndex: number, seriesIndex: number) => string;
  onsetId: (categoryIndex: number, seriesIndex: number) => string;
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
  onsets: Map<string, LineOnset>;
}): void {
  const lineIntervals = options.lineIntervals ?? [];
  options.effects.forEach((entry, effectIndex) => {
    const effectPath = [...options.path, "effects", effectIndex];
    const window = resolveTriggerWindow(
      entry.trigger,
      lineIntervals,
      options.spanMs,
      effectPath,
    );
    if (window === null) {
      return;
    }
    if (entry.effect.kind === "value") {
      if (!options.valueLabels) {
        return;
      }
      for (const ref of pointRefsFor(
        entry,
        options.lookup,
        options.categoryCount,
        options.seriesCount,
      )) {
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
      const points = pointRefsFor(
        entry,
        options.lookup,
        options.categoryCount,
        options.seriesCount,
      );
      const targetSeries = seriesIndicesFor(entry, options.lookup, options.seriesCount);
      const targetPointIds = new Set(
        points.map((ref) => options.pointId(ref.categoryIndex, ref.seriesIndex)),
      );
      const targetPathIds = new Set(targetSeries.map((index) => options.pathId(index)));
      if (entry.effect.style === "frame") {
        const color = toneHex(entry.effect.tone, options.theme);
        for (const pathId of targetPathIds) {
          options.stateIntervals.push({
            targetId: pathId,
            intervals: interval,
            on: pathFrameOn(color),
            off: pathFrameOff(),
          });
        }
        for (const pointId of targetPointIds) {
          options.stateIntervals.push({
            targetId: pointId,
            intervals: interval,
            on: pointFrameOn(color),
            off: pointFrameOff(),
          });
        }
      } else {
        for (let seriesIndex = 0; seriesIndex < options.seriesCount; seriesIndex += 1) {
          const pathId = options.pathId(seriesIndex);
          if (!targetPathIds.has(pathId)) {
            options.stateIntervals.push({
              targetId: pathId,
              intervals: interval,
              on: SPOTLIGHT_DIM_ON,
              off: SPOTLIGHT_DIM_OFF,
            });
          }
          for (let categoryIndex = 0; categoryIndex < options.categoryCount; categoryIndex += 1) {
            const pointId = options.pointId(categoryIndex, seriesIndex);
            if (!targetPointIds.has(pointId)) {
              options.stateIntervals.push({
                targetId: pointId,
                intervals: interval,
                on: SPOTLIGHT_DIM_ON,
                off: SPOTLIGHT_DIM_OFF,
              });
            }
          }
        }
      }
      if (entry.effect.onset !== undefined) {
        const color = toneHex(entry.effect.tone, options.theme);
        for (const ref of points) {
          const onsetId = options.onsetId(ref.categoryIndex, ref.seriesIndex);
          options.onsets.set(onsetId, {
            preset: entry.effect.onset.preset,
            color,
          });
          planPointOnset({
            onsetId,
            preset: entry.effect.onset.preset,
            durationMs: entry.effect.onset.durationMs,
            window,
            spanMs: options.spanMs,
            animation: options.animation,
            stateIntervals: options.stateIntervals,
          });
        }
      }
      return;
    }
    const seriesIndices = seriesIndicesFor(entry, options.lookup, options.seriesCount);
    if (seriesIndices.length === 0) {
      return;
    }
    const durationMs = Math.max(
      0,
      Math.min(
        entry.effect.durationMs,
        DEFAULT_ANIMATION_POLICY.maxDurationMs,
        window.endMs - window.startMs,
      ),
    );
    if (durationMs <= 0 || window.startMs >= options.spanMs) {
      return;
    }
    for (const seriesIndex of seriesIndices) {
      const pathId = options.pathId(seriesIndex);
      const series = options.geometry.series[seriesIndex];
      if (series === undefined) {
        continue;
      }
      if (entry.effect.preset === "draw") {
        hideBefore(
          pathId,
          window.startMs,
          { strokeDashoffset: series.length },
          { strokeDashoffset: 0 },
          options.stateIntervals,
        );
        options.animation.push({
          targetId: pathId,
          action: "draw",
          startMs: window.startMs,
          durationMs,
          fromVars: { strokeDashoffset: series.length },
        });
        series.fractions.forEach((fraction, categoryIndex) => {
          const revealMs = window.startMs + fraction * durationMs;
          if (revealMs <= 0) {
            return;
          }
          options.stateIntervals.push({
            targetId: options.pointId(categoryIndex, seriesIndex),
            intervals: [{ startMs: 0, endMs: revealMs }],
            on: { opacity: 0 },
            off: { opacity: 1 },
          });
        });
        continue;
      }
      hideBefore(
        pathId,
        window.startMs,
        { opacity: 0 },
        { opacity: 1 },
        options.stateIntervals,
      );
      options.animation.push({
        targetId: pathId,
        action: "fade",
        startMs: window.startMs,
        durationMs,
      });
      for (let categoryIndex = 0; categoryIndex < options.categoryCount; categoryIndex += 1) {
        const pointId = options.pointId(categoryIndex, seriesIndex);
        hideBefore(
          pointId,
          window.startMs,
          { opacity: 0 },
          { opacity: 1 },
          options.stateIntervals,
        );
        options.animation.push({
          targetId: pointId,
          action: "fade",
          startMs: window.startMs,
          durationMs,
        });
      }
    }
  });
}

function renderSeries(
  context: RenderContext,
  series: ChartLineSeriesGeometry,
  seriesIndex: number,
  color: string,
  onsets: Map<string, LineOnset>,
  pointId: (categoryIndex: number, seriesIndex: number) => string,
  onsetId: (categoryIndex: number, seriesIndex: number) => string,
): string {
  const points = series.points
    .map((point) => {
      const id = pointId(point.categoryIndex, seriesIndex);
      const onset = onsets.get(onsetId(point.categoryIndex, seriesIndex));
      const onsetHtml =
        onset === undefined
          ? ""
          : `<circle id="${onsetId(point.categoryIndex, seriesIndex)}" class="kakeai-linechartonset kakeai-linechartonset-${onset.preset}" cx="${point.x}" cy="${point.y}" r="${ONSET_RADIUS}" style="stroke:${onset.color};--kakeai-onset-color:${onset.color}"></circle>`;
      return `<circle id="${id}" class="kakeai-linechartpoint" cx="${point.x}" cy="${point.y}" r="${POINT_RADIUS}" style="fill:${color}"></circle>${onsetHtml}`;
    })
    .join("");
  return `<g id="${context.scope.id(`line-series-${seriesIndex}`)}" class="kakeai-linechartseries"><path id="${context.scope.id(`line-path-${seriesIndex}`)}" class="kakeai-linechartpath" d="${series.path}" style="stroke:${color};--kakeai-line-len:${series.length}"></path>${points}</g>`;
}

function buildLegend(
  seriesColumns: readonly TableColumn[],
  palette: readonly string[],
): string {
  if (seriesColumns.length <= 1) {
    return "";
  }
  return `<div class="kakeai-chartlegend">${seriesColumns
    .map(
      (column, index) =>
        `<span class="kakeai-chartlegenditem"><span class="kakeai-chartswatch" style="background:${palette[index % palette.length]}"></span>${escapeHtmlText(column.label)}</span>`,
    )
    .join("")}</div>`;
}

export function renderChartLine(input: unknown, context: RenderContext): RenderedCue {
  const parsed = chartLineInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      {
        path: context.path,
        code: "invalid_input",
        message: "chart.line の入力が正しくありません。",
      },
    ]);
  }
  const { title, data, style } = parsed.data;
  const { columns, rows } = data;
  const categoryColumn = columns[0]!;
  const seriesColumns = columns.slice(1);
  const seriesCount = seriesColumns.length;
  const categoryCount = rows.length;
  const locale = context.document.locale;
  const valueLabels = style?.valueLabels ?? false;
  const axisUnit = style?.axisUnit ?? "";
  const axisFormat =
    seriesColumns.length > 0 &&
    seriesColumns.every((column) => column.format === seriesColumns[0]?.format)
      ? seriesColumns[0]
      : undefined;

  const values = rows.map((row) =>
    seriesColumns.map((column) => parseChartLineNumber(row[column.key]) ?? 0),
  );
  const labelTexts = valueLabels
    ? values.map((row) =>
        row.map((value, index) =>
          formatNumber(value, seriesColumns[index]?.format, locale),
        ),
      )
    : undefined;
  const width = Math.round(
    Math.min(CHART_PLOT_MAX_WIDTH_PX, context.canvas.contentWidth) *
      figureWidthScale(style?.width),
  );
  const geometry = computeChartLineGeometry({
    values,
    seriesKeys: seriesColumns.map((column) => column.key),
    width,
    height: CHART_LINE_PLOT_HEIGHT_PX,
    labelTexts,
  });

  const palette = context.theme.categoryColors;
  const colorFor = (seriesIndex: number): string =>
    palette[seriesIndex % palette.length]!;
  const pathId = (seriesIndex: number): string =>
    context.scope.id(`line-path-${seriesIndex}`);
  const pointId = (categoryIndex: number, seriesIndex: number): string =>
    context.scope.id(`line-point-${categoryIndex}-${seriesIndex}`);
  const labelId = (categoryIndex: number, seriesIndex: number): string =>
    context.scope.id(`line-value-${categoryIndex}-${seriesIndex}`);
  const onsetId = (categoryIndex: number, seriesIndex: number): string =>
    context.scope.id(`line-onset-${categoryIndex}-${seriesIndex}`);

  const seriesIndexByKey = new Map(
    seriesColumns.map((column, index) => [column.key, index]),
  );
  const categoryIndexByKey = new Map(
    rows.map((row, index) => [categoryLabel(row, categoryColumn), index]),
  );

  const animation: AnimationItem[] = [];
  const stateIntervals: StateInterval[] = [];
  const valueAnimations: ValueAnimation[] = [];
  const onsets = new Map<string, LineOnset>();

  applyLineEffects({
    effects: parsed.data.effects ?? [],
    geometry,
    lookup: { seriesIndexByKey, categoryIndexByKey },
    theme: context.theme,
    pathId,
    pointId,
    labelId,
    onsetId,
    values,
    seriesColumns,
    valueLabels,
    categoryCount,
    seriesCount,
    lineIntervals: context.lineIntervals ?? [],
    spanMs: context.cueTiming?.spanMs ?? 0,
    path: context.path,
    animation,
    stateIntervals,
    valueAnimations,
    onsets,
  });

  const axisSpan = geometry.axis.max - geometry.axis.min;
  const yForTick = (tick: number): number =>
    axisSpan === 0
      ? geometry.plotBottom
      : geometry.plotBottom -
        ((tick - geometry.axis.min) / axisSpan) *
          (geometry.plotBottom - geometry.plotTop);
  const gridHtml = geometry.axis.ticks
    .map((tick) => {
      const top = roundPx(yForTick(tick));
      const zeroClass = tick === 0 ? " kakeai-linechartzero" : "";
      return `<div class="kakeai-linechartgridline${zeroClass}" style="top:${top}px;left:${geometry.plotLeft}px;width:${geometry.plotRight - geometry.plotLeft}px"></div><span class="kakeai-linecharttick" style="top:${top}px">${axisTickLabel(tick, axisFormat, axisUnit, locale)}</span>`;
    })
    .join("");
  const categoryHtml = rows
    .map((row, categoryIndex) => {
      const x = roundPx(
        categoryCount <= 1
          ? geometry.plotLeft + (geometry.plotRight - geometry.plotLeft) / 2
          : geometry.plotLeft +
            (categoryIndex / (categoryCount - 1)) *
              (geometry.plotRight - geometry.plotLeft),
      );
      return `<span class="kakeai-linechartcat" style="left:${x}px;top:${geometry.plotBottom + 12}px">${escapeHtmlText(categoryLabel(row, categoryColumn))}</span>`;
    })
    .join("");
  const valueHtml = geometry.labels
    .map(
      (label) =>
        `<span id="${labelId(label.categoryIndex, label.seriesIndex)}" class="kakeai-linechartvalue" style="left:${label.x}px;top:${label.y}px">${escapeHtmlText(label.text)}</span>`,
    )
    .join("");
  const seriesHtml = geometry.series
    .map((series, seriesIndex) =>
      renderSeries(
        context,
        series,
        seriesIndex,
        colorFor(seriesIndex),
        onsets,
        pointId,
        onsetId,
      ),
    )
    .join("");

  const titleHtml =
    title === undefined || title.trim().length === 0
      ? ""
      : `<figcaption class="kakeai-charttitle" style="${themeRoleFontStyle(context.theme, "heading", locale)}">${escapeHtmlText(title)}</figcaption>`;
  const gridClass = (style?.preset ?? "clean") === "grid" ? " kakeai-chart-grid" : "";
  const frameStyle = `--kakeai-chart-frame-max-w:${width}px`;

  return {
    html: `<figure class="kakeai-chartwrap" style="${themeRoleFontStyle(context.theme, "body", locale)}"><div class="kakeai-chartframe kakeai-linechartframe${gridClass}" style="${frameStyle}">${titleHtml}${buildLegend(seriesColumns, palette)}<div class="kakeai-linechartplot" style="width:${width}px;height:${CHART_LINE_PLOT_HEIGHT_PX}px">${gridHtml}<svg class="kakeai-linechartsvg" width="${width}" height="${CHART_LINE_PLOT_HEIGHT_PX}" viewBox="0 0 ${width} ${CHART_LINE_PLOT_HEIGHT_PX}" aria-hidden="true">${seriesHtml}</svg>${categoryHtml}${valueHtml}</div></div></figure>`,
    assetIds: [],
    animation,
    stateIntervals,
    valueAnimations,
  };
}
