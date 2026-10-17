import {
  HANDMADE_PAPER_SKIN_REF,
  listCalloutInputSchema,
  listCalloutV1,
  mediaCardInputSchema,
  mediaCardV1,
  quoteInputSchema,
  quoteV1,
  textBlockV1,
  type VisualThemeDefinition,
  type VisualThemeTextRole,
} from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import { escapeCssFontFamily, escapeHtmlText } from "../escape";
import type {
  AnimationItem,
  RenderAnimationAction,
  RenderedCue,
  RenderContext,
  StateInterval,
} from "../render-context";
import { THEME_FONT_STACKS, mixHex, overlayToRgba } from "../theme";
import { onsetOverlayId } from "../cue-effects";
import { calloutItemOverlayHtml, planListCalloutEffects } from "../templates/list-callout";
import { renderMediaCardMedia } from "../templates/media-card";
import { applyQuoteEffects } from "../templates/quote";
import {
  ALIGN_ITEMS,
  JUSTIFY,
  resolveTextBlockSpec,
  textShadow,
  textSurfaceCss,
  type TextBlockRenderSpec,
} from "../templates/text-block";
import { toneHex } from "../templates/tone";
import type { ResolvedVisualSkin, VisualSkinTemplateRenderer } from "./types";

const SETTLE_DURATION_MS = 320;

interface PaperPalette {
  paper: string;
  paperEdge: string;
  shadow: string;
  fiberA: string;
  fiberB: string;
}

function paperPalette(theme: VisualThemeDefinition): PaperPalette {
  const base = theme.canvas.base;
  const ink = theme.canvas.ink;
  return {
    paper: mixHex(base, "#FFFFFF", 0.64),
    paperEdge: mixHex(base, ink, 0.16),
    shadow: overlayToRgba({ color: ink, opacity: 0.16 }),
    fiberA: overlayToRgba({ color: ink, opacity: 0.05 }),
    fiberB: overlayToRgba({ color: ink, opacity: 0.03 }),
  };
}

function handmadePaperSceneBackground(accentHex: string, theme: VisualThemeDefinition): string {
  const palette = paperPalette(theme);
  const warmTint = mixHex(accentHex, theme.canvas.base, 0.92);
  const bottomShade = mixHex(theme.canvas.base, theme.canvas.ink, 0.05);
  return [
    `repeating-linear-gradient(0deg, ${palette.fiberA} 0 1px, transparent 1px 6px)`,
    `repeating-linear-gradient(92deg, ${palette.fiberB} 0 1px, transparent 1px 8px)`,
    `radial-gradient(120% 90% at 18% 0%, ${overlayToRgba({ color: "#FFFFFF", opacity: 0.5 })}, transparent 62%)`,
    `linear-gradient(180deg, ${warmTint} 0%, ${theme.canvas.base} 58%, ${bottomShade} 100%)`,
    theme.canvas.base,
  ].join(", ");
}

const TORN_POINTS: readonly [number, number][] = [
  [0, 3],
  [7, 1.2],
  [14, 2.8],
  [22, 0.9],
  [30, 2.4],
  [39, 1.1],
  [47, 2.9],
  [55, 1.3],
  [63, 2.2],
  [72, 0.8],
  [80, 2.6],
  [88, 1.2],
  [94, 2.4],
  [100, 1.6],
];

function tornBottomClipPath(): string {
  const points = ["0% 0%", "100% 0%"];
  for (let index = TORN_POINTS.length - 1; index >= 0; index -= 1) {
    const [x, y] = TORN_POINTS[index]!;
    points.push(`${x}% calc(100% - ${y}px)`);
  }
  return `polygon(${points.join(",")})`;
}

interface TapeSpec {
  top?: string;
  bottom?: string;
  left?: string;
  right?: string;
  rotate: number;
  width: number;
  height: number;
}

function tapeHtml(spec: TapeSpec, shadow: string): string {
  const position = [
    spec.top !== undefined ? `top:${spec.top}` : "",
    spec.bottom !== undefined ? `bottom:${spec.bottom}` : "",
    spec.left !== undefined ? `left:${spec.left}` : "",
    spec.right !== undefined ? `right:${spec.right}` : "",
  ]
    .filter((part) => part.length > 0)
    .join(";");
  return `<span class="kakeai-paper-tape" style="position:absolute;${position};width:${spec.width}px;height:${spec.height}px;background:var(--kakeai-accent-soft);opacity:.9;transform:rotate(${spec.rotate}deg);clip-path:polygon(0 14%,4% 0,97% 5%,100% 86%,95% 100%,2% 93%);box-shadow:0 1px 3px ${shadow};"></span>`;
}

