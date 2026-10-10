import { textBodyInputSchema } from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlText } from "../escape";

export function renderTextBody(input: unknown, path: (string | number)[]): string {
  const parsed = textBodyInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path, code: "invalid_input", message: "text.body の入力が不正です。" },
    ]);
  }
  const { heading, body } = parsed.data;
  return `<div class="kakeai-bodywrap"><h2 class="kakeai-heading">${escapeHtmlText(heading)}</h2><p class="kakeai-body">${escapeHtmlText(body)}</p></div>`;
}
