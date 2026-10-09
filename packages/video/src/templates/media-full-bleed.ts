import { mediaFullBleedV1 } from "@kakeai/contracts";
import type { AssetResolver } from "../resolver";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlAttribute } from "../escape";
import { focalPointStyle, resolveCueMedia, type RenderedMedia } from "./shared";

export function renderMediaFullBleed(
  input: unknown,
  path: (string | number)[],
  assetResolver: AssetResolver,
  mediaElementId: string,
): RenderedMedia {
  const parsed = mediaFullBleedV1.inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path, code: "invalid_input", message: "media.full-bleed の入力が不正です。" },
    ]);
  }
  const { assetId, fit, focalPoint } = parsed.data;
  const media = resolveCueMedia(assetId, assetResolver, path);
  const src = escapeHtmlAttribute(media.url);
  const style = `object-fit:${fit};${focalPointStyle(focalPoint)}`;
  if (media.kind === "video") {
    return {
      html: `<video id="${mediaElementId}" class="kakeai-fullbleed" src="${src}" style="${style}" muted playsinline preload="auto" data-media-start="0"></video>`,
      assetIds: [assetId],
    };
  }
  return {
    html: `<img id="${mediaElementId}" class="kakeai-fullbleed" src="${src}" style="${style}" alt="">`,
    assetIds: [assetId],
  };
}
