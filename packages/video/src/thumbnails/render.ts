import {
  parseRichText,
  type RichTextSpan,
  type ThumbnailHeadlinePhotoInput,
  type ThumbnailLayeredInput,
  type ThumbnailPhotoCoverInput,
  type ThumbnailTextInput,
  type VisualThemeDefinition,
  type VisualThemeTextToken,
} from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlAttribute, escapeHtmlText } from "../escape";
import { THUMBNAIL_OUTPUT_HEIGHT } from "../meta";
import type { AssetResolver } from "../resolver";
import { contrastRatio, hexToRgb, mixHex, overlayToRgba, resolveFontFamilyCss } from "../theme";
import { mediaCropStyle, resolveCueMedia } from "../templates/shared";

export interface ThumbnailRenderContext {
  theme: VisualThemeDefinition;
  assetResolver: AssetResolver;
  path: (string | number)[];
}

export interface RenderedThumbnail {
  html: string;
  assetIds: string[];
}

const THUMB_SCALE = THUMBNAIL_OUTPUT_HEIGHT / 1080;

function scaledSize(base: number, factor = 1): number {
  return Math.round(Math.min(200, Math.max(16, base * THUMB_SCALE * factor)));
}

function roleFontFamily(token: VisualThemeTextToken): string {
  return resolveFontFamilyCss(token.fontFace, token.font);
}

interface TextCss {
  fontFamily: string;
  fontSize: string;
  color: string;
  fontWeight: string;
  fontStyle: string;
  lineHeight: string;
}

function textCss(token: VisualThemeTextToken, factor: number, color: string): TextCss {
  return {
    fontFamily: roleFontFamily(token),
    fontSize: `${scaledSize(token.fontSize, factor)}px`,
    color,
    fontWeight: token.decoration.bold ? "700" : "400",
    fontStyle: token.decoration.italic ? "italic" : "normal",
    lineHeight: String(token.lineHeight),
  };
}

function textStyle(css: TextCss, extra = ""): string {
  return [
    `font-family:${css.fontFamily}`,
    `font-size:${css.fontSize}`,
    `color:${css.color}`,
    `font-weight:${css.fontWeight}`,
    `font-style:${css.fontStyle}`,
    `line-height:${css.lineHeight}`,
    "margin:0",
    extra,
  ].join(";");
}

const MIN_ACCENT_CONTRAST = 3;

/**
 * Accent marks must stay readable on whatever surface the template puts the
 * text on. Start from the Theme accent, then lighten or darken toward the
 * Theme neutrals until the contrast is acceptable. The result is deterministic
 * because the candidate list is fixed.
 */
export function resolveReadableAccent(
  theme: VisualThemeDefinition,
  token: "primary" | "secondary" | "tertiary",
  background: string,
): string {
  const base = theme.accents[token];
  const candidates = [
    base,
    mixHex(base, theme.onMedia, 0.55),
    mixHex(base, theme.scrim.color, 0.55),
  ];
  for (const candidate of candidates) {
    if (contrastRatio(candidate, background) >= MIN_ACCENT_CONTRAST) {
      return candidate;
    }
  }
  return contrastRatio(theme.onMedia, background) >= contrastRatio(theme.canvas.ink, background)
    ? theme.onMedia
    : theme.canvas.ink;
}

/**
 * An outline is drawn with layered text shadows. It must contrast with the
 * glyph to be visible; the surface only breaks ties between the two Theme
 * neutrals.
 */
function outlineColorFor(
  theme: VisualThemeDefinition,
  textColor: string,
  background: string,
): string {
  const dark = theme.scrim.color;
  const light = theme.onMedia;
  const darkAgainstGlyph = contrastRatio(dark, textColor);
  const lightAgainstGlyph = contrastRatio(light, textColor);
  if (darkAgainstGlyph !== lightAgainstGlyph) {
    return darkAgainstGlyph > lightAgainstGlyph ? dark : light;
  }
  return contrastRatio(dark, background) >= contrastRatio(light, background) ? dark : light;
}

