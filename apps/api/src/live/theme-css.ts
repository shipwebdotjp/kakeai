import {
  resolveTextStyleFontFace,
  type LiveManifestFont,
  type VisualThemeDefinition,
} from "@kakeai/contracts";
import {
  THEME_FONT_STACKS,
  resolveFontFamilyCss,
  themeRootStyle,
} from "@kakeai/video";
import type { ThemeFontResolution } from "../services/font-catalog.ts";

const LIVE_TEXT_ROLES = [
  "title",
  "subtitle",
  "heading",
  "body",
  "closing",
  "caption",
  "label",
  "code",
] as const;

export function buildThemeCss(theme: VisualThemeDefinition, locale: string): string {
  const declarations = [themeRootStyle(theme, locale)];
  for (const role of LIVE_TEXT_ROLES) {
    const style = theme.textRoles[role];
    declarations.push(
      `--kakeai-font-${role}:${resolveFontFamilyCss(
        resolveTextStyleFontFace(style, locale),
        style.font,
        locale,
      )}`,
    );
  }
  return `:root{${declarations.join(";")}}\n`;
}

export function manifestFontsFromResolution(
  resolution: ThemeFontResolution,
): LiveManifestFont[] {
  return resolution.roles.map((role) => {
    const fallback = THEME_FONT_STACKS[role.category];
    return {
      role: role.role,
      family: role.localFaceName ?? fallback,
      found: !role.usesFallback,
      fallback,
      required: false,
    };
  });
}
