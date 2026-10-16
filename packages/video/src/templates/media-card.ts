import { mediaCardInputSchema, type MediaCardInput } from "@kakeai/contracts";
import type { z } from "zod";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlAttribute, escapeHtmlText } from "../escape";
import type { RenderedCue, RenderContext } from "../render-context";
import { mediaCropStyle, renderLoopVideoSegments, resolveCueMedia } from "./shared";

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
  const { assetId, aspectRatio, heading, caption, focalPoint, zoom } = data;
  const media = resolveCueMedia(assetId, context.assetResolver, context.path);
  const src = escapeHtmlAttribute(media.url);
  const frameStyle = `aspect-ratio:${aspectRatio.replace(":", "/")};height:640px;width:auto;position:relative;`;
  const mediaStyle = mediaCropStyle(focalPoint, zoom);
  const id = context.scope.id("media");
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
      ? `<div class="kakeai-cardmedia-clip" style="${frameStyle}">${
          looped ??
          `<video id="${id}" class="kakeai-cardmedia" src="${src}" style="${mediaStyle}" muted playsinline preload="auto" data-media-start="0"></video>`
        }</div>`
      : `<div class="kakeai-cardmedia-clip" style="${frameStyle}"><img id="${id}" class="kakeai-cardmedia" src="${src}" style="${mediaStyle}" alt=""></div>`;
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
