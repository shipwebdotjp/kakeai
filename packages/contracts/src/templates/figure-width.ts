import { z } from "zod";

/** Occupied-width preset shared by `table.simple@1` and `chart.bar@1`. */
export const figureWidthSchema = z.enum(["wide", "medium", "narrow"]);
export type FigureWidth = z.infer<typeof figureWidthSchema>;

export const FIGURE_WIDTH_SCALE: Record<FigureWidth, number> = {
  wide: 1,
  medium: 0.75,
  narrow: 0.6,
};

export const FIGURE_WIDTH_OPTIONS = [
  { value: "wide", label: "広い" },
  { value: "medium", label: "標準" },
  { value: "narrow", label: "狭い" },
] as const;

export const TABLE_FRAME_MAX_WIDTH_PX = 1500;
export const CHART_PLOT_MAX_WIDTH_PX = 1280;

/** Relative occupied width for the preset; omitted means `wide`. */
export function figureWidthScale(width: FigureWidth | undefined): number {
  return width === undefined ? 1 : FIGURE_WIDTH_SCALE[width];
}
