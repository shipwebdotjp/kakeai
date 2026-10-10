import { mediaFullBleedInputSchema } from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlAttribute } from "../escape";
import type { RenderedCue, RenderContext } from "../render-context";
import { focalPointStyle, resolveCueMedia } from "./shared";

export function renderMediaFullBleed(input: unknown, context: RenderContext): RenderedCue {
  const parsed = mediaFullBleedInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path: context.path, code: "invalid_input", message: "media.full-bleed の入力が不正です。" },
    ]);
  }
  const { assetId, fit, focalPoint } = parsed.data;
  const media = resolveCueMedia(assetId, context.assetResolver, context.path);
  const src = escapeHtmlAttribute(media.url);
  const id = context.scope.id("media");
  const style = `object-fit:${fit};${focalPointStyle(focalPoint)}`;
  if (media.kind === "video") {
    return {
      html: `<video id="${id}" class="kakeai-fullbleed" src="${src}" style="${style}" muted playsinline preload="auto" data-media-start="0"></video>`,
      assetIds: [assetId],
      animation: [],
    };
  }
  return {
    html: `<img id="${id}" class="kakeai-fullbleed" src="${src}" style="${style}" alt="">`,
    assetIds: [assetId],
    animation: [],
  };
}
