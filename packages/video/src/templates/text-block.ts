import {
  textBlockInputSchema,
  textBlockV2InputSchema,
  type TextRole,
  type ThemeFontCategory,
  type VisualThemeTextToken,
  type TextSurface,
  type VisualThemeDefinition,
} from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import { escapeCssFontFamily, escapeHtmlText } from "../escape";
import { THEME_FONT_STACKS, hexToRgb } from "../theme";

type TextAnchor = "left" | "center" | "right";
type VerticalAlign = "top" | "middle" | "bottom";

interface TextDecoration {
  bold: boolean;
  italic: boolean;
  outline: boolean;
  shadow: boolean;
}

interface RoleDefault {
  anchor: TextAnchor;
  verticalAlign: VerticalAlign;
  font: ThemeFontCategory;
  fontSize: number;
  color: string;
  lineHeight: number;
  decoration: TextDecoration;
}

const ROLE_DEFAULTS: Record<string, RoleDefault> = {
  title: {
    anchor: "center",
    verticalAlign: "middle",
    font: "sans",
    fontSize: 96,
    color: "#175C57",
    lineHeight: 1.4,
    decoration: { bold: true, italic: false, outline: false, shadow: false },
  },
  subtitle: {
    anchor: "center",
    verticalAlign: "middle",
    font: "sans",
    fontSize: 48,
    color: "#4E5A6B",
    lineHeight: 1.4,
    decoration: { bold: false, italic: false, outline: false, shadow: false },
  },
  heading: {
    anchor: "center",
    verticalAlign: "middle",
    font: "sans",
    fontSize: 72,
    color: "#175C57",
    lineHeight: 1.4,
    decoration: { bold: true, italic: false, outline: false, shadow: false },
  },
  body: {
    anchor: "center",
    verticalAlign: "middle",
    font: "sans",
    fontSize: 42,
    color: "#232B3D",
    lineHeight: 1.8,
    decoration: { bold: false, italic: false, outline: false, shadow: false },
  },
  closing: {
    anchor: "center",
    verticalAlign: "middle",
    font: "sans",
    fontSize: 48,
    color: "#232B3D",
    lineHeight: 1.4,
    decoration: { bold: true, italic: false, outline: false, shadow: false },
  },
  caption: {
    anchor: "center",
    verticalAlign: "bottom",
    font: "sans",
    fontSize: 40,
    color: "#FFFFFF",
    lineHeight: 1.5,
    decoration: { bold: false, italic: false, outline: false, shadow: true },
  },
  label: {
    anchor: "left",
    verticalAlign: "bottom",
    font: "sans",
    fontSize: 28,
    color: "#4E5A6B",
    lineHeight: 1.4,
    decoration: { bold: true, italic: false, outline: false, shadow: false },
  },
  code: {
    anchor: "left",
    verticalAlign: "middle",
    font: "mono",
    fontSize: 34,
    color: "#232B3D",
    lineHeight: 1.6,
    decoration: { bold: false, italic: false, outline: false, shadow: false },
  },
};

const JUSTIFY: Record<TextAnchor, string> = {
  left: "flex-start",
  center: "center",
  right: "flex-end",
};

const ALIGN_ITEMS: Record<VerticalAlign, string> = {
  top: "flex-start",
  middle: "center",
  bottom: "flex-end",
};

function textShadow(decoration: TextDecoration): string {
  const parts: string[] = [];
  if (decoration.shadow) {
    parts.push("0 2px 16px rgba(0,0,0,.55)");
  }
  if (decoration.outline) {
    parts.push(
      "0 0 2px rgba(0,0,0,.9)",
      "2px 2px 0 rgba(0,0,0,.7)",
      "-2px -2px 0 rgba(0,0,0,.7)",
    );
  }
  return parts.length === 0 ? "none" : parts.join(",");
}

function renderSurfaceStyle(surface: TextSurface | undefined): string {
  if (!surface || !surface.enabled) {
    return "";
  }
  const { r, g, b } = hexToRgb(surface.backgroundColor);
  const bg = `rgba(${r},${g},${b},${surface.backgroundOpacity})`;
  const styles = [
    `background:${bg}`,
    `padding:${surface.paddingVertical}px ${surface.paddingHorizontal}px`,
    `border-radius:${surface.borderRadius}px`,
  ];
  if (surface.border) {
    styles.push(`border:${surface.border.width}px solid ${surface.border.color}`);
  }
  return styles.join(";");
}

