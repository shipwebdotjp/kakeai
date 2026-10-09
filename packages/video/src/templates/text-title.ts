import { textTitleV1 } from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlText } from "../escape";

export function renderTextTitle(input: unknown, path: (string | number)[]): string {
  const parsed = textTitleV1.inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path, code: "invalid_input", message: "text.title の入力が不正です。" },
    ]);
  }
  const { title, subtitle, anchor } = parsed.data;
  const align = anchor ?? "center";
  const subtitleHtml =
    subtitle.length === 0
      ? ""
      : `<p class="kakeai-subtitle">${escapeHtmlText(subtitle)}</p>`;
  return `<div class="kakeai-titlewrap" style="text-align:${align}"><h1 class="kakeai-title">${escapeHtmlText(title)}</h1>${subtitleHtml}</div>`;
}
