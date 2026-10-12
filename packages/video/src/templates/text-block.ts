import {
  textBlockInputSchema,
  type TextRole,
  type ThemeFontCategory,
  type VisualThemeTextToken,
} from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlText } from "../escape";
import { THEME_FONT_STACKS } from "../theme";

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

const ROLE_DEFAULTS: Record<TextRole, RoleDefault> = {
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

export function renderTextBlock(
  input: unknown,
  path: (string | number)[],
  theme: { textRoles: Record<TextRole, VisualThemeTextToken> },
): string {
  const parsed = textBlockInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path, code: "invalid_input", message: "text.block の入力が不正です。" },
    ]);
  }
  const { text, role } = parsed.data;
  if (text.trim().length === 0) {
    return "";
  }
  const themeToken = theme.textRoles[role];
  const fallback = ROLE_DEFAULTS[role];
  const anchor = parsed.data.anchor ?? fallback.anchor;
  const verticalAlign = parsed.data.verticalAlign ?? fallback.verticalAlign;
  const font = parsed.data.font ?? themeToken.font ?? fallback.font;
  const fontSize = parsed.data.fontSize ?? themeToken.fontSize ?? fallback.fontSize;
  const color = (parsed.data.color ?? themeToken.color ?? fallback.color).toUpperCase();
  const lineHeight = themeToken.lineHeight ?? fallback.lineHeight;
  const decoration: TextDecoration = {
    bold: parsed.data.decoration?.bold ?? themeToken.decoration.bold ?? fallback.decoration.bold,
    italic:
      parsed.data.decoration?.italic ?? themeToken.decoration.italic ?? fallback.decoration.italic,
    outline:
      parsed.data.decoration?.outline ??
      themeToken.decoration.outline ??
      fallback.decoration.outline,
    shadow:
      parsed.data.decoration?.shadow ??
      themeToken.decoration.shadow ??
      fallback.decoration.shadow,
  };

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
    `font-family:${THEME_FONT_STACKS[font]}`,
    `font-size:${fontSize}px`,
    `color:${color}`,
    `font-weight:${decoration.bold ? "700" : "400"}`,
    `font-style:${decoration.italic ? "italic" : "normal"}`,
    `line-height:${lineHeight}`,
    "white-space:pre-line",
    `text-align:${anchor}`,
    `text-shadow:${textShadow(decoration)}`,
  ].join(";");

  return `<div class="kakeai-textblock" style="${wrapperStyle}"><p class="kakeai-textblock-text" style="${textStyle}">${escapeHtmlText(text)}</p></div>`;
}
