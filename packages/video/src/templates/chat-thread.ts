import {
  chatThreadInputSchema,
  type ChatEffectTarget,
  type EmphasizeEffect,
  type OnsetPreset,
  type VisualThemeDefinition,
} from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import {
  onsetOverlayId,
  planAppearEffect,
  planOnsetEffect,
  resolveTriggerWindow,
  SPOTLIGHT_DIM_OFF,
  SPOTLIGHT_DIM_ON,
} from "../cue-effects";
import { escapeHtmlText } from "../escape";
import type { AnimationItem, RenderedCue, RenderContext, StateInterval } from "../render-context";
import { accentForegroundHex } from "../theme";
import { laptopBaseHtml, statusBarHtml } from "./device-chrome";
import { toneHex } from "./tone";

interface BubbleBase {
  backgroundColor: string;
  color: string;
}

function emphasizeOnVars(
  effect: EmphasizeEffect,
  theme: VisualThemeDefinition,
): Record<string, string | number> {
  const hex = toneHex(effect.tone, theme);
  if (effect.style === "frame" || effect.style === "spotlight") {
    return { boxShadow: `inset 0 0 0 4px ${hex}` };
  }
  return { backgroundColor: hex, color: accentForegroundHex(hex, theme) };
}

function emphasizeOffVars(
  effect: EmphasizeEffect,
  base: BubbleBase,
): Record<string, string | number> {
  if (effect.style === "frame" || effect.style === "spotlight") {
    return { boxShadow: "none" };
  }
  return { backgroundColor: base.backgroundColor, color: base.color };
}