export function renderTextBlock(
  input: unknown,
  path: (string | number)[],
  theme: VisualThemeDefinition,
): string {
  const parsedV2 = textBlockV2InputSchema.safeParse(input);
  const parsedV1 = !parsedV2.success ? textBlockInputSchema.safeParse(input) : null;

  if (!parsedV2.success && (!parsedV1 || !parsedV1.success)) {
    throw new CompositionCompileError([
      { path, code: "invalid_input", message: "text.block の入力が不正です。" },
    ]);
  }

  const data: {
    text: string;
    role: string;
    anchor?: TextAnchor;
    verticalAlign?: VerticalAlign;
    font?: ThemeFontCategory;
    fontSize?: number;
    color?: string;
    lineHeight?: number;
    decoration?: Partial<TextDecoration>;
    fontFace?: { family: string; platformId?: string };
    surface?: TextSurface;
  } = parsedV2.success
    ? parsedV2.data
    : (parsedV1!.data as any);

  const { text, role } = data;
  if (text.trim().length === 0) {
    return "";
  }

  const themeToken = (theme.textRoles as Record<string, VisualThemeTextToken | undefined>)[role];
  const fallback = ROLE_DEFAULTS[role] ?? ROLE_DEFAULTS.body;
  const anchor = data.anchor ?? fallback.anchor;
  const verticalAlign = data.verticalAlign ?? fallback.verticalAlign;
  const font = data.font ?? themeToken?.font ?? fallback.font;
  const fontSize = data.fontSize ?? themeToken?.fontSize ?? fallback.fontSize;
  const color = (data.color ?? themeToken?.color ?? fallback.color).toUpperCase();
  const lineHeight = ("lineHeight" in data && typeof data.lineHeight === "number")
    ? data.lineHeight
    : themeToken?.lineHeight ?? fallback.lineHeight;

  const fontFaceSpec = "fontFace" in data ? data.fontFace : undefined;
  const themeFontFace = themeToken?.fontFace;
  const selectedFontFace = fontFaceSpec ?? themeFontFace;

  let fontFamilyCss = THEME_FONT_STACKS[font];
  if (selectedFontFace?.family) {
    fontFamilyCss = `${escapeCssFontFamily(selectedFontFace.family)},${THEME_FONT_STACKS[font]}`;
  }

  const decoration: TextDecoration = {
    bold: data.decoration?.bold ?? themeToken?.decoration.bold ?? fallback.decoration.bold,
    italic: data.decoration?.italic ?? themeToken?.decoration.italic ?? fallback.decoration.italic,
    outline: data.decoration?.outline ?? themeToken?.decoration.outline ?? fallback.decoration.outline,
    shadow: data.decoration?.shadow ?? themeToken?.decoration.shadow ?? fallback.decoration.shadow,
  };

  const surfaceFromCue = "surface" in data ? data.surface : undefined;
  const surfaceFromTheme = role === "caption" ? theme.surfaces?.caption : role === "label" ? theme.surfaces?.label : undefined;
  const surfaceToUse = surfaceFromCue ?? surfaceFromTheme;
  const surfaceCss = renderSurfaceStyle(surfaceToUse);

  const wrapperStyle = [
    "position:absolute",
    "inset:0",
    "display:flex",
    `justify-content:${JUSTIFY[anchor]}`,
    `align-items:${ALIGN_ITEMS[verticalAlign]}`,
    "padding:120px 140px",
    "box-sizing:border-box",
  ].join(";");

  const textStyle = [
    "margin:0",
    "max-width:1600px",
    `font-family:${fontFamilyCss}`,
    `font-size:${fontSize}px`,
    `color:${color}`,
    `font-weight:${decoration.bold ? "700" : "400"}`,
    `font-style:${decoration.italic ? "italic" : "normal"}`,
    `line-height:${lineHeight}`,
    "white-space:pre-line",
    `text-align:${anchor}`,
    `text-shadow:${textShadow(decoration)}`,
    surfaceCss,
  ].filter((s) => s.length > 0).join(";");

  return `<div class="kakeai-textblock" style="${wrapperStyle}"><p class="kakeai-textblock-text" style="${textStyle}">${escapeHtmlText(text)}</p></div>`;
}
