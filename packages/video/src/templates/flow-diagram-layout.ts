import {
  flowCycleNodeWidth,
  flowHorizontalGap,
  flowNodeWidth,
  FLOW_CYCLE_NODE_HEIGHT_PX,
  FLOW_VERTICAL_GAP_PX,
  type FlowEdge,
  type FlowEdgeKind,
  type FlowLayout as FlowLayoutKind,
  type FlowOrientation,
} from "@kakeai/contracts";

const FLOW_ROUTE_OFFSET = 56;
const FLOW_ROUTE_MARGIN = 24;
const FLOW_H_NODE_H = 132;
const FLOW_NODE_MIN_H = 72;
const FLOW_NODE_MAX_H = 150;
const FLOW_LOOP_HEIGHT = 56;
/** Outer room reserved for cycle self-loops and their labels. */
const FLOW_CYCLE_LOOP_ROOM = 84;
const FLOW_AUX_LANE_GAP = 22;

export interface FlowLayout {
  nodeW: number;
  nodeH: number;
  xs: number[];
  ys: number[];
  centers: { x: number; y: number }[];
}

export interface FlowCycleLayout extends FlowLayout {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  angles: number[];
}

export interface PlotSize {
  width: number;
  height: number;
}

type EdgeAnchor = "start" | "middle" | "end";

