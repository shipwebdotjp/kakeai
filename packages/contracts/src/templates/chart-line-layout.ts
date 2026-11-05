export const CHART_LINE_MIN_CATEGORIES = 2;
export const CHART_LINE_MAX_CATEGORIES = 8;
export const CHART_LINE_MAX_SERIES = 4;
export const CHART_LINE_MAX_COLUMNS = CHART_LINE_MAX_SERIES + 1;
export const CHART_LINE_TARGET_TICKS = 5;
export const CHART_LINE_PLOT_HEIGHT_PX = 560;
export const CHART_LINE_LEFT_GUTTER_PX = 150;
export const CHART_LINE_RIGHT_GUTTER_PX = 56;
export const CHART_LINE_TOP_PADDING_PX = 56;
export const CHART_LINE_BOTTOM_GUTTER_PX = 64;
export const CHART_LINE_LABEL_HEIGHT_PX = 30;
const LABEL_OFFSET_PX = 20;
const LABEL_SERIES_STAGGER_PX = 32;
const WIDE_CHAR_PATTERN = /[\u3000-\u9fff\uff00-\uffef]/;
const WIDE_CHAR_WIDTH_PX = 24;
const NARROW_CHAR_WIDTH_PX = 13.2;

export interface ChartLineAxis {
  min: number;
  max: number;
  step: number;
  ticks: number[];
}

export interface ChartLinePoint {
  categoryIndex: number;
  seriesIndex: number;
  value: number;
  x: number;
  y: number;
}

export interface ChartLineSeriesGeometry {
  key: string;
  points: ChartLinePoint[];
  /** SVG path made only of straight segments. */
  path: string;
  /** Sum of the emitted segment lengths. */
  length: number;
  /** Fraction of the path length at each point (the first point is 0). */
  fractions: number[];
}

export interface ChartLineLabelGeometry {
  categoryIndex: number;
  seriesIndex: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ChartLineGeometry {
  width: number;
  height: number;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  axis: ChartLineAxis;
  series: ChartLineSeriesGeometry[];
  labels: ChartLineLabelGeometry[];
  labelOverlap: boolean;
}

export interface ChartLineGeometryOptions {
  values: readonly (readonly number[])[];
  seriesKeys: readonly string[];
  width: number;
  height?: number;
  /** Formatted labels, indexed by category and then by series. */
  labelTexts?: readonly (readonly string[])[];
}

export function parseChartLineNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundNumber(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

function roundPx(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Deterministic "nice ticks" for a fitted value axis. The same values always
 * produce the same range, step, and tick list.
 */
export function computeChartLineAxis(values: readonly number[]): ChartLineAxis {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) {
    return { min: 0, max: 1, step: 0.2, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1] };
  }
  let rawMin = Math.min(...finite);
  let rawMax = Math.max(...finite);
  let span = rawMax - rawMin;
  if (span === 0) {
    span = Math.max(Math.abs(rawMin) * 0.1, 1);
    rawMin -= span / 2;
    rawMax += span / 2;
  }
  const padding = span * 0.1;
  const low = rawMin - padding;
  const high = rawMax + padding;
  const rough = (high - low) / CHART_LINE_TARGET_TICKS;
  if (!Number.isFinite(rough) || rough <= 0) {
    return { min: 0, max: 1, step: 0.2, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1] };
  }
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / magnitude;
  let stepBase = 10;
  if (normalized <= 1) {
    stepBase = 1;
  } else if (normalized <= 2) {
    stepBase = 2;
  } else if (normalized <= 5) {
    stepBase = 5;
  }
  const step = roundNumber(stepBase * magnitude);
  const min = roundNumber(Math.floor(low / step) * step);
  const max = roundNumber(Math.ceil(high / step) * step);
  const count = Math.max(1, Math.round((max - min) / step));
  const ticks = Array.from({ length: count + 1 }, (_, index) =>
    roundNumber(min + index * step),
  );
  return { min, max, step, ticks };
}

export function chartLineLabelWidthPx(text: string): number {
  let width = 0;
  for (const char of text) {
    width += WIDE_CHAR_PATTERN.test(char) ? WIDE_CHAR_WIDTH_PX : NARROW_CHAR_WIDTH_PX;
  }
  return Math.ceil(width);
}

