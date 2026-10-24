import {
  parseRichText,
  type ResolvedThumbnailAppearance,
  type ResolvedThumbnailTextStyle,
  type RichTextSpan,
  type ThumbnailCutoutHeroInput,
  type ThumbnailSubjectAnchor,
  type VisualThemeDefinition,
} from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlAttribute, escapeHtmlText } from "../escape";
import { THUMBNAIL_OUTPUT_HEIGHT } from "../meta";
import type { AssetResolver } from "../resolver";
import {
  contrastRatio,
  hexToRgb,
  mixHex,
  overlayToRgba,
  resolveFontFamilyCss,
} from "../theme";
import { mediaCropStyle, resolveCueMedia } from "../templates/shared";

export interface ThumbnailRenderContext {
  theme: VisualThemeDefinition;
  assetResolver: AssetResolver;
  path: (string | number)[];
  appearance: ResolvedThumbnailAppearance;
  accentOverridden: boolean;
}

export interface RenderedThumbnail {
  html: string;
  assetIds: string[];
}

const THUMB_SCALE = THUMBNAIL_OUTPUT_HEIGHT / 1080;

function scaledSize(base: number, factor = 1): number {
  return Math.round(Math.min(200, Math.max(16, base * THUMB_SCALE * factor)));
}

interface TextCss {
  fontFamily: string;
  fontSize: string;
  color: string;
  fontWeight: string;
  fontStyle: string;
  lineHeight: string;
}