function slipHtml(options: {
  id: string;
  innerHtml: string;
  rotate: number;
  padding: string;
  palette: PaperPalette;
  textAlign?: string;
  tapes?: string;
  torn?: boolean;
}): string {
  const bodyStyle = [
    "position:relative",
    `background:${options.palette.paper}`,
    `box-shadow:inset 0 0 0 1px ${options.palette.paperEdge}`,
    "border-radius:6px",
    `padding:${options.padding}`,
    options.torn === true ? `clip-path:${tornBottomClipPath()}` : "",
    options.textAlign !== undefined ? `text-align:${options.textAlign}` : "",
  ]
    .filter((part) => part.length > 0)
    .join(";");
  return `<div id="${options.id}" class="kakeai-paper-slip" style="position:relative;filter:drop-shadow(0 12px 26px ${options.palette.shadow});transform:rotate(${options.rotate}deg);max-width:1600px;"><div class="kakeai-paper-slip-body" style="${bodyStyle}">${options.innerHtml}</div>${options.tapes ?? ""}</div>`;
}

function settleAnimation(
  targetId: string,
  action: RenderAnimationAction = "slide-up",
  startMs = 0,
  durationMs = SETTLE_DURATION_MS,
): AnimationItem {
  return { targetId, action, startMs, durationMs, ease: "normal" };
}

function themeTextCss(
  theme: VisualThemeDefinition,
  role: VisualThemeTextRole,
  options: { fontSize?: number; color?: string; weight?: string } = {},
): string {
  const token = theme.textRoles[role];
  const fontFamily =
    token.fontFace?.family !== undefined
      ? `${escapeCssFontFamily(token.fontFace.family)},${THEME_FONT_STACKS[token.font]}`
      : THEME_FONT_STACKS[token.font];
  return [
    "margin:0",
    `font-family:${fontFamily}`,
    `font-size:${options.fontSize ?? token.fontSize}px`,
    `color:${options.color ?? token.color}`,
    `font-weight:${options.weight ?? (token.decoration.bold ? "700" : "400")}`,
    `font-style:${token.decoration.italic ? "italic" : "normal"}`,
    `line-height:${token.lineHeight}`,
  ].join(";");
}

function specTextStyle(spec: TextBlockRenderSpec): string {
  return [
    "margin:0",
    `font-family:${spec.fontFamilyCss}`,
    `font-size:${spec.fontSize}px`,
    `color:${spec.color}`,
    `font-weight:${spec.decoration.bold ? "700" : "400"}`,
    `font-style:${spec.decoration.italic ? "italic" : "normal"}`,
    `line-height:${spec.lineHeight}`,
    "white-space:pre-line",
    `text-align:${spec.anchor}`,
    `text-shadow:${textShadow(spec.decoration)}`,
  ].join(";");
}

const PIECE_ROLES = new Set(["title", "heading", "subtitle", "closing"]);

const PIECE_ROTATE: Record<string, number> = {
  title: -0.7,
  heading: 0.5,
  subtitle: -0.4,
  closing: -0.4,
};

