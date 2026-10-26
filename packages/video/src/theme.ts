import {
  asSupportedLocale,
  getVisualTheme,
  resolveTextStyleFontFace,
  type ContentDocument,
  type Scene,
  type SupportedLocale,
  type TextStyle,
  type ThemeFontCategory,
  type VisualThemeDefinition,
  type VisualThemeOverlay,
} from "@kakeai/contracts";
import { CompositionCompileError } from "./compile-error";
import { escapeCssFontFamily, escapeHtmlAttribute } from "./escape";

export { resolveTextStyleFontFace };

const JA_SANS =
  "'Noto Sans JP','Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic','Meiryo',sans-serif";
const JA_SERIF = "'Hiragino Mincho ProN','Yu Mincho','MS PMincho',serif";
const LATIN_MONO = "'SFMono-Regular',Consolas,'Liberation Mono',Menlo";

/** Locale-agnostic defaults. `ja-JP` and `en-US` keep using these stacks. */
export const THEME_FONT_STACKS: Record<ThemeFontCategory, string> = {
  sans: JA_SANS,
  serif: JA_SERIF,
  mono: `${LATIN_MONO},monospace`,
};

const LOCALE_FONT_STACKS: Partial<Record<SupportedLocale, Record<ThemeFontCategory, string>>> = {
  "zh-Hans": {
    sans: "'PingFang SC','Noto Sans SC','Noto Sans SC CJK','Hiragino Sans GB','Microsoft YaHei','Source Han Sans SC',sans-serif",
    serif: "'Songti SC','Noto Serif SC','Noto Serif SC CJK','SimSun','Source Han Serif SC',serif",
    // CJK fallback stays before the generic family so a missing glyph does not
    // drop straight to the OS default monospace face.
    mono: `${LATIN_MONO},'PingFang SC','Noto Sans SC',monospace`,
  },
  "zh-Hant": {
    sans: "'PingFang TC','Noto Sans TC','Noto Sans TC CJK','Microsoft JhengHei','Source Han Sans TC',sans-serif",
    serif: "'Songti TC','Noto Serif TC','Noto Serif TC CJK','PMingLiU','Source Han Serif TC',serif",
    mono: `${LATIN_MONO},'PingFang TC','Noto Sans TC',monospace`,
  },
};

/** The category fallback stack for a document locale. */
export function themeFontStack(
  category: ThemeFontCategory,
  locale: string | undefined,
): string {
  const parsed = asSupportedLocale(locale);
  const localized = parsed === undefined ? undefined : LOCALE_FONT_STACKS[parsed];
  return localized?.[category] ?? THEME_FONT_STACKS[category];
}

/**
 * Resolves a full `font-family` value for one text style: locale override,
 * shared face, then the locale category stack. Single place for the precedence
 * rules shared by captions, templates, skins, and thumbnails.
 */
export function resolveTextStyleFontFamilyCss(
  style: Pick<TextStyle, "font" | "fontFace" | "fontFaceByLocale">,
  locale: string | undefined,
): string {
  return resolveFontFamilyCss(
    resolveTextStyleFontFace(style, locale),
    style.font,
    locale,
  );
}

/**
 * Font names that identify a single local face, not just a family. The
 * platform identifier is a PostScript name, which Chromium resolves as a
 * family name on macOS; without it a family with several faces renders
 * whichever face the platform prefers.
 */
export interface FontFaceNames {
  platformId?: string;
  family?: string;
}

/** Resolves the font family of one theme text role for inline template styles. */
function themeRoleFont(
  theme: VisualThemeDefinition,
  role: keyof VisualThemeDefinition["textRoles"],
  locale: string | undefined,
): string {
  return resolveTextStyleFontFamilyCss(theme.textRoles[role], locale);
}

/** Ready-made `font-family` declaration for a template's `style` attribute. */
export function themeRoleFontStyle(
  theme: VisualThemeDefinition,
  role: keyof VisualThemeDefinition["textRoles"],
  locale: string | undefined,
): string {
  return `font-family:${escapeHtmlAttribute(themeRoleFont(theme, role, locale))}`;
}

/**
 * Builds the `font-family` value for a theme text role: the selected local
 * face first, then its family, then the locale category stack as a last
 * resort. Values come from the Font Catalog, never from free user input, and
 * every name is escaped before it reaches CSS.
 */