function outlineShadow(color: string): string {
  const { r, g, b } = hexToRgb(color);
  return [
    `0 0 2px rgba(${r},${g},${b},.9)`,
    `2px 2px 0 rgba(${r},${g},${b},.7)`,
    `-2px -2px 0 rgba(${r},${g},${b},.7)`,
  ].join(",");
}

interface RichTextColors {
  accent: string;
  background: string;
}

function richTextColors(theme: VisualThemeDefinition, surface: string): RichTextColors {
  return { accent: resolveReadableAccent(theme, "primary", surface), background: surface };
}

function richTextHtml(
  text: string,
  css: TextCss,
  colors: RichTextColors,
  theme: VisualThemeDefinition,
  path: (string | number)[],
): string {
  const parsed = parseRichText(text);
  if (parsed.errors.length > 0) {
    throw new CompositionCompileError(
      parsed.errors.map((error) => ({
        path,
        code: error.code,
        message: error.message,
      })),
    );
  }
  return parsed.spans.map((span) => richSpanHtml(span, css, colors, theme)).join("");
}

function richSpanHtml(
  span: RichTextSpan,
  css: TextCss,
  colors: RichTextColors,
  theme: VisualThemeDefinition,
): string {
  if (span.marks.length === 0) {
    return escapeHtmlText(span.text);
  }
  const styles: string[] = [];
  if (span.marks.includes("bold")) {
    styles.push("font-weight:700");
  }
  if (span.marks.includes("italic")) {
    styles.push("font-style:italic");
  }
  if (span.marks.includes("accent")) {
    styles.push(`color:${colors.accent}`);
  }
  if (span.marks.includes("outline")) {
    const glyphColor = span.marks.includes("accent") ? colors.accent : css.color;
    styles.push(`text-shadow:${outlineShadow(outlineColorFor(theme, glyphColor, colors.background))}`);
  }
  return `<span style="${styles.join(";")}">${escapeHtmlText(span.text)}</span>`;
}

function hasVisibleText(text: string): boolean {
  return parseRichText(text).spans.some((span) => span.text.trim().length > 0);
}

function richParagraph(
  text: string,
  css: TextCss,
  colors: RichTextColors,
  theme: VisualThemeDefinition,
  path: (string | number)[],
  extra = "",
): string {
  return `<p style="${textStyle(css, `white-space:pre-line;${extra}`)}">${richTextHtml(
    text,
    css,
    colors,
    theme,
    path,
  )}</p>`;
}

function badgeHtml(
  theme: VisualThemeDefinition,
  badge: string | undefined,
  path: (string | number)[],
): string {
  if (badge === undefined || !hasVisibleText(badge)) {
    return "";
  }
  const token = theme.textRoles.label;
  const background = theme.accents.secondary;
  const css: TextCss = {
    fontFamily: roleFontFamily(token),
    fontSize: `${scaledSize(token.fontSize, 1.6)}px`,
    color: theme.onMedia,
    fontWeight: "700",
    fontStyle: "normal",
    lineHeight: String(token.lineHeight),
  };
  const style = [
    "display:inline-block",
    `background:${background}`,
    `color:${css.color}`,
    `border-radius:${theme.radius.md}px`,
    `padding:8px 22px`,
    `font-family:${css.fontFamily}`,
    `font-size:${css.fontSize}`,
    `font-weight:${css.fontWeight}`,
    "letter-spacing:0.02em",
    "white-space:pre-line",
  ].join(";");
  const colors = richTextColors(theme, background);
  return `<span class="kakeai-thumb-badge" style="${style}">${richTextHtml(
    badge,
    css,
    colors,
    theme,
    path,
  )}</span>`;
}

function toneBackground(theme: VisualThemeDefinition, tone: "accent" | "canvas"): string {
  return tone === "accent" ? theme.accents.primary : theme.canvas.base;
}

function toneHeadlineColor(theme: VisualThemeDefinition, tone: "accent" | "canvas"): string {
  return tone === "accent" ? theme.onMedia : theme.textRoles.title.color;
}

