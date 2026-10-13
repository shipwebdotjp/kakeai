import { mediaCardInputSchema } from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlAttribute, escapeHtmlText } from "../escape";
import type { RenderedCue, RenderContext } from "../render-context";
import { focalPointStyle, resolveCueMedia } from "./shared";

export function renderMediaCard(input: unknown, context: RenderContext): RenderedCue {
  const parsed = mediaCardInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path: context.path, code: "invalid_input", message: "media.card の入力が不正です。" },
    ]);
  }
  const { assetId, aspectRatio, heading, caption, focalPoint } = parsed.data;
  const media = resolveCueMedia(assetId, context.assetResolver, context.path);
  const src = escapeHtmlAttribute(media.url);
  const style = `${focalPointStyle(focalPoint)}aspect-ratio:${aspectRatio.replace(":", "/")};height:640px;width:auto;`;
  const id = context.scope.id("media");
  const mediaHtml =
    media.kind === "video"
      ? `<video id="${id}" class="kakeai-cardmedia" src="${src}" style="${style}" muted playsinline preload="auto" data-media-start="0"></video>`
      : `<img id="${id}" class="kakeai-cardmedia" src="${src}" style="${style}" alt="">`;
  const headingHtml =
    heading.length === 0 ? "" : `<h3 class="kakeai-cardheading">${escapeHtmlText(heading)}</h3>`;
  const captionHtml =
    caption === undefined || caption.length === 0
      ? ""
      : `<p class="kakeai-cardcaption">${escapeHtmlText(caption)}</p>`;
  const textHtml =
    headingHtml.length === 0 && captionHtml.length === 0
      ? ""
      : `<figcaption class="kakeai-cardtext">${headingHtml}${captionHtml}</figcaption>`;
  return {
    html: `<figure class="kakeai-card">${mediaHtml}${textHtml}</figure>`,
    assetIds: [assetId],
    animation: [],
  };
}
