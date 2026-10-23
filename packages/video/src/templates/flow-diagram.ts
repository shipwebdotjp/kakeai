import {
  flowDiagramInputSchema,
  type EmphasizeEffect,
  type FlowEdge,
  type FlowEffect,
  type FlowOrientation,
  type OnsetPreset,
  type VisualThemeDefinition,
} from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlText } from "../escape";
import type { AnimationItem, RenderedCue, RenderContext, StateInterval } from "../render-context";
import {
  onsetOverlayId,
  planAppearEffect,
  planOnsetEffect,
  resolveTriggerWindow,
  SPOTLIGHT_DIM_OFF,
  SPOTLIGHT_DIM_ON,
  type AppearTarget,
} from "../cue-effects";
import { accentForegroundHex, themeRoleFontStyle } from "../theme";
import { toneHex } from "./tone";

const FLOW_PLOT_W = 1320;
const FLOW_PLOT_H = 760;
const FLOW_GAP = 72;
const FLOW_ROUTE_OFFSET = 56;
const FLOW_ROUTE_MARGIN = 24;
const FLOW_H_NODE_H = 132;
const FLOW_V_NODE_W = 600;
const FLOW_NODE_MIN_W = 120;
const FLOW_NODE_MAX_W = 360;
const FLOW_NODE_MIN_H = 72;
const FLOW_NODE_MAX_H = 150;

interface FlowOnset {
  preset: OnsetPreset;
  color: string;
}

