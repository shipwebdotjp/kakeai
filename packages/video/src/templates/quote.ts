import {
  quoteInputSchema,
  type EmphasizeEffect,
  type OnsetPreset,
  type QuoteEffect,
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
} from "../cue-effects";
import { accentForegroundHex } from "../theme";
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

export function renderQuote(input: unknown, context: RenderContext): RenderedCue {
  const parsed = quoteInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path: context.path, code: "invalid_input", message: "quote の入力が不正です。" },
    ]);
  }
  const { quote, author, source, style, effects } = parsed.data;
  const theme = context.theme;
  const toneColor = toneHex(style?.tone ?? "primary", theme);
  const preset = style?.preset ?? "plain";
  const cardId = context.scope.id("card");
  const quoteId = context.scope.id("quote");
  const authorId = context.scope.id("author");
  const sourceId = context.scope.id("source");

  const animation: AnimationItem[] = [];
  const stateIntervals: StateInterval[] = [];
  const siblings: string[] = [];
  if (author !== undefined && author.trim().length > 0) {
    siblings.push(authorId);
  }
  if (source !== undefined && source.trim().length > 0) {
    siblings.push(sourceId);
  }
  let onsetInfo: { preset: OnsetPreset; color: string } | undefined;

  applyQuoteEffects({
    effects: effects ?? [],
    cardId,
    quoteId,
    siblings,
    theme,
    toneColor,
    lineIntervals: context.lineIntervals ?? [],
    spanMs: context.cueTiming?.spanMs ?? 0,
    path: context.path,
    animation,
    stateIntervals,
    markOnset: (presetName, color) => {
      if (onsetInfo === undefined) {
        onsetInfo = { preset: presetName, color };
      }
    },
  });

  const overlay =
    onsetInfo === undefined
      ? ""
      : `<span id="${onsetOverlayId(quoteId)}" class="kakeai-onsetoverlay kakeai-onset-${onsetInfo.preset}" style="--kakeai-onset-color:${onsetInfo.color}"></span>`;
  const quoteHtml = `<blockquote id="${quoteId}" class="kakeai-quotetext" style="color:${toneColor}">${escapeHtmlText(quote)}${overlay}</blockquote>`;
  const authorHtml =
    author === undefined || author.trim().length === 0
      ? ""
      : `<span id="${authorId}" class="kakeai-quoteauthor">${escapeHtmlText(author)}</span>`;
  const sourceHtml =
    source === undefined || source.trim().length === 0
      ? ""
      : `<cite id="${sourceId}" class="kakeai-quotesource">${escapeHtmlText(source)}</cite>`;
  const attribution =
    authorHtml.length === 0 && sourceHtml.length === 0
      ? ""
      : `<figcaption class="kakeai-quoteattrib">${authorHtml}${sourceHtml}</figcaption>`;
  const cardClass = preset === "card" ? " kakeai-quote-card" : "";

  return {
    html: `<figure class="kakeai-quotewrap"><div id="${cardId}" class="kakeai-quotecard${cardClass}">${quoteHtml}${attribution}</div></figure>`,
    assetIds: [],
    animation,
    stateIntervals,
  };
}

export function applyQuoteEffects(options: {
  effects: readonly QuoteEffect[];
  cardId: string;
  quoteId: string;
  siblings: readonly string[];
  theme: VisualThemeDefinition;
  toneColor: string;
  lineIntervals: RenderContext["lineIntervals"];
  spanMs: number;
  path: (string | number)[];
  animation: AnimationItem[];
  stateIntervals: StateInterval[];
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
    const interval = [{ startMs: window.startMs, endMs: window.endMs }];
    options.stateIntervals.push({
      targetId: options.quoteId,
      intervals: interval,
      on: emphasizeOnVars(entry.effect, options.theme),
      off: emphasizeOffVars(entry.effect, options.toneColor),
    });
    if (entry.effect.style === "spotlight") {
      for (const siblingId of options.siblings) {
        options.stateIntervals.push({
          targetId: siblingId,
          intervals: interval,
          on: SPOTLIGHT_DIM_ON,
          off: SPOTLIGHT_DIM_OFF,
        });
      }
    }
    if (entry.effect.onset !== undefined) {
      options.markOnset(entry.effect.onset.preset, toneHex(entry.effect.tone, options.theme));
      const onsetPlan = planOnsetEffect({
        overlayId: onsetOverlayId(options.quoteId),
        effect: entry.effect,
        window,
        spanMs: options.spanMs,
      });
      options.animation.push(...onsetPlan.animation);
      options.stateIntervals.push(...onsetPlan.stateIntervals);
    }
  });
}
