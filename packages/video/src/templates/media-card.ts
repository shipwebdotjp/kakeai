import { mediaCardInputSchema, type MediaCardInput } from "@kakeai/contracts";
import type { z } from "zod";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlAttribute, escapeHtmlText } from "../escape";
import type { RenderedCue, RenderContext } from "../render-context";
import { mediaCropStyle, renderLoopVideoSegments, renderVideoPlaybackSegments, requireVideoPlaybackPlan, resolveCueMedia, assertVideoMedia } from "./shared";

export function renderMediaCardMedia(
  data: MediaCardInput,
  context: RenderContext,
  clipClassName: string,
  clipStyleExtra = "",
): { html: string; assetIds: string[] } {
  const { assetId, aspectRatio, focalPoint, zoom } = data;
  const media = resolveCueMedia(assetId, context.assetResolver, context.path);
  const src = escapeHtmlAttribute(media.url);
  const frameStyle = `aspect-ratio:${aspectRatio.replace(":", "/")};height:640px;width:auto;position:relative;${clipStyleExtra}`;
  const mediaStyle = mediaCropStyle(focalPoint, zoom);
  const id = context.scope.id("media");
  if (data.videoPlayback !== undefined) {
    assertVideoMedia(media, context.path);
    const html = renderVideoPlaybackSegments({
      idPrefix: id,
      plan: requireVideoPlaybackPlan(context),
      videoUrl: media.url,
      className: "kakeai-cardmedia",
      style: `${mediaStyle}position:absolute;inset:0;`,
      stillResolver: context.stillResolver,
      path: context.path,
    });
    return {
      html: `<div class="${clipClassName}" style="${frameStyle}">${html}</div>`,
      assetIds: [assetId],
    };
  }
  const looped =
    media.kind === "video" && data.loop === true && context.cueTiming !== undefined
      ? renderLoopVideoSegments({
          idPrefix: id,
          url: media.url,
          className: "kakeai-cardmedia",
          style: `${mediaStyle}position:absolute;inset:0;`,
          startMs: context.cueTiming.startMs,
          spanMs: context.cueTiming.spanMs,
          sourceDurationMs: media.durationMs,
          path: context.path,
        })
      : null;
  const mediaHtml =
    media.kind === "video"
      ? `<div class="${clipClassName}" style="${frameStyle}">${
          looped ??
          `<video id="${id}" class="kakeai-cardmedia" src="${src}" style="${mediaStyle}" muted playsinline preload="auto" data-media-start="0"></video>`
        }</div>`
      : `<div class="${clipClassName}" style="${frameStyle}"><img id="${id}" class="kakeai-cardmedia" src="${src}" style="${mediaStyle}" alt=""></div>`;
  return { html: mediaHtml, assetIds: [assetId] };
}

export function renderMediaCard(
  input: unknown,
  context: RenderContext,
  schema: z.ZodTypeAny = mediaCardInputSchema,
): RenderedCue {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path: context.path, code: "invalid_input", message: "media.card の入力が不正です。" },
    ]);
  }
  const data = parsed.data as MediaCardInput;
  const { heading, caption } = data;
  const media = renderMediaCardMedia(data, context, "kakeai-cardmedia-clip");
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
    html: `<figure class="kakeai-card">${media.html}${textHtml}</figure>`,
    assetIds: media.assetIds,
    animation: [],
  };
}
