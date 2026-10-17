import { mediaFullBleedInputSchema, type MediaFullBleedInput } from "@kakeai/contracts";
import type { z } from "zod";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlAttribute } from "../escape";
import type { RenderedCue, RenderContext } from "../render-context";
import { mediaCropStyle, renderLoopVideoSegments, resolveCueMedia, secondsText } from "./shared";

export function renderMediaFullBleed(
  input: unknown,
  context: RenderContext,
  schema: z.ZodTypeAny = mediaFullBleedInputSchema,
): RenderedCue {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path: context.path, code: "invalid_input", message: "media.full-bleed の入力が不正です。" },
    ]);
  }
  const data = parsed.data as MediaFullBleedInput;
  const { assetId, fit, focalPoint, zoom } = data;
  const media = resolveCueMedia(assetId, context.assetResolver, context.path);
  const src = escapeHtmlAttribute(media.url);
  const id = context.scope.id("media");
  const style = `object-fit:${fit};${mediaCropStyle(focalPoint, zoom)}`;
  if (media.kind === "video") {
    const sourceDurationMs = media.durationMs;
    const trimStartMs = data.trimStartMs ?? 0;
    const trimEndMs = data.trimEndMs ?? sourceDurationMs;
    if (
      trimStartMs < 0 ||
      (trimEndMs !== null && trimEndMs <= trimStartMs) ||
      (sourceDurationMs !== null && trimEndMs !== null && trimEndMs > sourceDurationMs)
    ) {
      throw new CompositionCompileError([
        {
          path: context.path,
          code: "invalid_trim_range",
          message: "動画トリムの範囲が素材の尺を超えているか、開始 ≧ 終了です。",
        },
      ]);
    }
    const loopLengthMs = trimEndMs === null ? null : trimEndMs - trimStartMs;
    const audible = context.embeddedAudio === true;
    if (
      data.loop === true &&
      context.cueTiming !== undefined &&
      loopLengthMs !== null
    ) {
      const looped = renderLoopVideoSegments({
        idPrefix: id,
        url: media.url,
        className: "kakeai-fullbleed",
        style,
        startMs: context.cueTiming.startMs,
        spanMs: context.cueTiming.spanMs,
        sourceDurationMs,
        mediaStartMs: trimStartMs,
        loopLengthMs,
        audible,
        path: context.path,
      });
      if (looped !== null) {
        return { html: looped, assetIds: [assetId], animation: [] };
      }
    }
    const timingAttrs =
      context.cueTiming !== undefined && loopLengthMs !== null && data.trimEndMs !== undefined
        ? ` data-start="${secondsText(context.cueTiming.startMs)}" data-duration="${secondsText(Math.min(context.cueTiming.spanMs, loopLengthMs))}"`
        : "";
    return {
      html: `<video id="${id}" class="kakeai-fullbleed" src="${src}" style="${style}"${audible ? ' data-has-audio="true"' : " muted"} playsinline preload="auto" data-media-start="${secondsText(trimStartMs)}"${timingAttrs}></video>`,
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