function renderHandmadeTextBlock(input: unknown, context: RenderContext): RenderedCue {
  const spec = resolveTextBlockSpec(input, context.path, context.theme);
  if (spec === null) {
    return { html: "", assetIds: [], animation: [] };
  }
  const palette = paperPalette(context.theme);
  const wrapperStyle = [
    "position:absolute",
    "inset:0",
    "display:flex",
    `justify-content:${JUSTIFY[spec.anchor]}`,
    `align-items:${ALIGN_ITEMS[spec.verticalAlign]}`,
    "padding:120px 140px",
    "box-sizing:border-box",
  ].join(";");

  if (spec.cueSurface !== undefined) {
    const style = [specTextStyle(spec), textSurfaceCss(spec.cueSurface)]
      .filter((part) => part.length > 0)
      .join(";");
    return {
      html: `<div class="kakeai-textblock" style="${wrapperStyle}"><p class="kakeai-textblock-text" style="${style}">${escapeHtmlText(spec.text)}</p></div>`,
      assetIds: [],
      animation: [],
    };
  }

  const textHtml = `<p class="kakeai-textblock-text" style="${specTextStyle(spec)}">${escapeHtmlText(spec.text)}</p>`;

  if (PIECE_ROLES.has(spec.role)) {
    const slipId = context.scope.id("slip");
    const rotate = PIECE_ROTATE[spec.role] ?? -0.4;
    const padding = spec.role === "title" ? "44px 88px 58px" : "32px 68px 44px";
    const tapes =
      spec.role === "title"
        ? tapeHtml({ top: "-15px", left: "38%", rotate: -5, width: 132, height: 32 }, palette.shadow)
        : tapeHtml({ top: "-13px", left: "46%", rotate: 4, width: 98, height: 26 }, palette.shadow);
    const html = `<div class="kakeai-textblock" style="${wrapperStyle}">${slipHtml({
      id: slipId,
      innerHtml: textHtml,
      rotate,
      padding,
      palette,
      textAlign: spec.anchor,
      tapes,
      torn: true,
    })}</div>`;
    return { html, assetIds: [], animation: [settleAnimation(slipId)] };
  }

  if (spec.role === "label") {
    const tagId = context.scope.id("tag");
    const style = [
      specTextStyle(spec),
      "display:inline-block",
      "background:var(--kakeai-accent-soft)",
      "padding:10px 28px 12px",
      "border-radius:4px",
      "transform:rotate(-0.8deg)",
      `box-shadow:0 2px 8px ${palette.shadow}`,
    ].join(";");
    return {
      html: `<div class="kakeai-textblock" style="${wrapperStyle}"><span id="${tagId}" class="kakeai-paper-tag" style="${style}">${escapeHtmlText(spec.text)}</span></div>`,
      assetIds: [],
      animation: [settleAnimation(tagId, "fade", 0, 260)],
    };
  }

  if (spec.role === "caption") {
    const stripId = context.scope.id("caption");
    const style = [
      specTextStyle(spec),
      `background:${palette.paper}`,
      "display:inline-block",
      "max-width:1600px",
      "padding:12px 36px 16px",
      "border-radius:4px",
      `box-shadow:inset 0 0 0 1px ${palette.paperEdge},0 8px 20px ${palette.shadow}`,
      "transform:rotate(0.4deg)",
    ].join(";");
    return {
      html: `<div class="kakeai-textblock" style="${wrapperStyle}"><span id="${stripId}" class="kakeai-paper-caption" style="${style}">${escapeHtmlText(spec.text)}</span></div>`,
      assetIds: [],
      animation: [settleAnimation(stripId, "fade", 0, 260)],
    };
  }

  return {
    html: `<div class="kakeai-textblock" style="${wrapperStyle}">${textHtml}</div>`,
    assetIds: [],
    animation: [],
  };
}

function renderHandmadeMediaCard(input: unknown, context: RenderContext): RenderedCue {
  const parsed = mediaCardInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path: context.path, code: "invalid_input", message: "media.card の入力が不正です。" },
    ]);
  }
  const data = parsed.data;
  const palette = paperPalette(context.theme);
  const frameId = context.scope.id("photo");
  const media = renderMediaCardMedia(data, context, "kakeai-paper-photo-clip", "overflow:hidden;border-radius:3px;");

  const notes: string[] = [];
  if (data.heading.length > 0) {
    notes.push(
      `<div class="kakeai-paper-note-heading" style="${themeTextCss(context.theme, "heading", { fontSize: Math.min(context.theme.textRoles.heading.fontSize, 52) })}">${escapeHtmlText(data.heading)}</div>`,
    );
  }
  if (data.caption !== undefined && data.caption.length > 0) {
    notes.push(
      `<div class="kakeai-paper-note-caption" style="${themeTextCss(context.theme, "body", { fontSize: Math.min(context.theme.textRoles.body.fontSize, 34) })}">${escapeHtmlText(data.caption)}</div>`,
    );
  }
  const noteHtml =
    notes.length === 0
      ? ""
      : `<div class="kakeai-paper-note" style="display:flex;flex-direction:column;gap:8px;text-align:center;padding:20px 16px 26px;">${notes.join("")}</div>`;

  const tapes =
    tapeHtml({ top: "-14px", left: "9%", rotate: -6, width: 120, height: 30 }, palette.shadow) +
    tapeHtml({ top: "-12px", right: "11%", rotate: 5, width: 104, height: 28 }, palette.shadow);

  return {
    html: `<figure class="kakeai-card kakeai-paper-photocard"><div id="${frameId}" class="kakeai-paper-photo" style="position:relative;filter:drop-shadow(0 18px 40px ${palette.shadow});transform:rotate(-0.7deg);">${tapes}<div class="kakeai-paper-photo-frame" style="position:relative;background:${palette.paper};padding:18px 18px 0;border-radius:4px;box-shadow:inset 0 0 0 1px ${palette.paperEdge};">${media.html}${noteHtml}</div></div></figure>`,
    assetIds: media.assetIds,
    animation: [settleAnimation(frameId, "scale-in")],
  };
}