export interface EdgePath {
  d: string;
  labelX: number;
  labelY: number;
  anchor: EdgeAnchor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const FLOW_VERTICAL_GAP = FLOW_VERTICAL_GAP_PX;

function fitGap(available: number, count: number, minSize: number): number {
  if (count <= 1) {
    return FLOW_VERTICAL_GAP;
  }
  const maxGapForMinSize = (available - count * minSize) / (count - 1);
  return Math.max(8, Math.min(FLOW_VERTICAL_GAP, maxGapForMinSize));
}

/** Linear layout: the node array order is the main process order. */
export function computeLayout(
  count: number,
  orientation: FlowOrientation,
  size: PlotSize,
): FlowLayout {
  if (orientation === "vertical") {
    const gap = fitGap(size.height, count, FLOW_NODE_MIN_H);
    const nodeH = clamp(
      (size.height - gap * (count - 1)) / count,
      FLOW_NODE_MIN_H,
      FLOW_NODE_MAX_H,
    );
    const total = count * nodeH + gap * (count - 1);
    const offsetY = (size.height - total) / 2;
    const nodeW = flowNodeWidth(count, "vertical", size.width);
    const offsetX = (size.width - nodeW) / 2;
    const ys = Array.from(
      { length: count },
      (_value, index) => offsetY + index * (nodeH + gap),
    );
    const xs = Array.from({ length: count }, () => offsetX);
    return {
      nodeW,
      nodeH,
      xs,
      ys,
      centers: ys.map((y) => ({ x: size.width / 2, y: y + nodeH / 2 })),
    };
  }
  const gap = flowHorizontalGap(size.width, count);
  const nodeW = flowNodeWidth(count, "horizontal", size.width);
  const total = count * nodeW + gap * (count - 1);
  const offsetX = (size.width - total) / 2;
  const offsetY = (size.height - FLOW_H_NODE_H) / 2;
  const xs = Array.from(
    { length: count },
    (_value, index) => offsetX + index * (nodeW + gap),
  );
  const ys = Array.from({ length: count }, () => offsetY);
  return {
    nodeW,
    nodeH: FLOW_H_NODE_H,
    xs,
    ys,
    centers: xs.map((x) => ({ x: x + nodeW / 2, y: size.height / 2 })),
  };
}

/**
 * Node 0 sits at the top centre; the rest follow the array order clockwise on
 * an ellipse. The ring leaves room on the outside for each node's self-loop.
 */
export function computeCycleLayout(count: number, size: PlotSize): FlowCycleLayout {
  const nodeW = flowCycleNodeWidth(count, size.width);
  const nodeH = FLOW_CYCLE_NODE_HEIGHT_PX;
  const cx = size.width / 2;
  const cy = size.height / 2;
  const rx = Math.max(1, size.width / 2 - nodeW / 2 - FLOW_CYCLE_LOOP_ROOM);
  const ry = Math.max(1, size.height / 2 - nodeH / 2 - FLOW_CYCLE_LOOP_ROOM);
  const angles = Array.from(
    { length: count },
    (_value, index) => -Math.PI / 2 + (2 * Math.PI * index) / count,
  );
  const centers = angles.map((angle) => ({
    x: cx + rx * Math.cos(angle),
    y: cy + ry * Math.sin(angle),
  }));
  return {
    nodeW,
    nodeH,
    xs: centers.map((center) => center.x - nodeW / 2),
    ys: centers.map((center) => center.y - nodeH / 2),
    centers,
    cx,
    cy,
    rx,
    ry,
    angles,
  };
}

export function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function straightOrOutsidePath(
  edge: FlowEdge,
  layout: FlowLayout,
  orientation: FlowOrientation,
  size: PlotSize,
): EdgePath {
  const distance = Math.abs(edge.to - edge.from);
  if (orientation === "vertical") {
    const forward = edge.to > edge.from;
    if (distance === 1 && forward) {
      const sx = layout.centers[edge.from]!.x;
      const sy = layout.ys[edge.from]! + layout.nodeH;
      const tx = layout.centers[edge.to]!.x;
      const ty = layout.ys[edge.to]!;
      return {
        d: `M ${round(sx)} ${round(sy)} L ${round(tx)} ${round(ty)}`,
        labelX: sx + 16,
        labelY: (sy + ty) / 2,
        anchor: "start",
      };
    }
    const side = forward ? 1 : -1;
    const sx = layout.xs[edge.from]! + (forward ? layout.nodeW : 0);
    const sy = layout.centers[edge.from]!.y;
    const tx = layout.xs[edge.to]! + (forward ? layout.nodeW : 0);
    const ty = layout.centers[edge.to]!.y;
    const routeOffset = FLOW_ROUTE_OFFSET * Math.max(1, distance - 1);
    const routeX = forward
      ? Math.min(size.width - FLOW_ROUTE_MARGIN, Math.max(sx, tx) + routeOffset)
      : Math.max(FLOW_ROUTE_MARGIN, Math.min(sx, tx) - routeOffset);
    return {
      d: `M ${round(sx)} ${round(sy)} C ${round(routeX)} ${round(sy)} ${round(routeX)} ${round(ty)} ${round(tx)} ${round(ty)}`,
      labelX: routeX - side * 20,
      labelY: (sy + ty) / 2,
      anchor: side === 1 ? "end" : "start",
    };
  }
  const forward = edge.to > edge.from;
  if (distance === 1 && forward) {
    const sx = layout.xs[edge.from]! + layout.nodeW;
    const sy = layout.centers[edge.from]!.y;
    const tx = layout.xs[edge.to]!;
    const ty = layout.centers[edge.to]!.y;
    return {
      d: `M ${round(sx)} ${round(sy)} L ${round(tx)} ${round(ty)}`,
      labelX: (sx + tx) / 2,
      labelY: sy - 20,
      anchor: "middle",
    };
  }
  const side = forward ? 1 : -1;
  const sx = layout.centers[edge.from]!.x;
  const sy = layout.ys[edge.from]! + (forward ? layout.nodeH : 0);
  const tx = layout.centers[edge.to]!.x;
  const ty = layout.ys[edge.to]! + (forward ? layout.nodeH : 0);
  const routeOffset = FLOW_ROUTE_OFFSET * Math.max(1, distance - 1);
  const routeY = forward
    ? Math.min(size.height - FLOW_ROUTE_MARGIN, Math.max(sy, ty) + routeOffset)
    : Math.max(FLOW_ROUTE_MARGIN, Math.min(sy, ty) - routeOffset);
  return {
    d: `M ${round(sx)} ${round(sy)} C ${round(sx)} ${round(routeY)} ${round(tx)} ${round(routeY)} ${round(tx)} ${round(ty)}`,
    labelX: (sx + tx) / 2,
    labelY: routeY - side * 20,
    anchor: "middle",
  };
}

/** Linear self-loop: above the node in horizontal, to the left in vertical. */
function linearSelfLoopPath(
  edge: FlowEdge,
  layout: FlowLayout,
  orientation: FlowOrientation,
  size: PlotSize,
): EdgePath {
  const center = layout.centers[edge.from]!;
  const spread = Math.min(layout.nodeW * 0.2, 26);
  if (orientation === "vertical") {
    const x = layout.xs[edge.from]!;
    const startY = center.y - spread;
    const endY = center.y + spread;
    const controlX = Math.max(FLOW_ROUTE_MARGIN, x - FLOW_LOOP_HEIGHT);
    return {
      d: `M ${round(x)} ${round(startY)} C ${round(controlX)} ${round(startY)} ${round(controlX)} ${round(endY)} ${round(x)} ${round(endY)}`,
      labelX: controlX - 12,
      labelY: center.y,
      anchor: "end",
    };
  }
  const top = layout.ys[edge.from]!;
  const startX = clamp(center.x - spread, 0, size.width);
  const endX = clamp(center.x + spread, 0, size.width);
  const controlY = Math.max(FLOW_ROUTE_MARGIN, top - FLOW_LOOP_HEIGHT);
  return {
    d: `M ${round(startX)} ${round(top)} C ${round(startX)} ${round(controlY)} ${round(endX)} ${round(controlY)} ${round(endX)} ${round(top)}`,
    labelX: center.x,
    labelY: Math.max(12, controlY - 10),
    anchor: "middle",
  };
}

function ellipsePoint(
  layout: FlowCycleLayout,
  angle: number,
  rxScale = 1,
  ryScale = 1,
): { x: number; y: number } {
  return {
    x: layout.cx + layout.rx * rxScale * Math.cos(angle),
    y: layout.cy + layout.ry * ryScale * Math.sin(angle),
  };
}

/** Orbit edge: the short clockwise arc inside the ring, label on the inner side. */
function cycleOrbitPath(edge: FlowEdge, layout: FlowCycleLayout): EdgePath {
  const a0 = layout.angles[edge.from]!;
  let a1 = layout.angles[edge.to]!;
  if (a1 <= a0) {
    a1 += Math.PI * 2;
  }
  const delta = a1 - a0;
  const pad = Math.min(
    delta / 3,
    Math.max(
      Math.asin(clamp((layout.nodeW / 2 + 8) / layout.rx, 0, 1)),
      Math.asin(clamp((layout.nodeH / 2 + 8) / layout.ry, 0, 1)),
    ),
  );
  const start = ellipsePoint(layout, a0 + pad);
  const end = ellipsePoint(layout, a1 - pad);
  const labelInsetX = Math.max(0, layout.rx - 32) / layout.rx;
  const labelInsetY = Math.max(0, layout.ry - 32) / layout.ry;
  const label = ellipsePoint(layout, (a0 + a1) / 2, labelInsetX, labelInsetY);
  return {
    d: `M ${round(start.x)} ${round(start.y)} A ${round(layout.rx)} ${round(layout.ry)} 0 0 1 ${round(end.x)} ${round(end.y)}`,
    labelX: label.x,
    labelY: label.y,
    anchor: "middle",
  };
}

function boundaryDistance(
  ux: number,
  uy: number,
  width: number,
  height: number,
): number {
  const tx = ux === 0 ? Infinity : width / 2 / Math.abs(ux);
  const ty = uy === 0 ? Infinity : height / 2 / Math.abs(uy);
  return Math.min(tx, ty);
}

function rectBoundaryPoint(
  from: { x: number; y: number },
  to: { x: number; y: number },
  width: number,
  height: number,
): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return from;
  }
  const ux = dx / length;
  const uy = dy / length;
  const distance = boundaryDistance(ux, uy, width, height);
  return { x: from.x + ux * distance, y: from.y + uy * distance };
}