function resolvePhoto(context: ThumbnailRenderContext, assetId: string, key = "assetId"): string {
  const media = resolveCueMedia(assetId, context.assetResolver, [...context.path, key]);
  if (media.kind !== "image") {
    throw new CompositionCompileError([
      {
        path: [...context.path, key],
        code: "invalid_asset_kind",
        message: "画像を指定してください。",
      },
    ]);
  }
  return escapeHtmlAttribute(media.url);
}

function overlayColor(theme: VisualThemeDefinition): string {
  return overlayToRgba({
    color: theme.scrim.color,
    opacity: PHOTO_COVER_MIN_SCRIM,
  });
}

const PHOTO_COVER_MIN_SCRIM = 0.7;

export function renderHeadlinePhoto(
  data: ThumbnailHeadlinePhotoInput,
  context: ThumbnailRenderContext,
): RenderedThumbnail {
  const photo = resolvePhoto(context, data.assetId);
  const crop = mediaCropStyle(data.focalPoint, data.zoom);
  const background = toneBackground(context.theme, data.tone);
  const headlineColor = toneHeadlineColor(context.theme, data.tone);
  const headline = textCss(context.theme.textRoles.title, 1.7, headlineColor);
  const subline = textCss(
    context.theme.textRoles.heading,
    1.1,
    mixHex(headlineColor, background, 0.2),
  );
  const colors = richTextColors(context.theme, background);

  const photoOnLeft = data.layout === "photo-left";
  const photoStyle = [
    "position:absolute",
    "top:0",
    "bottom:0",
    `${photoOnLeft ? "left" : "right"}:0`,
    "width:50%",
    "object-fit:cover",
    crop,
  ].join(";");
  const textWrapper = [
    "position:absolute",
    "top:0",
    "bottom:0",
    `${photoOnLeft ? "right" : "left"}:0`,
    "width:50%",
    "display:flex",
    "flex-direction:column",
    "justify-content:center",
    "gap:18px",
    "padding:56px 56px 56px 48px",
    "box-sizing:border-box",
  ].join(";");

  const html = [
    `<div class="kakeai-thumb" style="position:absolute;inset:0;background:${background}">`,
    `<img class="kakeai-thumb-photo" src="${photo}" alt="" style="${photoStyle}">`,
    `<div class="kakeai-thumb-text" style="${textWrapper}">`,
    badgeHtml(context.theme, data.badge, [...context.path, "badge"]),
    richParagraph(data.headline, headline, colors, context.theme, [...context.path, "headline"]),
    data.subline !== undefined && hasVisibleText(data.subline)
      ? richParagraph(data.subline, subline, colors, context.theme, [...context.path, "subline"])
      : "",
    "</div>",
    "</div>",
  ].join("");

  return { html, assetIds: [data.assetId] };
}

export function renderPhotoCover(
  data: ThumbnailPhotoCoverInput,
  context: ThumbnailRenderContext,
): RenderedThumbnail {
  const photo = resolvePhoto(context, data.assetId);
  const crop = mediaCropStyle(data.focalPoint, data.zoom);
  const { theme } = context;
  const headline = textCss(theme.textRoles.title, 1.7, theme.onMedia);
  const subline = textCss(theme.textRoles.heading, 1.1, theme.onMedia);
  const colors = richTextColors(theme, theme.scrim.color);

  const photoStyle = [
    "position:absolute",
    "inset:0",
    "width:100%",
    "height:100%",
    "object-fit:cover",
    crop,
  ].join(";");
  const scrimStyle = [
    "position:absolute",
    "inset:0",
    `background:linear-gradient(180deg, rgba(0,0,0,0) 35%, ${overlayColor(theme)} 100%)`,
  ].join(";");
  const textWrapper = [
    "position:absolute",
    "left:0",
    "right:0",
    "bottom:0",
    "display:flex",
    "flex-direction:column",
    "gap:12px",
    "padding:56px 64px",
    "box-sizing:border-box",
  ].join(";");

  const html = [
    `<div class="kakeai-thumb" style="position:absolute;inset:0;background:${theme.canvas.base}">`,
    `<img class="kakeai-thumb-photo" src="${photo}" alt="" style="${photoStyle}">`,
    `<div class="kakeai-thumb-scrim" style="${scrimStyle}"></div>`,
    `<div class="kakeai-thumb-text" style="${textWrapper}">`,
    richParagraph(data.headline, headline, colors, theme, [...context.path, "headline"]),
    data.subline !== undefined && hasVisibleText(data.subline)
      ? richParagraph(data.subline, subline, colors, theme, [...context.path, "subline"])
      : "",
    "</div>",
    "</div>",
  ].join("");

  return { html, assetIds: [data.assetId] };
}

