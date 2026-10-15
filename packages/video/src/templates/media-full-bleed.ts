import { mediaFullBleedV2InputSchema, type MediaFullBleedV2Input } from "@kakeai/contracts";
import type { z } from "zod";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlAttribute } from "../escape";
import type { RenderedCue, RenderContext } from "../render-context";
import { mediaCropStyle, renderLoopVideoSegments, resolveCueMedia } from "./shared";

export function renderMediaFullBleed(
  input: unknown,
  context: RenderContext,
  schema: z.ZodTypeAny = mediaFullBleedV2InputSchema,
): RenderedCue {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path: context.path, code: "invalid_input", message: "media.full-bleed の入力が不正です。" },
    ]);
  }
  const data = parsed.data as MediaFullBleedV2Input;
  const { assetId, fit, focalPoint, zoom } = data;
  const media = resolveCueMedia(assetId, context.assetResolver, context.path);
  const src = escapeHtmlAttribute(media.url);
  const id = context.scope.id("media");
  const style = `object-fit:${fit};${mediaCropStyle(focalPoint, zoom)}`;
  if (media.kind === "video") {
    if (data.loop === true && context.cueTiming !== undefined) {
      const looped = renderLoopVideoSegments({
        idPrefix: id,
        url: media.url,
        className: "kakeai-fullbleed",
        style,
        startMs: context.cueTiming.startMs,
        spanMs: context.cueTiming.spanMs,
        sourceDurationMs: media.durationMs,
        path: context.path,
      });
      if (looped !== null) {
        return { html: looped, assetIds: [assetId], animation: [] };
      }
    }
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
