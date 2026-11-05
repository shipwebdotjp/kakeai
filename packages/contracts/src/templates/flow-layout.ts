import { z } from "zod";
import { textWidthUnits } from "../text-width";

export const FLOW_CYCLE_MIN_NODES = 3;

export const flowLayoutSchema = z.enum(["linear", "cycle"]);
export type FlowLayout = z.infer<typeof flowLayoutSchema>;

export type FlowEdgeKind = "forward" | "backward" | "loop" | "orbit" | "auxiliary";

export interface FlowEdgeEndpoints {
  from: number;
  to: number;
}

/**
 * Edge meaning is derived from the stored indexes, the layout, and the node
 * count. A linear edge keeps its old forward/backward reading; a cycle edge is
 * either a self-loop, the next step of the clockwise ring, or an auxiliary
 * chord. Renderer and editor both call this so they cannot disagree.
 */
export function classifyFlowEdge(
  edge: FlowEdgeEndpoints,
  layout: FlowLayout,
  nodeCount: number,
): FlowEdgeKind {
  if (edge.from === edge.to) {
    return "loop";
  }
  if (layout === "cycle") {
    if (nodeCount > 0 && edge.to === (edge.from + 1) % nodeCount) {
      return "orbit";
    }
    return "auxiliary";
  }
  return edge.to > edge.from ? "forward" : "backward";
}

/**
 * Geometry and label-fit rules shared by the `flow.diagram@1` renderer and
 * `computeContentWarnings`. Keeping one implementation prevents a warning from
 * disagreeing with the rendered node width or font size.
 */

export const FLOW_LABEL_BASE_FONT_PX = 30;
export const FLOW_LABEL_MIN_FONT_PX = 18;
/** Horizontal padding inside a node (`padding: 8px 16px`). */
export const FLOW_NODE_PADDING_X_PX = 16;
export const FLOW_PLOT_MAX_WIDTH_PX = 1320;
export const FLOW_HORIZONTAL_GAP_PX = 72;
export const FLOW_VERTICAL_GAP_PX = 72;
export const FLOW_HORIZONTAL_NODE_MIN_WIDTH_PX = 120;
export const FLOW_HORIZONTAL_NODE_MAX_WIDTH_PX = 360;
export const FLOW_VERTICAL_NODE_WIDTH_PX = 600;
export const FLOW_CYCLE_NODE_MIN_WIDTH_PX = 120;
export const FLOW_CYCLE_NODE_MAX_WIDTH_PX = 260;
export const FLOW_CYCLE_NODE_HEIGHT_PX = 112;

export type FlowOrientationLike = "horizontal" | "vertical";

export interface FlowLabelFit {
  /** Rendered font size in px, with the profile type scale applied. */
  fontSizePx: number;
  /** True when the label had to be drawn smaller than the base size. */
  reduced: boolean;
  /** True when even the minimum size cannot keep the label on one line. */
  overflow: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Gap between horizontal nodes for the plot width and node count. */
export function flowHorizontalGap(plotWidth: number, count: number): number {
  if (count <= 1) {
    return FLOW_HORIZONTAL_GAP_PX;
  }
  const maxGapForMinWidth =
    (plotWidth - count * FLOW_HORIZONTAL_NODE_MIN_WIDTH_PX) / (count - 1);
  return Math.max(8, Math.min(FLOW_HORIZONTAL_GAP_PX, maxGapForMinWidth));
}

/** Node width for the plot width, orientation, and node count. */
export function flowNodeWidth(
  count: number,
  orientation: FlowOrientationLike,
  plotWidth: number,
): number {
  if (orientation === "vertical") {
    return Math.min(FLOW_VERTICAL_NODE_WIDTH_PX, plotWidth);
  }
  const gap = flowHorizontalGap(plotWidth, count);
  return clamp(
    (plotWidth - gap * (count - 1)) / count,
    FLOW_HORIZONTAL_NODE_MIN_WIDTH_PX,
    FLOW_HORIZONTAL_NODE_MAX_WIDTH_PX,
  );
}

/**
 * Node width for the cycle layout. The ring needs wider boxes than a dense
 * linear row, but the width still shrinks as the node count grows so every
 * box stays inside the plot. The warning calculation uses this same value.
 */
export function flowCycleNodeWidth(count: number, plotWidth: number): number {
  return clamp(
    plotWidth / Math.max(1, count + 2),
    FLOW_CYCLE_NODE_MIN_WIDTH_PX,
    FLOW_CYCLE_NODE_MAX_WIDTH_PX,
  );
}

/**
 * Choose the label font size so it fits the node's inner width on one line.
 * Full-width text is estimated as one em per character and half-width text as
 * half an em, matching the shared text-width units. When the minimum size does
 * not fit, the caller keeps normal wrapping and reports `overflow`.
 */
export function fitFlowNodeLabel(
  label: string,
  nodeWidthPx: number,
  typeScale = 1,
): FlowLabelFit {
  const units = textWidthUnits(label);
  const baseFontPx = FLOW_LABEL_BASE_FONT_PX * typeScale;
  const minFontPx = FLOW_LABEL_MIN_FONT_PX * typeScale;
  if (units === 0) {
    return { fontSizePx: baseFontPx, reduced: false, overflow: false };
  }
  const available = Math.max(0, nodeWidthPx - FLOW_NODE_PADDING_X_PX * 2);
  const requiredFontPx = (available * 2) / units;
  if (requiredFontPx >= baseFontPx) {
    return { fontSizePx: baseFontPx, reduced: false, overflow: false };
  }
  if (requiredFontPx >= minFontPx) {
    return {
      fontSizePx: Math.floor(requiredFontPx * 100) / 100,
      reduced: true,
      overflow: false,
    };
  }
  return { fontSizePx: minFontPx, reduced: true, overflow: true };
}
