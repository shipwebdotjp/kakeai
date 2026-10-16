import {
  listCalloutInputSchema,
  type EmphasizeEffect,
  type VisualThemeDefinition,
} from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlText } from "../escape";
import type { AnimationItem, RenderedCue, RenderContext, StateInterval } from "../render-context";
import { planAppearEffect, resolveTriggerWindow } from "../cue-effects";
import { accentForegroundHex } from "../theme";
import { toneHex } from "./tone";

function emphasizeOnVars(
  effect: EmphasizeEffect,
  theme: VisualThemeDefinition,
): Record<string, string | number> {
  const hex = toneHex(effect.tone, theme);
  if (effect.style === "frame") {
    return { boxShadow: `inset 0 0 0 4px ${hex}` };
  }
  return { backgroundColor: hex, color: accentForegroundHex(hex, theme) };
}

function emphasizeOffVars(effect: EmphasizeEffect): Record<string, string | number> {
  if (effect.style === "frame") {
    return { boxShadow: "none" };
  }
  return { backgroundColor: "transparent", color: "inherit" };
}

export function renderListCallout(input: unknown, context: RenderContext): RenderedCue {
  const parsed = listCalloutInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path: context.path, code: "invalid_input", message: "list.callout の入力が不正です。" },
    ]);
  }
  const { title, items, appear } = parsed.data;
  const theme = context.theme;
  const spanMs = context.cueTiming?.spanMs ?? 0;
  const lineIntervals = context.lineIntervals ?? [];
  const itemIds = items.map((_item, index) => context.scope.id(`item-${index}`));
  const animation: AnimationItem[] = [];
  const stateIntervals: StateInterval[] = [];

  items.forEach((item, index) => {
    if (item.trigger === undefined || item.effect === undefined) {
      return;
    }
    const path = [...context.path, "items", index];
    if (item.effect.kind === "emphasize") {
      const window = resolveTriggerWindow(item.trigger, lineIntervals, spanMs, path);
      if (window !== null) {
        stateIntervals.push({
          targetId: itemIds[index]!,
          intervals: [{ startMs: window.startMs, endMs: window.endMs }],
          on: emphasizeOnVars(item.effect, theme),
          off: emphasizeOffVars(item.effect),
        });
      }
      return;
    }
    const plan = planAppearEffect({
      targets: [{ id: itemIds[index]!, step: 0 }],
      trigger: item.trigger,
      effect: item.effect,
      lineIntervals,
      spanMs,
      path,
    });
    animation.push(...plan.animation);
    stateIntervals.push(...plan.stateIntervals);
  });

  if (appear !== undefined) {
    const plan = planAppearEffect({
      targets: itemIds.map((id, index) => ({ id, step: index })),
      trigger: appear.trigger,
      effect: appear.effect,
      lineIntervals,
      spanMs,
      path: [...context.path, "appear"],
    });
    animation.push(...plan.animation);
    stateIntervals.push(...plan.stateIntervals);
  }

  const titleHtml =
    title === undefined || title.trim().length === 0
      ? ""
      : `<figcaption class="kakeai-callouttitle">${escapeHtmlText(title)}</figcaption>`;
  const itemsHtml = items
    .map(
      (item, index) =>
        `<li id="${itemIds[index]}" class="kakeai-calloutitem">${escapeHtmlText(item.text)}</li>`,
    )
    .join("");
  return {
    html: `<figure class="kakeai-calloutwrap">${titleHtml}<ul class="kakeai-calloutlist">${itemsHtml}</ul></figure>`,
    assetIds: [],
    animation,
    stateIntervals,
  };
}