type LayeredLayerKey = "main" | "character" | "text";

const LAYERED_STACK_ORDER: Record<ThumbnailLayeredInput["stack"], readonly LayeredLayerKey[]> = {
  "text-character-main": ["main", "character", "text"],
  "character-text-main": ["main", "text", "character"],
  "character-main-text": ["text", "main", "character"],
  "main-character-text": ["text", "character", "main"],
};

const LAYERED_Z_BASE = 10;

function layeredZIndex(stack: ThumbnailLayeredInput["stack"]): Record<LayeredLayerKey, number> {
  const zIndex: Record<LayeredLayerKey, number> = { main: 0, character: 0, text: 0 };
  LAYERED_STACK_ORDER[stack].forEach((key, index) => {
    zIndex[key] = LAYERED_Z_BASE + index;
  });
  return zIndex;
}

function layeredTextColors(
  theme: VisualThemeDefinition,
  hasBackground: boolean,
): { headline: string; subline: string } {
  if (hasBackground) {
    return { headline: theme.onMedia, subline: theme.onMedia };
  }
  return {
    headline: theme.textRoles.title.color,
    subline: mixHex(theme.textRoles.title.color, theme.canvas.base, 0.2),
  };
}

function layeredScrim(theme: VisualThemeDefinition): string {
  const edge = overlayToRgba({ color: theme.scrim.color, opacity: PHOTO_COVER_MIN_SCRIM });
  return [
    "position:absolute",
    "inset:0",
    `background:linear-gradient(180deg, ${edge} 0%, rgba(0,0,0,0) 28%, rgba(0,0,0,0) 72%, ${edge} 100%)`,
  ].join(";");
}

function layeredBackgroundHtml(
  data: ThumbnailLayeredInput,
  context: ThumbnailRenderContext,
  assetIds: string[],
): string {
  if (data.backgroundAssetId === undefined) {
    return "";
  }
  const url = resolvePhoto(context, data.backgroundAssetId, "backgroundAssetId");
  assetIds.push(data.backgroundAssetId);
  const crop = mediaCropStyle(data.backgroundFocalPoint, data.backgroundZoom);
  return `<img class="kakeai-thumb-bg" src="${url}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;${crop}">`;
}

function layeredMainHtml(
  data: ThumbnailLayeredInput,
  context: ThumbnailRenderContext,
  assetIds: string[],
  zIndex: number,
): string {
  if (data.mainAssetId === undefined) {
    return "";
  }
  const url = resolvePhoto(context, data.mainAssetId, "mainAssetId");
  assetIds.push(data.mainAssetId);
  const crop = mediaCropStyle(data.mainFocalPoint, data.mainZoom);
  const style = [
    "position:absolute",
    "top:18%",
    "bottom:24%",
    "left:12%",
    "right:12%",
    "object-fit:cover",
    `border-radius:${context.theme.radius.md}px`,
    `z-index:${zIndex}`,
    crop,
  ].join(";");
  return `<img class="kakeai-thumb-main" src="${url}" alt="" style="${style}">`;
}

const CHARACTER_PLACEMENT: Record<
  ThumbnailLayeredInput["characterPosition"],
  { horizontal: string; transform: string }
> = {
  left: { horizontal: "left:6%", transform: "" },
  center: { horizontal: "left:50%", transform: "transform:translateX(-50%)" },
  right: { horizontal: "right:6%", transform: "" },
};