/** Auxiliary edge: a chord bowing toward the centre, with a per-edge lane. */
function cycleAuxiliaryPath(
  edge: FlowEdge,
  layout: FlowCycleLayout,
  lane: number,
): EdgePath {
  const fromCenter = layout.centers[edge.from]!;
  const toCenter = layout.centers[edge.to]!;
  const start = rectBoundaryPoint(fromCenter, toCenter, layout.nodeW, layout.nodeH);
  const end = rectBoundaryPoint(toCenter, fromCenter, layout.nodeW, layout.nodeH);
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const pull = 0.4;
  let controlX = midX + (layout.cx - midX) * pull;
  let controlY = midY + (layout.cy - midY) * pull;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length > 0 && lane !== 0) {
    controlX += (-dy / length) * lane * FLOW_AUX_LANE_GAP;
    controlY += (dx / length) * lane * FLOW_AUX_LANE_GAP;
  }
  return {
    d: `M ${round(start.x)} ${round(start.y)} Q ${round(controlX)} ${round(controlY)} ${round(end.x)} ${round(end.y)}`,
    labelX: 0.25 * start.x + 0.5 * controlX + 0.25 * end.x,
    labelY: 0.25 * start.y + 0.5 * controlY + 0.25 * end.y,
    anchor: "middle",
  };
}