export function resolveFontFamilyCss(
  fontFace: FontFaceNames | undefined,
  category: ThemeFontCategory,
  locale: string | undefined,
): string {
  const names: string[] = [];
  const push = (name: string | undefined): void => {
    const trimmed = name?.trim();
    if (trimmed === undefined || trimmed.length === 0) {
      return;
    }
    if (names.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
      return;
    }
    names.push(trimmed);
  };
  push(fontFace?.platformId);
  push(fontFace?.family);

  const stack = themeFontStack(category, locale);
  if (names.length === 0) {
    return stack;
  }
  return `${names.map(escapeCssFontFamily).join(",")},${stack}`;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function channelToHex(channel: number): string {
  return Math.max(0, Math.min(255, Math.round(channel)))
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
}

export function rgbToHex(rgb: Rgb): string {
  return `#${channelToHex(rgb.r)}${channelToHex(rgb.g)}${channelToHex(rgb.b)}`;
}

export function mixHex(base: string, target: string, amount: number): string {
  const from = hexToRgb(base);
  const to = hexToRgb(target);
  return rgbToHex({
    r: from.r + (to.r - from.r) * amount,
    g: from.g + (to.g - from.g) * amount,
    b: from.b + (to.b - from.b) * amount,
  });
}

export function overlayToRgba(overlay: VisualThemeOverlay): string {
  const { r, g, b } = hexToRgb(overlay.color);
  return `rgba(${r},${g},${b},${overlay.opacity})`;
}

function linearChannel(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b);
}

export function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

export function resolveVisualTheme(document: ContentDocument): VisualThemeDefinition {
  const theme = getVisualTheme(document.visualTheme.id, document.visualTheme.version);
  if (theme === undefined) {
    throw new CompositionCompileError([
      {
        path: ["visualTheme"],
        code: "unknown_theme",
        message: `未対応のVisual Themeです: ${document.visualTheme.id}@${document.visualTheme.version}`,
      },
    ]);
  }
  return theme;
}

export function resolveSceneAccentHex(scene: Scene, theme: VisualThemeDefinition): string {
  if (scene.accent.kind === "custom") {
    return scene.accent.color.toUpperCase();
  }
  return theme.accents[scene.accent.token];
}

export function accentSoftHex(accentHex: string, theme: VisualThemeDefinition): string {
  return mixHex(accentHex, theme.canvas.base, 0.8);
}

export function accentForegroundHex(softHex: string, theme: VisualThemeDefinition): string {
  return contrastRatio(softHex, "#FFFFFF") >= contrastRatio(softHex, theme.text)
    ? "#FFFFFF"
    : theme.text;
}

export function themeRootStyle(theme: VisualThemeDefinition, locale: string | undefined): string {
  return [
    `--kakeai-canvas:${theme.canvas.base}`,
    `--kakeai-ink:${theme.canvas.ink}`,
    `--kakeai-surface:${theme.surface}`,
    `--kakeai-surface-muted:${theme.surfaceMuted}`,
    `--kakeai-text:${theme.text}`,
    `--kakeai-muted:${theme.muted}`,
    `--kakeai-border:${theme.border}`,
    `--kakeai-onmedia:${theme.onMedia}`,
    `--kakeai-scrim:${overlayToRgba(theme.scrim)}`,
    `--kakeai-shadow:${overlayToRgba(theme.shadow)}`,
    `--kakeai-radius-sm:${theme.radius.sm}px`,
    `--kakeai-radius-md:${theme.radius.md}px`,
    `--kakeai-radius-lg:${theme.radius.lg}px`,
    `--kakeai-accent-primary:${theme.accents.primary}`,
    `--kakeai-accent-secondary:${theme.accents.secondary}`,
    `--kakeai-accent-tertiary:${theme.accents.tertiary}`,
    `--kakeai-font-sans:${themeFontStack("sans", locale)}`,
    `--kakeai-font-serif:${themeFontStack("serif", locale)}`,
    `--kakeai-font-mono:${themeFontStack("mono", locale)}`,
  ].join(";");
}

export function sceneAccentStyle(accentHex: string, theme: VisualThemeDefinition): string {
  const soft = accentSoftHex(accentHex, theme);
  return [
    `--kakeai-accent:${accentHex}`,
    `--kakeai-accent-soft:${soft}`,
    `--kakeai-accent-fg:${accentForegroundHex(soft, theme)}`,
  ].join(";");
}
