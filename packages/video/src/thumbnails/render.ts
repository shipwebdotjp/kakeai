import {
  type ThumbnailHeadlinePhotoInput,
  type ThumbnailPhotoCoverInput,
  type ThumbnailTextInput,
  type VisualThemeDefinition,
  type VisualThemeTextToken,
} from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlAttribute, escapeHtmlText } from "../escape";
import { THUMBNAIL_OUTPUT_HEIGHT } from "../meta";
import type { AssetResolver } from "../resolver";
import { THEME_FONT_STACKS, mixHex, overlayToRgba } from "../theme";
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
  return THEME_FONT_STACKS[token.font];
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

function badgeHtml(theme: VisualThemeDefinition, badge: string | undefined): string {
  if (badge === undefined || badge.trim().length === 0) {
    return "";
  }
  const token = theme.textRoles.label;
  const style = [
    "display:inline-block",
    `background:${theme.accents.secondary}`,
    `color:${theme.onMedia}`,
    `border-radius:${theme.radius.md}px`,
    `padding:8px 22px`,
    `font-family:${roleFontFamily(token)}`,
    `font-size:${scaledSize(token.fontSize, 1.6)}px`,
    "font-weight:700",
    "letter-spacing:0.02em",
  ].join(";");
  return `<span class="kakeai-thumb-badge" style="${style}">${escapeHtmlText(badge)}</span>`;
}

function toneBackground(theme: VisualThemeDefinition, tone: "accent" | "canvas"): string {
  return tone === "accent" ? theme.accents.primary : theme.canvas.base;
}

function toneHeadlineColor(theme: VisualThemeDefinition, tone: "accent" | "canvas"): string {
  return tone === "accent" ? theme.onMedia : theme.textRoles.title.color;
}

function resolvePhoto(context: ThumbnailRenderContext, assetId: string): string {
  const media = resolveCueMedia(assetId, context.assetResolver, context.path);
  if (media.kind !== "image") {
    throw new CompositionCompileError([
      {
        path: [...context.path, "assetId"],
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
    badgeHtml(context.theme, data.badge),
    `<p style="${textStyle(headline)}">${escapeHtmlText(data.headline)}</p>`,
    data.subline !== undefined && data.subline.trim().length > 0
      ? `<p style="${textStyle(subline)}">${escapeHtmlText(data.subline)}</p>`
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
    `<p style="${textStyle(headline)}">${escapeHtmlText(data.headline)}</p>`,
    data.subline !== undefined && data.subline.trim().length > 0
      ? `<p style="${textStyle(subline)}">${escapeHtmlText(data.subline)}</p>`
      : "",
    "</div>",
    "</div>",
  ].join("");

  return { html, assetIds: [data.assetId] };
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

  const html = [
    `<div class="kakeai-thumb" style="position:absolute;inset:0;background:${background}">`,
    `<div class="kakeai-thumb-text" style="${wrapper}">`,
    badgeHtml(context.theme, data.badge),
    `<p style="${textStyle(headline)}">${escapeHtmlText(data.headline)}</p>`,
    data.subline !== undefined && data.subline.trim().length > 0
      ? `<p style="${textStyle(subline)}">${escapeHtmlText(data.subline)}</p>`
      : "",
    "</div>",
    "</div>",
  ].join("");

  return { html, assetIds: [] };
}