/** Cycle self-loop: a small loop pointing radially outward from the ring. */
function cycleSelfLoopPath(edge: FlowEdge, layout: FlowCycleLayout): EdgePath {
  const center = layout.centers[edge.from]!;
  const dx = center.x - layout.cx;
  const dy = center.y - layout.cy;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const tx = -uy;
  const ty = ux;
  const distance = boundaryDistance(ux, uy, layout.nodeW, layout.nodeH);
  const spread = Math.min(layout.nodeW * 0.2, 26);
  const start = {
    x: center.x + ux * distance + tx * spread,
    y: center.y + uy * distance + ty * spread,
  };
  const end = {
    x: center.x + ux * distance - tx * spread,
    y: center.y + uy * distance - ty * spread,
  };
  const c1 = {
    x: start.x + ux * FLOW_LOOP_HEIGHT,
    y: start.y + uy * FLOW_LOOP_HEIGHT,
  };
  const c2 = {
    x: end.x + ux * FLOW_LOOP_HEIGHT,
    y: end.y + uy * FLOW_LOOP_HEIGHT,
  };
  const label = {
    x: center.x + ux * (distance + FLOW_LOOP_HEIGHT * 0.9),
    y: center.y + uy * (distance + FLOW_LOOP_HEIGHT * 0.9),
  };
  const anchor: EdgeAnchor = ux > 0.4 ? "end" : ux < -0.4 ? "start" : "middle";
  return {
    d: `M ${round(start.x)} ${round(start.y)} C ${round(c1.x)} ${round(c1.y)} ${round(c2.x)} ${round(c2.y)} ${round(end.x)} ${round(end.y)}`,
    labelX: label.x,
    labelY: label.y,
    anchor,
  };
}

export function edgePath(
  edge: FlowEdge,
  kind: FlowEdgeKind,
  layoutKind: FlowLayoutKind,
  linear: FlowLayout,
  cycle: FlowCycleLayout | null,
  orientation: FlowOrientation,
  size: PlotSize,
  lane: number,
): EdgePath {
  if (layoutKind === "cycle") {
    if (cycle === null) {
      return straightOrOutsidePath(edge, linear, orientation, size);
    }
    if (kind === "loop") {
      return cycleSelfLoopPath(edge, cycle);
    }
    if (kind === "orbit") {
      return cycleOrbitPath(edge, cycle);
    }
    return cycleAuxiliaryPath(edge, cycle, lane);
  }
  if (kind === "loop") {
    return linearSelfLoopPath(edge, linear, orientation, size);
  }
  return straightOrOutsidePath(edge, linear, orientation, size);
}