function renderHandmadeListCallout(input: unknown, context: RenderContext): RenderedCue {
  const parsed = listCalloutInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path: context.path, code: "invalid_input", message: "list.callout の入力が不正です。" },
    ]);
  }
  const { title, items, appear } = parsed.data;
  const theme = context.theme;
  const palette = paperPalette(theme);
  const { itemIds, animation, stateIntervals } = planListCalloutEffects(items, appear, context);
  const slipIds = items.map((_item, index) => context.scope.id(`slip-${index}`));

  const titleHtml =
    title === undefined || title.trim().length === 0
      ? ""
      : `<figcaption class="kakeai-paper-callouttitle" style="${themeTextCss(theme, "heading", { fontSize: Math.min(theme.textRoles.heading.fontSize, 46) })}">${escapeHtmlText(title)}</figcaption>`;

  const itemsHtml = items
    .map((item, index) => {
      const effect = item.effect?.kind === "emphasize" ? item.effect : undefined;
      const rotate = (index % 2 === 0 ? -1 : 1) * (0.4 + (index % 3) * 0.2);
      const textHtml = `<span class="kakeai-paper-listtext" style="${themeTextCss(theme, "body", { fontSize: 40 })}">${escapeHtmlText(item.text)}</span>`;
      return `<li id="${itemIds[index]}" class="kakeai-paper-listitem" style="list-style:none;margin:0;position:relative;width:100%;">${slipHtml(
        {
          id: slipIds[index]!,
          innerHtml: textHtml,
          rotate,
          padding: "22px 38px 28px",
          palette,
          textAlign: "left",
        },
      )}${calloutItemOverlayHtml(itemIds[index]!, effect, theme)}</li>`;
    })
    .join("");

  const motion: AnimationItem[] =
    animation.length === 0 && stateIntervals.length === 0
      ? slipIds.map((slipId, index) =>
          settleAnimation(slipId, "slide-up", index * 70, SETTLE_DURATION_MS),
        )
      : [];

  return {
    html: `<figure class="kakeai-calloutwrap kakeai-paper-calloutwrap">${titleHtml}<ul class="kakeai-calloutlist kakeai-paper-calloutlist">${itemsHtml}</ul></figure>`,
    assetIds: [],
    animation: [...animation, ...motion],
    stateIntervals,
  };
}

