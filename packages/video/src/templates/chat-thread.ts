import { chatThreadInputSchema } from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlText } from "../escape";
import type { RenderedCue, RenderContext } from "../render-context";
import { accentForegroundHex } from "../theme";

const DEFAULT_STATUS_TIME = "9:41";

const WIFI_SVG =
  '<svg viewBox="0 0 24 18" aria-hidden="true"><path d="M12 14.4a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4Z"/><path d="M12 9.9c1.9 0 3.6.7 4.9 1.9l-1.7 1.7A4.6 4.6 0 0 0 12 12.2c-1.2 0-2.3.5-3.2 1.3l-1.7-1.7A7 7 0 0 1 12 9.9Z"/><path d="M12 5.2c3.1 0 5.9 1.2 8 3.2l-1.7 1.7A8.8 8.8 0 0 0 12 7.5a8.8 8.8 0 0 0-6.3 2.6l-1.7-1.7A11.2 11.2 0 0 1 12 5.2Z"/></svg>';

const BATTERY_SVG =
  '<svg viewBox="0 0 30 14" fill="none" aria-hidden="true"><rect x="0.8" y="0.8" width="24" height="12.4" rx="3.6" stroke="currentColor" stroke-width="1.6" opacity="0.5"/><rect x="3.2" y="3.2" width="19" height="7.6" rx="2" fill="currentColor"/><path d="M27 4.6c1.5.6 1.5 4.2 0 4.8V4.6Z" fill="currentColor" opacity="0.5"/></svg>';

function statusBarHtml(time: string | undefined): string {
  const label = time === undefined ? DEFAULT_STATUS_TIME : time.trim();
  const timeHtml =
    label.length === 0
      ? '<span class="kakeai-chatstatus-time"></span>'
      : `<span class="kakeai-chatstatus-time">${escapeHtmlText(label)}</span>`;
  return `<div class="kakeai-chatstatus">${timeHtml}<span class="kakeai-chatstatus-island" aria-hidden="true"></span><span class="kakeai-chatstatus-icons" aria-hidden="true"><span class="kakeai-chatstatus-wifi">${WIFI_SVG}</span><span class="kakeai-chatstatus-battery">${BATTERY_SVG}</span></span></div>`;
}

export function renderChatThread(input: unknown, context: RenderContext): RenderedCue {
  const parsed = chatThreadInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path: context.path, code: "invalid_input", message: "chat.thread の入力が不正です。" },
    ]);
  }
  const { title, frame, statusBar, statusTime, messages } = parsed.data;
  const theme = context.theme;
  const accent = theme.accents.primary;
  const accentFg = accentForegroundHex(accent, theme);
  const assetIds: string[] = [];

  const showStatus = frame === "phone" && statusBar !== false;
  const statusHtml = showStatus ? statusBarHtml(statusTime) : "";
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
      return `<div class="kakeai-chatrow kakeai-chatrow-${side}">${iconHtml}<div class="kakeai-chatbubble">${nameHtml}<span class="kakeai-chatbody">${escapeHtmlText(message.body)}</span>${timeHtml}</div></div>`;
    })
    .join("");

  const inner = `<div class="kakeai-chatinner">${statusHtml}${titleHtml}<div class="kakeai-chatmessages">${messagesHtml}</div><span class="kakeai-chatbezel" aria-hidden="true"></span></div>`;

  return {
    html: `<div class="kakeai-chatwrap kakeai-chatwrap-${frame}"><div class="kakeai-chatpanel kakeai-chatpanel-${frame}" style="--kakeai-chat-accent:${accent};--kakeai-chat-accent-fg:${accentFg}">${inner}</div></div>`,
    assetIds,
    animation: [],
  };
}
