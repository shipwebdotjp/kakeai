import { textBlockInputSchema, type TextRole } from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlText } from "../escape";

type TextAnchor = "left" | "center" | "right";
type VerticalAlign = "top" | "middle" | "bottom";
type FontName = "sans" | "serif" | "mono";

interface TextDecoration {
  bold: boolean;
  italic: boolean;
  outline: boolean;
  shadow: boolean;
}

interface RoleDefault {
  anchor: TextAnchor;
  verticalAlign: VerticalAlign;
  font: FontName;
  fontSize: number;
  color: string;
  decoration: TextDecoration;
}

const ROLE_DEFAULTS: Record<TextRole, RoleDefault> = {
  title: {
    anchor: "center",
    verticalAlign: "middle",
    font: "sans",
    fontSize: 96,
    color: "#FFFFFF",
    decoration: { bold: true, italic: false, outline: false, shadow: true },
  },
  subtitle: {
    anchor: "center",
    verticalAlign: "middle",
    font: "sans",
    fontSize: 48,
    color: "#FFFFFF",
    decoration: { bold: false, italic: false, outline: false, shadow: true },
  },
  heading: {
    anchor: "center",
    verticalAlign: "middle",
    font: "sans",
    fontSize: 72,
    color: "#FFFFFF",
    decoration: { bold: true, italic: false, outline: false, shadow: true },
  },
  body: {
    anchor: "center",
    verticalAlign: "middle",
    font: "sans",
    fontSize: 42,
    color: "#FFFFFF",
    decoration: { bold: false, italic: false, outline: false, shadow: true },
  },
  closing: {
    anchor: "center",
    verticalAlign: "middle",
    font: "sans",
    fontSize: 48,
    color: "#FFFFFF",
    decoration: { bold: true, italic: false, outline: false, shadow: true },
  },
};

const FONT_STACKS: Record<FontName, string> = {
  sans: "'Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic','Meiryo',sans-serif",
  serif: "'Hiragino Mincho ProN','Yu Mincho','MS PMincho',serif",
  mono: "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace",
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

export function renderTextBlock(input: unknown, path: (string | number)[]): string {
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
  const roleDefault = ROLE_DEFAULTS[role];
  const anchor = parsed.data.anchor ?? roleDefault.anchor;
  const verticalAlign = parsed.data.verticalAlign ?? roleDefault.verticalAlign;
  const font = parsed.data.font ?? roleDefault.font;
  const fontSize = parsed.data.fontSize ?? roleDefault.fontSize;
  const color = (parsed.data.color ?? roleDefault.color).toUpperCase();
  const decoration: TextDecoration = {
    bold: parsed.data.decoration?.bold ?? roleDefault.decoration.bold,
    italic: parsed.data.decoration?.italic ?? roleDefault.decoration.italic,
    outline: parsed.data.decoration?.outline ?? roleDefault.decoration.outline,
    shadow: parsed.data.decoration?.shadow ?? roleDefault.decoration.shadow,
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
    `font-family:${FONT_STACKS[font]}`,
    `font-size:${fontSize}px`,
    `color:${color}`,
    `font-weight:${decoration.bold ? "700" : "400"}`,
    `font-style:${decoration.italic ? "italic" : "normal"}`,
    `line-height:${role === "body" ? "1.8" : "1.4"}`,
    "white-space:pre-line",
    `text-align:${anchor}`,
    `text-shadow:${textShadow(decoration)}`,
  ].join(";");

  return `<div class="kakeai-textblock" style="${wrapperStyle}"><p class="kakeai-textblock-text" style="${textStyle}">${escapeHtmlText(text)}</p></div>`;
}
