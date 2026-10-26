import type { CaptionLayout, VisualThemeDefinition } from "@kakeai/contracts";

/**
 * Geometry of the baked-in caption layer, shared by the compiler CSS and any
 * Visual Template that must keep its content clear of the caption.
 *
 * The caption is a fixed layer at the bottom of the 1920x1080 canvas. A phone
 * or desktop chat panel reserves the height of the two caption lines that the
 * content contract allows before warning.
 */

export const CAPTION_BOTTOM_OFFSET_PX = 72;

/** Two lines are the no-warning limit for a caption (`content-schema.md`). */
export const CAPTION_SAFE_LINES = 2;

/** Band layout shows three caption lines (`frame` is two). */
export const CAPTION_SAFE_LINES_BAND = 3;

/** Band top padding reserves room for the overlapped speaker tab. */
export const CAPTION_BAND_TOP_PADDING_PX = 20;

/** Band bottom breathing room; the band anchors at bottom:0 with no 72px offset. */
export const CAPTION_BAND_BOTTOM_PADDING_PX = 24;

/**
 * Fallback for contexts that render a template fragment without the root
 * custom properties (template previews, unit tests). It must equal the safe
 * area of the default theme; `caption-layout.test.ts` asserts the equality.
 */
export const CAPTION_SAFE_AREA_FALLBACK_PX = 216;

/**
 * Padding of `.kakeai-captiontext` used when a theme disables the caption
 * surface. The compiler CSS interpolates both values, so they are the single
 * source for the fallback.
 */
export const CAPTION_FALLBACK_PADDING_VERTICAL_PX = 12;
export const CAPTION_FALLBACK_PADDING_HORIZONTAL_PX = 36;

/**
 * Height from the canvas bottom that must stay free of template content so
 * that a caption of up to `CAPTION_SAFE_LINES` lines does not overlap it.
 * Band layout reserves three lines in a bottom-anchored band and ignores the
 * theme caption surface padding/border/radius (background only). The speaker
 * label overlaps the top edge and never adds height, so show/hide does not
 * change this value.
 */
export function captionSafeAreaPx(
  theme: VisualThemeDefinition,
  layout: CaptionLayout = "frame",
): number {
  const token = theme.textRoles.caption;
  const lineHeightPx = token.fontSize * token.lineHeight;
  if (layout === "band") {
    return Math.ceil(
      CAPTION_BAND_TOP_PADDING_PX +
        CAPTION_SAFE_LINES_BAND * lineHeightPx +
        CAPTION_BAND_BOTTOM_PADDING_PX,
    );
  }
  const surface = theme.surfaces?.caption;
  const surfaceEnabled = surface?.enabled === true;
  const paddingVertical = surfaceEnabled
    ? surface.paddingVertical
    : CAPTION_FALLBACK_PADDING_VERTICAL_PX;
  const borderWidth = surfaceEnabled && surface.border !== undefined ? surface.border.width : 0;
  return Math.ceil(
    CAPTION_BOTTOM_OFFSET_PX +
      CAPTION_SAFE_LINES * lineHeightPx +
      2 * paddingVertical +
      2 * borderWidth,
  );
}

/** Root custom properties consumed by the caption and frame CSS. */
export function captionLayoutStyle(
  theme: VisualThemeDefinition,
  layout: CaptionLayout = "frame",
): string {
  return [
    `--kakeai-caption-offset:${CAPTION_BOTTOM_OFFSET_PX}px`,
    `--kakeai-caption-safe:${captionSafeAreaPx(theme, layout)}px`,
  ].join(";");
}
