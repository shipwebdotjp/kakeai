import {
  getVisualTheme,
  type ContentDocument,
  type Scene,
  type ThemeFontCategory,
  type VisualThemeDefinition,
  type VisualThemeOverlay,
} from "@kakeai/contracts";
import { CompositionCompileError } from "./compile-error";

export const THEME_FONT_STACKS: Record<ThemeFontCategory, string> = {
  sans: "'Noto Sans JP','Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic','Meiryo',sans-serif",
  serif: "'Hiragino Mincho ProN','Yu Mincho','MS PMincho',serif",
  mono: "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace",
};

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

export function themeRootStyle(theme: VisualThemeDefinition): string {
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
    `--kakeai-font-sans:${THEME_FONT_STACKS.sans}`,
    `--kakeai-font-serif:${THEME_FONT_STACKS.serif}`,
    `--kakeai-font-mono:${THEME_FONT_STACKS.mono}`,
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