function renderHandmadeQuote(input: unknown, context: RenderContext): RenderedCue {
  const parsed = quoteInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path: context.path, code: "invalid_input", message: "quote の入力が不正です。" },
    ]);
  }
  const { quote, author, source, style, effects } = parsed.data;
  const theme = context.theme;
  const palette = paperPalette(theme);
  const toneColor = toneHex(style?.tone ?? "primary", theme);
  const preset = style?.preset ?? "plain";
  const cardId = context.scope.id("card");
  const quoteId = context.scope.id("quote");
  const authorId = context.scope.id("author");
  const sourceId = context.scope.id("source");

  const animation: AnimationItem[] = [];
  const stateIntervals: StateInterval[] = [];
  const siblings: string[] = [];
  if (author !== undefined && author.trim().length > 0) {
    siblings.push(authorId);
  }
  if (source !== undefined && source.trim().length > 0) {
    siblings.push(sourceId);
  }
  let onsetInfo: { preset: string; color: string } | undefined;

  applyQuoteEffects({
    effects: effects ?? [],
    cardId,
    quoteId,
    siblings,
    theme,
    toneColor,
    lineIntervals: context.lineIntervals ?? [],
    spanMs: context.cueTiming?.spanMs ?? 0,
    path: context.path,
    animation,
    stateIntervals,
    markOnset: (presetName, color) => {
      if (onsetInfo === undefined) {
        onsetInfo = { preset: presetName, color };
      }
    },
  });

  const overlay =
    onsetInfo === undefined
      ? ""
      : `<span id="${onsetOverlayId(quoteId)}" class="kakeai-onsetoverlay kakeai-onset-${onsetInfo.preset}" style="--kakeai-onset-color:${onsetInfo.color}"></span>`;
  const quoteStyle = [
    themeTextCss(theme, "heading", {
      fontSize: Math.min(theme.textRoles.heading.fontSize, 52),
      color: toneColor,
    }),
    "position:relative",
    "white-space:pre-line",
  ].join(";");
  const quoteHtml = `<blockquote id="${quoteId}" class="kakeai-paper-quotetext" style="${quoteStyle}">${escapeHtmlText(quote)}${overlay}</blockquote>`;
  const quoteMarkHtml = `<span class="kakeai-paper-quotemark" style="display:block;font-size:96px;line-height:0.45;color:var(--kakeai-accent-soft);font-weight:700;">&ldquo;</span>`;
  const authorHtml =
    author === undefined || author.trim().length === 0
      ? ""
      : `<span id="${authorId}" class="kakeai-paper-quoteauthor" style="${themeTextCss(theme, "body", { fontSize: 30, weight: "700" })}">${escapeHtmlText(author)}</span>`;
  const sourceHtml =
    source === undefined || source.trim().length === 0
      ? ""
      : `<cite id="${sourceId}" class="kakeai-paper-quotesource" style="${themeTextCss(theme, "body", { fontSize: 28 })}">${escapeHtmlText(source)}</cite>`;
  const attribution =
    authorHtml.length === 0 && sourceHtml.length === 0
      ? ""
      : `<figcaption class="kakeai-paper-quoteattrib" style="display:flex;flex-wrap:wrap;align-items:baseline;justify-content:flex-end;gap:16px;margin-top:28px;padding-top:16px;border-top:2px dashed ${palette.paperEdge};">${authorHtml}${sourceHtml}</figcaption>`;
  const edgeShadow =
    preset === "card"
      ? `inset 0 0 0 2px ${palette.paperEdge}`
      : `inset 0 0 0 1px ${palette.paperEdge}`;

  return {
    html: `<figure class="kakeai-quotewrap kakeai-paper-quotewrap"><div id="${cardId}" class="kakeai-paper-quotecard" style="position:relative;max-width:1400px;filter:drop-shadow(0 14px 30px ${palette.shadow});transform:rotate(-0.5deg);">${tapeHtml(
      { top: "-14px", left: "42%", rotate: 4, width: 112, height: 28 },
      palette.shadow,
    )}<div class="kakeai-paper-quotebody" style="position:relative;background:${palette.paper};box-shadow:${edgeShadow};border-radius:6px;padding:52px 72px 44px;clip-path:${tornBottomClipPath()};">${quoteMarkHtml}${quoteHtml}${attribution}</div></div></figure>`,
    assetIds: [],
    animation: animation.length === 0 && stateIntervals.length === 0
      ? [settleAnimation(cardId, "slide-up", 0, 340)]
      : animation,
    stateIntervals,
  };
}

const templateRenderers: [string, VisualSkinTemplateRenderer][] = [
  [`${textBlockV1.id}@${textBlockV1.version}`, renderHandmadeTextBlock],
  [`${mediaCardV1.id}@${mediaCardV1.version}`, renderHandmadeMediaCard],
  [`${listCalloutV1.id}@${listCalloutV1.version}`, renderHandmadeListCallout],
  [`${quoteV1.id}@${quoteV1.version}`, renderHandmadeQuote],
];

export const handmadePaperSkin: ResolvedVisualSkin = {
  ref: HANDMADE_PAPER_SKIN_REF,
  templateRenderers: new Map(templateRenderers),
  sceneBackground: handmadePaperSceneBackground,
};