interface FlowLayout {
  nodeW: number;
  nodeH: number;
  xs: number[];
  ys: number[];
  centers: { x: number; y: number }[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function fitGap(available: number, count: number, minSize: number): number {
  if (count <= 1) {
    return FLOW_GAP;
  }
  const maxGapForMinSize = (available - count * minSize) / (count - 1);
  return Math.max(8, Math.min(FLOW_GAP, maxGapForMinSize));
}

function computeLayout(count: number, orientation: FlowOrientation): FlowLayout {
  if (orientation === "vertical") {
    const gap = fitGap(FLOW_PLOT_H, count, FLOW_NODE_MIN_H);
    const nodeH = clamp((FLOW_PLOT_H - gap * (count - 1)) / count, FLOW_NODE_MIN_H, FLOW_NODE_MAX_H);
    const total = count * nodeH + gap * (count - 1);
    const offsetY = (FLOW_PLOT_H - total) / 2;
    const offsetX = (FLOW_PLOT_W - FLOW_V_NODE_W) / 2;
    const ys = Array.from({ length: count }, (_value, index) => offsetY + index * (nodeH + gap));
    const xs = Array.from({ length: count }, () => offsetX);
    return {
      nodeW: FLOW_V_NODE_W,
      nodeH,
      xs,
      ys,
      centers: ys.map((y) => ({ x: FLOW_PLOT_W / 2, y: y + nodeH / 2 })),
    };
  }
  const gap = fitGap(FLOW_PLOT_W, count, FLOW_NODE_MIN_W);
  const nodeW = clamp((FLOW_PLOT_W - gap * (count - 1)) / count, FLOW_NODE_MIN_W, FLOW_NODE_MAX_W);
  const total = count * nodeW + gap * (count - 1);
  const offsetX = (FLOW_PLOT_W - total) / 2;
  const offsetY = (FLOW_PLOT_H - FLOW_H_NODE_H) / 2;
  const xs = Array.from({ length: count }, (_value, index) => offsetX + index * (nodeW + gap));
  const ys = Array.from({ length: count }, () => offsetY);
  return {
    nodeW,
    nodeH: FLOW_H_NODE_H,
    xs,
    ys,
    centers: xs.map((x) => ({ x: x + nodeW / 2, y: FLOW_PLOT_H / 2 })),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function edgePath(
  edge: FlowEdge,
  layout: FlowLayout,
  orientation: FlowOrientation,
): { d: string; labelX: number; labelY: number; anchor: "start" | "middle" | "end" } {
  const distance = Math.abs(edge.to - edge.from);
  if (orientation === "vertical") {
    const forward = edge.to > edge.from;
    if (distance === 1) {
      const sx = layout.centers[edge.from]!.x;
      const sy = forward
        ? layout.ys[edge.from]! + layout.nodeH
        : layout.ys[edge.from]!;
      const tx = layout.centers[edge.to]!.x;
      const ty = forward
        ? layout.ys[edge.to]!
        : layout.ys[edge.to]! + layout.nodeH;
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
      ? Math.min(FLOW_PLOT_W - FLOW_ROUTE_MARGIN, Math.max(sx, tx) + routeOffset)
      : Math.max(FLOW_ROUTE_MARGIN, Math.min(sx, tx) - routeOffset);
    return {
      d: `M ${round(sx)} ${round(sy)} C ${round(routeX)} ${round(sy)} ${round(routeX)} ${round(ty)} ${round(tx)} ${round(ty)}`,
      labelX: routeX - side * 20,
      labelY: (sy + ty) / 2,
      anchor: side === 1 ? "end" : "start",
    };
  }
  const forward = edge.to > edge.from;
  if (distance === 1) {
    const sx = forward ? layout.xs[edge.from]! + layout.nodeW : layout.xs[edge.from]!;
    const sy = layout.centers[edge.from]!.y;
    const tx = forward ? layout.xs[edge.to]! : layout.xs[edge.to]! + layout.nodeW;
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
    ? Math.min(FLOW_PLOT_H - FLOW_ROUTE_MARGIN, Math.max(sy, ty) + routeOffset)
    : Math.max(FLOW_ROUTE_MARGIN, Math.min(sy, ty) - routeOffset);
  return {
    d: `M ${round(sx)} ${round(sy)} C ${round(sx)} ${round(routeY)} ${round(tx)} ${round(routeY)} ${round(tx)} ${round(ty)}`,
    labelX: (sx + tx) / 2,
    labelY: routeY - side * 20,
    anchor: "middle",
  };
}

interface FlowEffectTargetRef {
  id: string;
  step: number;
}

function resolveFlowEffectTargets(
  effect: FlowEffect,
  nodeIds: readonly string[],
): FlowEffectTargetRef[] {
  if (effect.target.kind === "node") {
    const id = nodeIds[effect.target.index];
    return id === undefined ? [] : [{ id, step: 0 }];
  }
  return nodeIds.map((id, index) => ({ id, step: index }));
}

function emphasizeOnVars(
  effect: EmphasizeEffect,
  theme: VisualThemeDefinition,
): Record<string, string | number> {
  const hex = toneHex(effect.tone, theme);
  if (effect.style === "frame") {
    return { boxShadow: `inset 0 0 0 6px ${hex}` };
  }
  if (effect.style === "spotlight") {
    return { boxShadow: `inset 0 0 0 4px ${hex}` };
  }
  return { backgroundColor: hex, color: accentForegroundHex(hex, theme) };
}

function emphasizeOffVars(effect: EmphasizeEffect): Record<string, string | number> {
  if (effect.style === "frame" || effect.style === "spotlight") {
    return { boxShadow: "none" };
  }
  return { backgroundColor: "var(--kakeai-surface)", color: "inherit" };
}

export function renderFlowDiagram(input: unknown, context: RenderContext): RenderedCue {
  const parsed = flowDiagramInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path: context.path, code: "invalid_input", message: "flow.diagram の入力が不正です。" },
    ]);
  }
  const { title, diagram, style, effects } = parsed.data;
  const theme = context.theme;
  const orientation = style?.orientation ?? "horizontal";
  const preset = style?.preset ?? "clean";
  const nodeIds = diagram.nodes.map((_node, index) => context.scope.id(`node-${index}`));
  const layout = computeLayout(diagram.nodes.length, orientation);
  const markerId = context.scope.id("arrow");

  const animation: AnimationItem[] = [];
  const stateIntervals: StateInterval[] = [];
  const onsets = new Map<string, FlowOnset>();

  const spanMs = context.cueTiming?.spanMs ?? 0;
  const lineIntervals = context.lineIntervals ?? [];
  applyFlowEffects({
    effects: effects ?? [],
    nodeIds,
    theme,
    lineIntervals,
    spanMs,
    path: context.path,
    animation,
    stateIntervals,
    onsets,
  });

  const edgesHtml = diagram.edges
    .map((edge) => {
      const { d, labelX, labelY, anchor } = edgePath(edge, layout, orientation);
      const label =
        edge.label === undefined || edge.label.trim().length === 0
          ? ""
          : `<text class="kakeai-flowedgelabel" x="${round(labelX)}" y="${round(labelY)}" style="text-anchor:${anchor}">${escapeHtmlText(edge.label)}</text>`;
      return `<path class="kakeai-flowered" d="${d}" marker-end="url(#${markerId})"></path>${label}`;
    })
    .join("");

  const nodesHtml = diagram.nodes
    .map((node, index) => {
      const onset = onsets.get(nodeIds[index]!);
      const overlay =
        onset === undefined
          ? ""
          : `<span id="${onsetOverlayId(nodeIds[index]!)}" class="kakeai-onsetoverlay kakeai-onset-${onset.preset}" style="--kakeai-onset-color:${onset.color}"></span>`;
      const caption =
        node.caption === undefined || node.caption.trim().length === 0
          ? ""
          : `<span class="kakeai-flownode-caption">${escapeHtmlText(node.caption)}</span>`;
      return `<div id="${nodeIds[index]}" class="kakeai-flownode" style="left:${round(layout.xs[index]!)}px;top:${round(layout.ys[index]!)}px;width:${round(layout.nodeW)}px;height:${round(layout.nodeH)}px"><span class="kakeai-flownode-label">${escapeHtmlText(node.label)}</span>${caption}${overlay}</div>`;
    })
    .join("");

  const titleHtml =
    title === undefined || title.trim().length === 0
      ? ""
      : `<figcaption class="kakeai-flowtitle" style="${themeRoleFontStyle(theme, "heading")}">${escapeHtmlText(title)}</figcaption>`;
  const presetClass = preset === "boxed" ? " kakeai-flow-boxed" : "";
  const plot = `<div class="kakeai-flowplot kakeai-flow-${orientation}${presetClass}" style="width:${FLOW_PLOT_W}px;height:${FLOW_PLOT_H}px"><svg class="kakeai-flowsvg" width="${FLOW_PLOT_W}" height="${FLOW_PLOT_H}" viewBox="0 0 ${FLOW_PLOT_W} ${FLOW_PLOT_H}"><defs><marker id="${markerId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--kakeai-muted)"></path></marker></defs>${edgesHtml}</svg>${nodesHtml}</div>`;

  return {
    html: `<figure class="kakeai-flowwrap" style="${themeRoleFontStyle(theme, "body")}">${titleHtml}${plot}</figure>`,
    assetIds: [],
    animation,
    stateIntervals,
  };
}

function applyFlowEffects(options: {
  effects: readonly FlowEffect[];
  nodeIds: readonly string[];
  theme: VisualThemeDefinition;
  lineIntervals: RenderContext["lineIntervals"];
  spanMs: number;
  path: (string | number)[];
  animation: AnimationItem[];
  stateIntervals: StateInterval[];
  onsets: Map<string, FlowOnset>;
}): void {
  const lineIntervals = options.lineIntervals ?? [];
  options.effects.forEach((entry, effectIndex) => {
    const path = [...options.path, "effects", effectIndex];
    const targets = resolveFlowEffectTargets(entry, options.nodeIds);
    if (targets.length === 0) {
      return;
    }
    if (entry.effect.kind === "appear") {
      const appearTargets: AppearTarget[] = targets.map(({ id, step }) => ({ id, step }));
      const plan = planAppearEffect({
        targets: appearTargets,
        trigger: entry.trigger,
        effect: entry.effect,
        lineIntervals,
        spanMs: options.spanMs,
        path,
      });
      options.animation.push(...plan.animation);
      options.stateIntervals.push(...plan.stateIntervals);
      return;
    }
    const window = resolveTriggerWindow(entry.trigger, lineIntervals, options.spanMs, path);
    if (window === null) {
      return;
    }
    const interval = [{ startMs: window.startMs, endMs: window.endMs }];
    const targetIds = new Set(targets.map((target) => target.id));
    for (const target of targets) {
      options.stateIntervals.push({
        targetId: target.id,
        intervals: interval,
        on: emphasizeOnVars(entry.effect, options.theme),
        off: emphasizeOffVars(entry.effect),
      });
    }
    if (entry.effect.style === "spotlight") {
      for (const siblingId of options.nodeIds) {
        if (targetIds.has(siblingId)) {
          continue;
        }
        options.stateIntervals.push({
          targetId: siblingId,
          intervals: interval,
          on: SPOTLIGHT_DIM_ON,
          off: SPOTLIGHT_DIM_OFF,
        });
      }
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
  });
}
