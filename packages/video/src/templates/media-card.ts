import { mediaCardV1 } from "@kakeai/contracts";
import type { AssetResolver } from "../resolver";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlAttribute, escapeHtmlText } from "../escape";
import { focalPointStyle, resolveCueMedia, type RenderedMedia } from "./shared";

export function renderMediaCard(
  input: unknown,
  path: (string | number)[],
  assetResolver: AssetResolver,
  mediaElementId: string,
): RenderedMedia {
  const parsed = mediaCardV1.inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path, code: "invalid_input", message: "media.card の入力が不正です。" },
    ]);
  }
  const { assetId, heading, caption, focalPoint } = parsed.data;
  const media = resolveCueMedia(assetId, assetResolver, path);
  const src = escapeHtmlAttribute(media.url);
  const style = focalPointStyle(focalPoint);
  const mediaHtml =
    media.kind === "video"
      ? `<video id="${mediaElementId}" class="kakeai-cardmedia" src="${src}" style="${style}" muted playsinline preload="auto" data-media-start="0"></video>`
      : `<img id="${mediaElementId}" class="kakeai-cardmedia" src="${src}" style="${style}" alt="">`;
  const captionHtml =
    caption === undefined || caption.length === 0
      ? ""
      : `<p class="kakeai-cardcaption">${escapeHtmlText(caption)}</p>`;
  return {
    html: `<figure class="kakeai-card">${mediaHtml}<figcaption class="kakeai-cardtext"><h3 class="kakeai-cardheading">${escapeHtmlText(heading)}</h3>${captionHtml}</figcaption></figure>`,
    assetIds: [assetId],
  };
}
