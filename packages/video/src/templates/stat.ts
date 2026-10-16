import {
  statInputSchema,
  type EmphasizeEffect,
  type OnsetPreset,
  type StatEffect,
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
  planAppearEffect,
  planOnsetEffect,
  planValueAnimation,
  resolveTriggerWindow,
  tableNumberFormatToValueFormat,
} from "../cue-effects";
import { accentForegroundHex } from "../theme";
import { formatNumber } from "./table-format";
import { toneHex } from "./tone";

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

function emphasizeOffVars(
  effect: EmphasizeEffect,
  toneColor: string,
): Record<string, string | number> {
  if (effect.style === "frame" || effect.style === "spotlight") {
    return { boxShadow: "none" };
  }
  return { backgroundColor: "transparent", color: toneColor };
}

export function renderStat(input: unknown, context: RenderContext): RenderedCue {
  const parsed = statInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path: context.path, code: "invalid_input", message: "stat の入力が不正です。" },
    ]);
  }
  const { value, label, caption, format, style, effects } = parsed.data;
  const theme = context.theme;
  const toneColor = toneHex(style?.tone ?? "primary", theme);
  const preset = style?.preset ?? "plain";
  const valueId = context.scope.id("value");
  const valueTextId = context.scope.id("value-text");
  const cardId = context.scope.id("card");

  const animation: AnimationItem[] = [];
  const stateIntervals: StateInterval[] = [];
  const valueAnimations: ValueAnimation[] = [];
  let onsetInfo: { preset: OnsetPreset; color: string } | undefined;

  const spanMs = context.cueTiming?.spanMs ?? 0;
  const lineIntervals = context.lineIntervals ?? [];
  applyStatEffects({
    effects: effects ?? [],
    valueId,
    valueTextId,
    cardId,
    numericValue: value,
    format,
    toneColor,
    theme,
    lineIntervals,
    spanMs,
    path: context.path,
    animation,
    stateIntervals,
    valueAnimations,
    markOnset: (preset, color) => {
      if (onsetInfo === undefined) {
        onsetInfo = { preset, color };
      }
    },
  });

  const overlay =
    onsetInfo === undefined
      ? ""
      : `<span id="${onsetOverlayId(valueId)}" class="kakeai-onsetoverlay kakeai-onset-${onsetInfo.preset}" style="--kakeai-onset-color:${onsetInfo.color}"></span>`;
  const labelHtml =
    label === undefined || label.trim().length === 0
      ? ""
      : `<span class="kakeai-statlabel">${escapeHtmlText(label)}</span>`;
  const captionHtml =
    caption === undefined || caption.trim().length === 0
      ? ""
      : `<span class="kakeai-statcaption">${escapeHtmlText(caption)}</span>`;
  const cardClass = preset === "card" ? " kakeai-stat-card" : "";

  return {
    html: `<figure class="kakeai-statwrap"><div id="${cardId}" class="kakeai-statcard${cardClass}"><span id="${valueId}" class="kakeai-statvalue" style="color:${toneColor}"><span id="${valueTextId}">${escapeHtmlText(formatNumber(value, format))}</span>${overlay}</span>${labelHtml}${captionHtml}</div></figure>`,
    assetIds: [],
    animation,
    stateIntervals,
    valueAnimations,
  };
}

function applyStatEffects(options: {
  effects: readonly StatEffect[];
  valueId: string;
  valueTextId: string;
  cardId: string;
  numericValue: number;
  format: "integer" | "decimal" | "percent" | "currency";
  toneColor: string;
  theme: VisualThemeDefinition;
  lineIntervals: RenderContext["lineIntervals"];
  spanMs: number;
  path: (string | number)[];
  animation: AnimationItem[];
  stateIntervals: StateInterval[];
  valueAnimations: ValueAnimation[];
  markOnset: (preset: OnsetPreset, color: string) => void;
}): void {
  const lineIntervals = options.lineIntervals ?? [];
  options.effects.forEach((entry, effectIndex) => {
    const path = [...options.path, "effects", effectIndex];
    if (entry.effect.kind === "appear") {
      const plan = planAppearEffect({
        targets: [{ id: options.cardId, step: 0 }],
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
    if (entry.effect.kind === "value") {
      const plan = planValueAnimation({
        targetId: options.valueTextId,
        to: options.numericValue,
        format: tableNumberFormatToValueFormat(options.format),
        effect: entry.effect,
        window,
        spanMs: options.spanMs,
      });
      if (plan !== null) {
        options.valueAnimations.push(plan);
      }
      return;
    }
    options.stateIntervals.push({
      targetId: options.valueId,
      intervals: [{ startMs: window.startMs, endMs: window.endMs }],
      on: emphasizeOnVars(entry.effect, options.theme),
      off: emphasizeOffVars(entry.effect, options.toneColor),
    });
    if (entry.effect.onset !== undefined) {
      options.markOnset(entry.effect.onset.preset, toneHex(entry.effect.tone, options.theme));
      const onset = planOnsetEffect({
        overlayId: onsetOverlayId(options.valueId),
        effect: entry.effect,
        window,
        spanMs: options.spanMs,
      });
      if (onset !== null) {
        options.animation.push(onset);
      }
    }
  });
}