function labelRectOverlaps(
  a: ChartLineLabelGeometry,
  b: ChartLineLabelGeometry,
): boolean {
  const halfWidthA = a.width / 2;
  const halfWidthB = b.width / 2;
  const halfHeight = a.height / 2;
  return (
    Math.abs(a.x - b.x) < halfWidthA + halfWidthB &&
    Math.abs(a.y - b.y) < halfHeight * 2
  );
}

/**
 * Shared chart.line layout. The renderer draws these coordinates and the
 * warning pass uses the same boxes to detect value-label overlap.
 */
export function computeChartLineGeometry(
  options: ChartLineGeometryOptions,
): ChartLineGeometry {
  const height = options.height ?? CHART_LINE_PLOT_HEIGHT_PX;
  const plotLeft = CHART_LINE_LEFT_GUTTER_PX;
  const plotRight = Math.max(plotLeft + 1, options.width - CHART_LINE_RIGHT_GUTTER_PX);
  const plotTop = CHART_LINE_TOP_PADDING_PX;
  const plotBottom = height - CHART_LINE_BOTTOM_GUTTER_PX;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;
  const flatValues = options.values.flat();
  const axis = computeChartLineAxis(flatValues);
  const axisSpan = axis.max - axis.min;
  const categoryCount = options.values.length;
  const xFor = (categoryIndex: number): number =>
    categoryCount <= 1
      ? plotLeft + plotWidth / 2
      : plotLeft + (categoryIndex / (categoryCount - 1)) * plotWidth;
  const yFor = (value: number): number =>
    axisSpan === 0
      ? plotBottom
      : plotBottom - ((value - axis.min) / axisSpan) * plotHeight;

  const series: ChartLineSeriesGeometry[] = options.seriesKeys.map(
    (key, seriesIndex) => {
      const points: ChartLinePoint[] = options.values.map(
        (row, categoryIndex) => {
          const value = row[seriesIndex];
          if (value === undefined) {
            throw new Error(`Missing chart.line value for series ${seriesIndex}`);
          }
          return {
            categoryIndex,
            seriesIndex,
            value,
            x: roundPx(xFor(categoryIndex)),
            y: roundPx(yFor(value)),
          };
        },
      );
      const segmentLengths: number[] = [];
      for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1]!;
        const current = points[index]!;
        segmentLengths.push(
          Math.hypot(current.x - previous.x, current.y - previous.y),
        );
      }
      const length = segmentLengths.reduce((total, value) => total + value, 0);
      let travelled = 0;
      const fractions = points.map((_point, index) => {
        if (index === 0 || length === 0) {
          return 0;
        }
        travelled += segmentLengths[index - 1] ?? 0;
        return travelled / length;
      });
      return {
        key,
        points,
        path: points
          .map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`)
          .join(" "),
        length: roundPx(length),
        fractions,
      };
    },
  );

  const labels: ChartLineLabelGeometry[] = [];
  if (options.labelTexts !== undefined) {
    options.labelTexts.forEach((row, categoryIndex) => {
      row.forEach((text, seriesIndex) => {
        const point = series[seriesIndex]?.points[categoryIndex];
        if (point === undefined || text.length === 0) {
          return;
        }
        const width = Math.min(chartLineLabelWidthPx(text), plotWidth);
        const halfWidth = width / 2;
        const halfHeight = CHART_LINE_LABEL_HEIGHT_PX / 2;
        const y = Math.min(
          plotBottom - halfHeight,
          Math.max(
            plotTop + halfHeight,
            point.y - LABEL_OFFSET_PX - seriesIndex * LABEL_SERIES_STAGGER_PX,
          ),
        );
        const x = Math.min(
          plotRight - halfWidth,
          Math.max(plotLeft + halfWidth, point.x),
        );
        labels.push({
          categoryIndex,
          seriesIndex,
          text,
          x: roundPx(x),
          y: roundPx(y),
          width,
          height: CHART_LINE_LABEL_HEIGHT_PX,
        });
      });
    });
  }
  let labelOverlap = false;
  for (let index = 0; index < labels.length && !labelOverlap; index += 1) {
    for (let other = index + 1; other < labels.length; other += 1) {
      if (labelRectOverlaps(labels[index]!, labels[other]!)) {
        labelOverlap = true;
        break;
      }
    }
  }

  return {
    width: options.width,
    height,
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
    axis,
    series,
    labels,
    labelOverlap,
  };
}
