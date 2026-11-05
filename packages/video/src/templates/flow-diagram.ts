import {
  classifyFlowEdge,
  fitFlowNodeLabel,
  FLOW_PLOT_MAX_WIDTH_PX,
  flowDiagramInputSchema,
  type EmphasizeEffect,
  type FlowEffect,
  type FlowLayout as FlowLayoutKind,
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
import {
  computeCycleLayout,
  computeLayout,
  edgePath,
  round,
  type FlowLayout,
  type PlotSize,
} from "./flow-diagram-layout";

const FLOW_PLOT_H = 760;
/** Portrait has more vertical room; the vertical layout grows to use it. */
const FLOW_PLOT_H_PORTRAIT = 1200;

function resolvePlotHeight(
  isCycle: boolean,
  portrait: boolean,
  vertical: boolean,
): number {
  return portrait && (isCycle || vertical) ? FLOW_PLOT_H_PORTRAIT : FLOW_PLOT_H;
}

interface FlowOnset {
  preset: OnsetPreset;
  color: string;
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
  const layoutKind: FlowLayoutKind = style?.layout ?? "linear";
  const isCycle = layoutKind === "cycle";
  // `style.orientation` has a schema default, so it cannot tell an explicit
  // choice from the default. Read the raw input to keep an explicit value and
  // fall back to top-to-bottom only for portrait without one.
  const rawOrientation =
    typeof input === "object" && input !== null && "style" in input
      ? (input as { style?: { orientation?: unknown } }).style?.orientation
      : undefined;
  const orientation =
    rawOrientation === undefined
      ? context.canvas.profile === "portrait"
        ? "vertical"
        : "horizontal"
      : parsed.data.style?.orientation ?? "horizontal";
  const preset = style?.preset ?? "clean";
  const nodeIds = diagram.nodes.map((_node, index) => context.scope.id(`node-${index}`));
  const plotSize: PlotSize = {
    width: Math.min(FLOW_PLOT_MAX_WIDTH_PX, context.canvas.contentWidth),
    height: resolvePlotHeight(
      isCycle,
      context.canvas.profile === "portrait",
      orientation === "vertical",
    ),
  };
  const linearLayout = computeLayout(diagram.nodes.length, orientation, plotSize);
  const cycleLayout = isCycle ? computeCycleLayout(diagram.nodes.length, plotSize) : null;
  const layout: FlowLayout = cycleLayout ?? linearLayout;
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

  const nodeCount = diagram.nodes.length;
  const auxiliaryTotal = diagram.edges.filter(
    (edge) => classifyFlowEdge(edge, layoutKind, nodeCount) === "auxiliary",
  ).length;
  let auxiliaryIndex = 0;
  const edgesHtml = diagram.edges
    .map((edge) => {
      const kind = classifyFlowEdge(edge, layoutKind, nodeCount);
      const lane =
        kind === "auxiliary"
          ? auxiliaryIndex++ - (auxiliaryTotal - 1) / 2
          : 0;
      const { d, labelX, labelY, anchor } = edgePath(
        edge,
        kind,
        layoutKind,
        linearLayout,
        cycleLayout,
        orientation,
        plotSize,
        lane,
      );
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
      const labelFit = fitFlowNodeLabel(
        node.label,
        layout.nodeW,
        context.canvas.typeScale,
      );
      const labelStyleParts: string[] = [];
      if (labelFit.reduced || labelFit.overflow) {
        const whiteSpace = labelFit.overflow ? "normal" : "nowrap";
        labelStyleParts.push(`font-size:${round(labelFit.fontSizePx)}px`, `white-space:${whiteSpace}`);
      }
      const labelStyle =
        labelStyleParts.length === 0 ? "" : ` style="${labelStyleParts.join(";")}"`;
      return `<div id="${nodeIds[index]}" class="kakeai-flownode${labelFit.overflow ? " kakeai-flownode-overflow" : ""}" style="left:${round(layout.xs[index]!)}px;top:${round(layout.ys[index]!)}px;width:${round(layout.nodeW)}px;height:${round(layout.nodeH)}px"><span class="kakeai-flownode-label"${labelStyle}>${escapeHtmlText(node.label)}</span>${caption}${overlay}</div>`;
    })
    .join("");

  const titleHtml =
    title === undefined || title.trim().length === 0
      ? ""
      : `<figcaption class="kakeai-flowtitle" style="${themeRoleFontStyle(theme, "heading", context.document.locale)}">${escapeHtmlText(title)}</figcaption>`;
  const presetClass = preset === "boxed" ? " kakeai-flow-boxed" : "";
  const plot = `<div class="kakeai-flowplot kakeai-flow-${isCycle ? "cycle" : orientation}${presetClass}" style="width:${plotSize.width}px;height:${plotSize.height}px"><svg class="kakeai-flowsvg" width="${plotSize.width}" height="${plotSize.height}" viewBox="0 0 ${plotSize.width} ${plotSize.height}"><defs><marker id="${markerId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--kakeai-muted)"></path></marker></defs>${edgesHtml}</svg>${nodesHtml}</div>`;

  return {
    html: `<figure class="kakeai-flowwrap" style="${themeRoleFontStyle(theme, "body", context.document.locale)}">${titleHtml}${plot}</figure>`,
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