function textCss(style: ResolvedThumbnailTextStyle, factor: number): TextCss {
  return {
    fontFamily: resolveFontFamilyCss(style.fontFace, style.font),
    fontSize: `${scaledSize(style.fontSize, factor)}px`,
    color: style.color,
    fontWeight: style.decoration.bold ? "700" : "400",
    fontStyle: style.decoration.italic ? "italic" : "normal",
    lineHeight: String(style.lineHeight),
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
 * neutrals. An explicit appearance color wins without auto-adjustment.
 */
function resolveOutlineColor(
  theme: VisualThemeDefinition,
  textColor: string,
  background: string,
  explicit: string | null,
): string {
  if (explicit !== null) {
    return explicit;
  }
  const dark = theme.scrim.color;
  const light = theme.onMedia;
  const darkAgainstGlyph = contrastRatio(dark, textColor);
  const lightAgainstGlyph = contrastRatio(light, textColor);
  if (darkAgainstGlyph !== lightAgainstGlyph) {
    return darkAgainstGlyph > lightAgainstGlyph ? dark : light;
  }
  return contrastRatio(dark, background) >= contrastRatio(light, background) ? dark : light;
}

/**
 * Builds a filled outline from concentric rings of text shadows. The width is
 * authored on the same 1080-based scale as Theme font sizes.
 */
export function outlineShadow(color: string, widthBase: number): string {
  const width = Math.max(0, Math.min(12, Math.round(widthBase * THUMB_SCALE)));
  if (width === 0) {
    return "";
  }
  const { r, g, b } = hexToRgb(color);
  const shadows: string[] = [];
  for (let radius = 1; radius <= width; radius += 1) {
    const directions = [
      [radius, 0],
      [-radius, 0],
      [0, radius],
      [0, -radius],
      [radius, radius],
      [radius, -radius],
      [-radius, radius],
      [-radius, -radius],
    ];
    for (const [x, y] of directions) {
      shadows.push(`${x}px ${y}px 0 rgba(${r},${g},${b},.85)`);
    }
  }
  shadows.push(`0 0 ${Math.max(1, width)}px rgba(${r},${g},${b},.9)`);
  return shadows.join(",");
}

function baseTextShadow(theme: VisualThemeDefinition, background: string): string {
  const { r, g, b } = hexToRgb(background);
  return `0 2px 10px rgba(${r},${g},${b},.45)`;
}

function shadowDecoration(theme: VisualThemeDefinition): string {
  return `2px 4px 12px ${overlayToRgba(theme.shadow)}`;
}

function paragraphShadow(
  theme: VisualThemeDefinition,
  style: ResolvedThumbnailTextStyle,
  background: string,
  baseShadow: string,
): string {
  const parts = [baseShadow];
  if (style.decoration.outline) {
    const outline = outlineShadow(
      resolveOutlineColor(theme, style.color, background, style.outline.color),
      style.outline.width,
    );
    if (outline.length > 0) {
      parts.push(outline);
    }
  }
  if (style.decoration.shadow) {
    parts.push(shadowDecoration(theme));
  }
  return parts.filter((part) => part.length > 0).join(",");
}

interface RichTextColors {
  accent: string;
  background: string;
}

function richTextColors(
  theme: VisualThemeDefinition,
  background: string,
  accent: string,
  accentOverridden: boolean,
): RichTextColors {
  return {
    accent: accentOverridden ? accent : resolveReadableAccent(theme, "primary", background),
    background,
  };
}

function richTextHtml(
  text: string,
  css: TextCss,
  style: ResolvedThumbnailTextStyle,
  colors: RichTextColors,
  theme: VisualThemeDefinition,
  path: (string | number)[],
  inheritedShadow: string,
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
  return parsed.spans
    .map((span) => richSpanHtml(span, css, style, colors, theme, inheritedShadow))
    .join("");
}

function richSpanHtml(
  span: RichTextSpan,
  css: TextCss,
  style: ResolvedThumbnailTextStyle,
  colors: RichTextColors,
  theme: VisualThemeDefinition,
  inheritedShadow: string,
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
    const outline = outlineShadow(
      resolveOutlineColor(theme, glyphColor, colors.background, style.outline.color),
      style.outline.width,
    );
    const shadows = [outline, inheritedShadow]
      .filter((shadow) => shadow.length > 0)
      .join(",");
    if (shadows.length > 0) {
      styles.push(`text-shadow:${shadows}`);
    }
  }
  return `<span style="${styles.join(";")}">${escapeHtmlText(span.text)}</span>`;
}

function hasVisibleText(text: string): boolean {
  return parseRichText(text).spans.some((span) => span.text.trim().length > 0);
}

function richParagraph(options: {
  text: string;
  css: TextCss;
  style: ResolvedThumbnailTextStyle;
  colors: RichTextColors;
  theme: VisualThemeDefinition;
  path: (string | number)[];
  baseShadow: string;
  whiteSpace?: "pre-line" | "pre";
  extra?: string;
}): string {
  const {
    text,
    css,
    style,
    colors,
    theme,
    path,
    baseShadow,
    whiteSpace = "pre-line",
    extra = "",
  } = options;
  const shadow = paragraphShadow(theme, style, colors.background, baseShadow);
  // A span-level outline replaces the paragraph text-shadow, so the span list
  // includes the always-on shadow and the theme decoration shadow itself.
  const spanShadow = [
    baseShadow,
    style.decoration.shadow ? shadowDecoration(theme) : "",
  ]
    .filter((part) => part.length > 0)
    .join(",");
  const extraStyle = `white-space:${whiteSpace};${shadow.length > 0 ? `text-shadow:${shadow};` : ""}${extra}`;
  return `<p style="${textStyle(css, extraStyle)}">${richTextHtml(
    text,
    css,
    style,
    colors,
    theme,
    path,
    spanShadow,
  )}</p>`;
}

function resolvePhoto(context: ThumbnailRenderContext, assetId: string, key: string): string {
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

/**
 * Automatic headline sizing by visible character count. The factor is applied
 * to the resolved appearance font size; explicit appearance sizes still scale
 * down for longer copy.
 */
const SUBJECT_ANCHOR_ORIGINS: Record<ThumbnailSubjectAnchor, string> = {
  "bottom-center": "50% 100%",
  center: "50% 50%",
  "top-left": "0% 0%",
  "top-right": "100% 0%",
  "bottom-left": "0% 100%",
  "bottom-right": "100% 100%",
};

export function headlineFitFactor(text: string): number {
  const visible = parseRichText(text).spans.reduce(
    (total, span) => total + [...span.text].filter((character) => !/\s/u.test(character)).length,
    0,
  );
  if (visible <= 10) {
    return 1.7;
  }
  if (visible <= 18) {
    return 1.45;
  }
  if (visible <= 26) {
    return 1.2;
  }
  return 1;
}

export function renderCutoutHero(
  data: ThumbnailCutoutHeroInput,
  context: ThumbnailRenderContext,
): RenderedThumbnail {
  const background = resolvePhoto(context, data.backgroundAssetId, "backgroundAssetId");
  const foreground = resolvePhoto(context, data.foregroundAssetId, "foregroundAssetId");
  const crop = mediaCropStyle(data.backgroundFocalPoint, data.backgroundZoom);
  const appearance = context.appearance;
  const scrim = overlayToRgba(appearance.scrim);
  const scrimTransparent = overlayToRgba({ color: appearance.scrim.color, opacity: 0 });
  const baseShadow = baseTextShadow(context.theme, appearance.scrim.color);
  const colors = richTextColors(
    context.theme,
    appearance.scrim.color,
    appearance.accent,
    context.accentOverridden,
  );

  const backgroundStyle = [
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
    "z-index:1",
    // Interpolate from a transparent form of the scrim color so a non-black
    // scrim does not shift hue through the gradient's transparent end.
    `background:linear-gradient(180deg, ${scrimTransparent} 42%, ${scrim} 100%)`,
  ].join(";");
  const subjectCenterX = data.subjectSide === "right" ? 75 : 25;
  const subjectPositionStyle = [
    "position:absolute",
    "bottom:0",
    `left:${subjectCenterX}%`,
    "transform:translateX(-50%)",
    "height:78%",
    "z-index:2",
  ].join(";");
  const subjectScaleStyle = [
    "height:100%",
    "width:max-content",
    `transform:scale(${data.subjectScale})`,
    `transform-origin:${SUBJECT_ANCHOR_ORIGINS[data.subjectAnchor]}`,
  ].join(";");
  const subjectImageStyle = [
    "display:block",
    "height:100%",
    "width:auto",
    data.flipForeground ? "transform:scaleX(-1)" : "",
    "transform-origin:center",
  ]
    .filter((segment) => segment.length > 0)
    .join(";");
  const textOnLeft = data.subjectSide === "right";
  const textWrapper = [
    "position:absolute",
    "bottom:0",
    textOnLeft ? "left:0" : "right:0",
    `width:${data.textWidth}%`,
    "display:flex",
    "flex-direction:column",
    "justify-content:flex-end",
    textOnLeft ? "align-items:flex-start" : "align-items:flex-end",
    textOnLeft ? "text-align:left" : "text-align:right",
    "gap:10px",
    "padding:0 48px 48px",
    "box-sizing:border-box",
    "z-index:3",
  ].join(";");
  const whiteSpace = data.wrapText ? "pre-line" : "pre";

  const headlineCss = textCss(appearance.headline, headlineFitFactor(data.headline));
  const sublineCss = textCss(appearance.subline, 1);

  const html = [
    `<div class="kakeai-thumb" style="position:absolute;inset:0;overflow:hidden;background:${context.theme.canvas.ink}">`,
    `<img class="kakeai-thumb-bg" src="${background}" alt="" style="${backgroundStyle}">`,
    `<div class="kakeai-thumb-scrim" style="${scrimStyle}"></div>`,
    `<div class="kakeai-thumb-foreground" style="${subjectPositionStyle}">`,
    `<div class="kakeai-thumb-foreground-scale" style="${subjectScaleStyle}">`,
    `<img class="kakeai-thumb-foreground-image" src="${foreground}" alt="" style="${subjectImageStyle}">`,
    "</div>",
    "</div>",
    `<div class="kakeai-thumb-text" style="${textWrapper}">`,
    data.subline !== undefined && hasVisibleText(data.subline)
      ? richParagraph({
          text: data.subline,
          css: sublineCss,
          style: appearance.subline,
          colors,
          theme: context.theme,
          path: [...context.path, "subline"],
          baseShadow,
          whiteSpace,
        })
      : "",
    richParagraph({
      text: data.headline,
      css: headlineCss,
      style: appearance.headline,
      colors,
      theme: context.theme,
      path: [...context.path, "headline"],
      baseShadow,
      whiteSpace,
    }),
    "</div>",
    "</div>",
  ].join("");

  return { html, assetIds: [data.backgroundAssetId, data.foregroundAssetId] };
}