function layeredCharacterHtml(
  data: ThumbnailLayeredInput,
  context: ThumbnailRenderContext,
  assetIds: string[],
  zIndex: number,
): string {
  if (data.characterAssetId === undefined) {
    return "";
  }
  const url = resolvePhoto(context, data.characterAssetId, "characterAssetId");
  assetIds.push(data.characterAssetId);
  const scale = data.characterScale ?? 1;
  const heightPercent = Math.round(72 * scale);
  const placement = CHARACTER_PLACEMENT[data.characterPosition];
  const style = [
    "position:absolute",
    "bottom:0",
    placement.horizontal,
    `height:${heightPercent}%`,
    "width:auto",
    "object-fit:contain",
    `z-index:${zIndex}`,
    placement.transform,
  ]
    .filter((segment) => segment.length > 0)
    .join(";");
  return `<img class="kakeai-thumb-character" src="${url}" alt="" style="${style}">`;
}

function layeredTextHtml(
  data: ThumbnailLayeredInput,
  context: ThumbnailRenderContext,
  zIndex: number,
): string {
  const hasBackground = data.backgroundAssetId !== undefined;
  const colors = layeredTextColors(context.theme, hasBackground);
  const headline = textCss(context.theme.textRoles.title, 1.5, colors.headline);
  const subline = textCss(context.theme.textRoles.heading, 1.1, colors.subline);
  const backdrop = hasBackground ? context.theme.scrim.color : context.theme.canvas.base;
  const richColors = richTextColors(context.theme, backdrop);
  const headlineStyle =
    "position:absolute;top:0;left:0;right:0;padding:44px 64px;text-align:center";
  const sublineStyle =
    "position:absolute;bottom:0;left:0;right:0;padding:36px 64px;text-align:center";
  return [
    `<div class="kakeai-thumb-text-layer" style="position:absolute;inset:0;z-index:${zIndex};pointer-events:none">`,
    hasBackground ? `<div class="kakeai-thumb-scrim" style="${layeredScrim(context.theme)}"></div>` : "",
    richParagraph(data.headline, headline, richColors, context.theme, [...context.path, "headline"], headlineStyle),
    data.subline !== undefined && hasVisibleText(data.subline)
      ? richParagraph(data.subline, subline, richColors, context.theme, [...context.path, "subline"], sublineStyle)
      : "",
    "</div>",
  ].join("");
}

export function renderLayered(
  data: ThumbnailLayeredInput,
  context: ThumbnailRenderContext,
): RenderedThumbnail {
  const assetIds: string[] = [];
  const zIndex = layeredZIndex(data.stack);
  const html = [
    `<div class="kakeai-thumb" style="position:absolute;inset:0;background:${context.theme.canvas.base};overflow:hidden">`,
    layeredBackgroundHtml(data, context, assetIds),
    layeredMainHtml(data, context, assetIds, zIndex.main),
    layeredCharacterHtml(data, context, assetIds, zIndex.character),
    layeredTextHtml(data, context, zIndex.text),
    "</div>",
  ].join("");
  return { html, assetIds };
}

export function renderTextOnly(
  data: ThumbnailTextInput,
  context: ThumbnailRenderContext,
): RenderedThumbnail {
  const background = toneBackground(context.theme, data.tone);
  const headlineColor = toneHeadlineColor(context.theme, data.tone);
  const headline = textCss(context.theme.textRoles.title, 1.8, headlineColor);
  const subline = textCss(
    context.theme.textRoles.heading,
    1.15,
    mixHex(headlineColor, background, 0.2),
  );

  const wrapper = [
    "position:absolute",
    "inset:0",
    "display:flex",
    "flex-direction:column",
    "justify-content:center",
    "align-items:center",
    "text-align:center",
    "gap:20px",
    "padding:72px 96px",
    "box-sizing:border-box",
  ].join(";");
  const colors = richTextColors(context.theme, background);

  const html = [
    `<div class="kakeai-thumb" style="position:absolute;inset:0;background:${background}">`,
    `<div class="kakeai-thumb-text" style="${wrapper}">`,
    badgeHtml(context.theme, data.badge, [...context.path, "badge"]),
    richParagraph(data.headline, headline, colors, context.theme, [...context.path, "headline"]),
    data.subline !== undefined && hasVisibleText(data.subline)
      ? richParagraph(data.subline, subline, colors, context.theme, [...context.path, "subline"])
      : "",
    "</div>",
    "</div>",
  ].join("");

  return { html, assetIds: [] };
}