export function renderChatThread(input: unknown, context: RenderContext): RenderedCue {
  const parsed = chatThreadInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path: context.path, code: "invalid_input", message: "chat.thread の入力が不正です。" },
    ]);
  }
  const { title, frame, statusBar, statusTime, keyboard, messages, effects } = parsed.data;
  const theme = context.theme;
  const accent = theme.accents.primary;
  const accentFg = accentForegroundHex(accent, theme);
  const assetIds: string[] = [];

  const rowIds = messages.map((_message, index) => context.scope.id(`msg-${index}`));
  const bubbleIds = messages.map((_message, index) => context.scope.id(`bubble-${index}`));
  const bubbleBases: BubbleBase[] = messages.map((message) => {
    const right = (message.side ?? "left") === "right";
    return {
      backgroundColor: right ? accent : theme.surfaceMuted,
      color: right ? accentFg : theme.text,
    };
  });

  const animation: AnimationItem[] = [];
  const stateIntervals: StateInterval[] = [];
  const onsets = new Map<string, { preset: OnsetPreset; color: string }>();
  const lineIntervals = context.lineIntervals ?? [];
  const spanMs = context.cueTiming?.spanMs ?? 0;
  const indicesFor = (target: ChatEffectTarget): number[] => {
    if (target.kind === "message") {
      return target.index < messages.length ? [target.index] : [];
    }
    return messages.map((_message, index) => index);
  };

  (effects ?? []).forEach((entry, effectIndex) => {
    const path = [...context.path, "effects", effectIndex];
    const indices = indicesFor(entry.target);
    if (indices.length === 0) {
      return;
    }
    if (entry.effect.kind === "appear") {
      const targets = indices.flatMap((messageIndex, step) => {
        const id = rowIds[messageIndex];
        return id === undefined ? [] : [{ id, step }];
      });
      const plan = planAppearEffect({
        targets,
        trigger: entry.trigger,
        effect: entry.effect,
        lineIntervals,
        spanMs,
        path,
      });
      animation.push(...plan.animation);
      stateIntervals.push(...plan.stateIntervals);
      return;
    }
    const emphasize = entry.effect;
    const window = resolveTriggerWindow(entry.trigger, lineIntervals, spanMs, path);
    if (window === null) {
      return;
    }
    const interval = [{ startMs: window.startMs, endMs: window.endMs }];
    indices.forEach((messageIndex) => {
      const bubbleId = bubbleIds[messageIndex];
      const base = bubbleBases[messageIndex];
      if (bubbleId === undefined || base === undefined) {
        return;
      }
      stateIntervals.push({
        targetId: bubbleId,
        intervals: interval,
        on: emphasizeOnVars(emphasize, theme),
        off: emphasizeOffVars(emphasize, base),
      });
      if (emphasize.onset !== undefined) {
        onsets.set(bubbleId, {
          preset: emphasize.onset.preset,
          color: toneHex(emphasize.tone, theme),
        });
        const onsetPlan = planOnsetEffect({
          overlayId: onsetOverlayId(bubbleId),
          effect: emphasize,
          window,
          spanMs,
        });
        animation.push(...onsetPlan.animation);
        stateIntervals.push(...onsetPlan.stateIntervals);
      }
    });
    if (emphasize.style === "spotlight") {
      const targetIndices = new Set(indices);
      messages.forEach((_message, other) => {
        if (targetIndices.has(other)) {
          return;
        }
        const siblingId = rowIds[other];
        if (siblingId === undefined) {
          return;
        }
        stateIntervals.push({
          targetId: siblingId,
          intervals: interval,
          on: SPOTLIGHT_DIM_ON,
          off: SPOTLIGHT_DIM_OFF,
        });
      });
    }
  });

  const showStatus = frame === "phone" && statusBar !== false;
  const statusHtml = showStatus ? statusBarHtml("kakeai-chatstatus", statusTime) : "";
  const showKeyboard = frame === "laptop" && keyboard === true;
  const titleHtml =
    title === undefined || title.trim().length === 0
      ? ""
      : `<div class="kakeai-chatheader">${escapeHtmlText(title)}</div>`;

  const messagesHtml = messages
    .map((message, index) => {
      const side = message.side ?? "left";
      let iconHtml = "";
      if (message.icon !== undefined) {
        const rendered = context.renderNested(
          { ...message.icon, fit: "cover" },
          context.scope.child(`icon-${index}`),
          [...context.path, "messages", index, "icon"],
        );
        assetIds.push(...rendered.assetIds);
        iconHtml = `<span class="kakeai-chaticon">${rendered.html}</span>`;
      }
      const nameHtml =
        message.name !== undefined && message.name.trim().length > 0
          ? `<span class="kakeai-chatname">${escapeHtmlText(message.name)}</span>`
          : "";
      const timeHtml =
        message.time !== undefined && message.time.trim().length > 0
          ? `<span class="kakeai-chattime">${escapeHtmlText(message.time)}</span>`
          : "";
      const onset = onsets.get(bubbleIds[index]!);
      const overlayHtml =
        onset === undefined
          ? ""
          : `<span id="${onsetOverlayId(bubbleIds[index]!)}" class="kakeai-onsetoverlay kakeai-onset-${onset.preset}" style="--kakeai-onset-color:${onset.color}"></span>`;
      return `<div id="${rowIds[index]}" class="kakeai-chatrow kakeai-chatrow-${side}">${iconHtml}<div id="${bubbleIds[index]}" class="kakeai-chatbubble">${nameHtml}<span class="kakeai-chatbody">${escapeHtmlText(message.body)}</span>${timeHtml}${overlayHtml}</div></div>`;
    })
    .join("");

  const inner = `<div class="kakeai-chatinner">${statusHtml}${titleHtml}<div class="kakeai-chatmessages">${messagesHtml}</div><span class="kakeai-chatbezel" aria-hidden="true"></span></div>`;
  const panel = `<div class="kakeai-chatpanel kakeai-chatpanel-${frame}" style="--kakeai-chat-accent:${accent};--kakeai-chat-accent-fg:${accentFg}">${inner}</div>`;
  const content = showKeyboard
    ? `<div class="kakeai-chatdeck">${panel}${laptopBaseHtml()}</div>`
    : panel;
  const wrapClass = `kakeai-chatwrap kakeai-chatwrap-${frame}${showKeyboard ? " kakeai-chatwrap-keyboard" : ""}`;

  return {
    html: `<div class="${wrapClass}">${content}</div>`,
    assetIds,
    animation,
    stateIntervals,
  };
}
