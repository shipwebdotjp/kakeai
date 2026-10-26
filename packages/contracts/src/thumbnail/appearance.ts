import { z } from "zod";
import { accentColorSchema } from "../content/primitives";
import {
  fontFaceSpecSchema,
  resolveTextStyleFontFace,
  textStyleSchema,
  themeFontCategorySchema,
  visualThemeOverlaySchema,
  type TextStyle,
  type VisualThemeDefinition,
} from "../content/theme";

/**
 * Thumbnail Appearance is a sparse override layered over the current Visual
 * Theme. Every property is optional so an unset property keeps following the
 * Theme, while an explicit value stays fixed when the Theme changes.
 */
export const thumbnailTextAppearanceSchema = z.strictObject({
  font: themeFontCategorySchema.optional(),
  fontFace: fontFaceSpecSchema.optional(),
  fontSize: z.number().int().min(8).max(240).optional(),
  color: accentColorSchema.optional(),
  lineHeight: z.number().min(1).max(3).optional(),
  decoration: z
    .strictObject({
      bold: z.boolean().optional(),
      italic: z.boolean().optional(),
      outline: z.boolean().optional(),
      shadow: z.boolean().optional(),
    })
    .optional(),
  /**
   * Outline style shared by the whole-role `decoration.outline` and the `%%`
   * inline mark. `color` stays auto (contrast-derived) while unset.
   */
  outline: z
    .strictObject({
      color: accentColorSchema.optional(),
      width: z.number().min(0).max(12).optional(),
    })
    .optional(),
});
export type ThumbnailTextAppearance = z.infer<typeof thumbnailTextAppearanceSchema>;

export const thumbnailAppearanceSchema = z.strictObject({
  headline: thumbnailTextAppearanceSchema.optional(),
  subline: thumbnailTextAppearanceSchema.optional(),
  accent: accentColorSchema.optional(),
  scrim: z
    .strictObject({
      color: accentColorSchema.optional(),
      opacity: z.number().min(0).max(1).optional(),
    })
    .optional(),
});
export type ThumbnailAppearance = z.infer<typeof thumbnailAppearanceSchema>;

export const DEFAULT_THUMBNAIL_OUTLINE_WIDTH = 3;

export const resolvedThumbnailOutlineSchema = z.strictObject({
  color: accentColorSchema.nullable(),
  width: z.number().min(0).max(12),
});

export const resolvedThumbnailTextStyleSchema = textStyleSchema.extend({
  outline: resolvedThumbnailOutlineSchema,
});
export type ResolvedThumbnailTextStyle = z.infer<typeof resolvedThumbnailTextStyleSchema>;

export const resolvedThumbnailAppearanceSchema = z.strictObject({
  headline: resolvedThumbnailTextStyleSchema,
  subline: resolvedThumbnailTextStyleSchema,
  accent: accentColorSchema,
  scrim: visualThemeOverlaySchema,
});
export type ResolvedThumbnailAppearance = z.infer<typeof resolvedThumbnailAppearanceSchema>;

/**
 * The cutout template places both text roles on a photo, so the default text
 * color is the Theme's on-media neutral. Typography still comes from the
 * title/heading roles. A locale-specific font replaces the shared face before
 * any sparse appearance override is applied, so an explicit appearance font
 * still wins over the Theme.
 */
export function resolveThumbnailAppearanceDefaults(
  theme: VisualThemeDefinition,
  locale: string | undefined,
): ResolvedThumbnailAppearance {
  return {
    headline: {
      ...localizeTextStyle(theme.textRoles.title, locale),
      color: theme.onMedia,
      outline: { color: null, width: DEFAULT_THUMBNAIL_OUTLINE_WIDTH },
    },
    subline: {
      ...localizeTextStyle(theme.textRoles.heading, locale),
      color: theme.onMedia,
      outline: { color: null, width: DEFAULT_THUMBNAIL_OUTLINE_WIDTH },
    },
    accent: theme.accents.primary,
    scrim: { ...theme.scrim },
  };
}

/**
 * Materializes the locale font into `fontFace` and drops the dictionary, so a
 * later appearance override cannot be silently outranked by a stale locale
 * entry inherited from the Theme.
 */
function localizeTextStyle(style: TextStyle, locale: string | undefined): TextStyle {
  const { fontFaceByLocale: _dropped, ...rest } = style;
  const fontFace = resolveTextStyleFontFace(style, locale);
  return fontFace === undefined ? rest : { ...rest, fontFace };
}

function definedEntries<T extends object>(value: T | undefined): Partial<T> {
  if (value === undefined) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

function hasDecoration(
  decoration: ThumbnailTextAppearance["decoration"],
): boolean {
  return decoration !== undefined && Object.values(decoration).some((value) => value !== undefined);
}

function hasOutline(outline: ThumbnailTextAppearance["outline"]): boolean {
  return outline !== undefined && Object.values(outline).some((value) => value !== undefined);
}

function cleanDecoration(
  decoration: ThumbnailTextAppearance["decoration"],
): ThumbnailTextAppearance["decoration"] {
  const cleaned = definedEntries(decoration);
  return hasDecoration(cleaned) ? cleaned : undefined;
}

function cleanOutline(
  outline: ThumbnailTextAppearance["outline"],
): ThumbnailTextAppearance["outline"] {
  const cleaned = definedEntries(outline);
  return hasOutline(cleaned) ? cleaned : undefined;
}

function cleanTextAppearance(
  appearance: ThumbnailTextAppearance | undefined,
): ThumbnailTextAppearance | undefined {
  if (appearance === undefined) {
    return undefined;
  }
  const cleaned: ThumbnailTextAppearance = { ...definedEntries(appearance) };
  const decoration = cleanDecoration(appearance.decoration);
  if (decoration !== undefined) {
    cleaned.decoration = decoration;
  } else {
    delete cleaned.decoration;
  }
  const outline = cleanOutline(appearance.outline);
  if (outline !== undefined) {
    cleaned.outline = outline;
  } else {
    delete cleaned.outline;
  }
  return Object.keys(cleaned).length === 0 ? undefined : cleaned;
}

/** Drops empty groups so a reset property never survives as an empty object. */
export function normalizeThumbnailAppearance(
  appearance: ThumbnailAppearance | null | undefined,
): ThumbnailAppearance | null {
  if (appearance === null || appearance === undefined) {
    return null;
  }
  const cleaned: ThumbnailAppearance = {};
  const headline = cleanTextAppearance(appearance.headline);
  if (headline !== undefined) {
    cleaned.headline = headline;
  }
  const subline = cleanTextAppearance(appearance.subline);
  if (subline !== undefined) {
    cleaned.subline = subline;
  }
  if (appearance.accent !== undefined) {
    cleaned.accent = appearance.accent;
  }
  const scrim = definedEntries(appearance.scrim);
  if (Object.keys(scrim).length > 0) {
    cleaned.scrim = scrim;
  }
  return Object.keys(cleaned).length === 0 ? null : cleaned;
}

function mergeTextAppearance(
  base: ThumbnailTextAppearance | undefined,
  patch: ThumbnailTextAppearance | undefined,
): ThumbnailTextAppearance | undefined {
  if (base === undefined) {
    return cleanTextAppearance(patch);
  }
  if (patch === undefined) {
    return cleanTextAppearance(base);
  }
  const merged: ThumbnailTextAppearance = {
    ...definedEntries(base),
    ...definedEntries(patch),
  };
  const decoration = cleanDecoration({
    ...definedEntries(base.decoration),
    ...definedEntries(patch.decoration),
  });
  if (decoration !== undefined) {
    merged.decoration = decoration;
  } else {
    delete merged.decoration;
  }
  const outline = cleanOutline({
    ...definedEntries(base.outline),
    ...definedEntries(patch.outline),
  });
  if (outline !== undefined) {
    merged.outline = outline;
  } else {
    delete merged.outline;
  }
  return Object.keys(merged).length === 0 ? undefined : merged;
}

/** Merges the language-edition appearance with a candidate override. */
export function mergeThumbnailAppearance(
  base: ThumbnailAppearance | null | undefined,
  patch: ThumbnailAppearance | null | undefined,
): ThumbnailAppearance | null {
  if ((base === null || base === undefined) && (patch === null || patch === undefined)) {
    return null;
  }
  // `accent` is the only top-level key not recomputed below.
  const merged: ThumbnailAppearance = {};
  if (patch?.accent !== undefined) {
    merged.accent = patch.accent;
  } else if (base?.accent !== undefined) {
    merged.accent = base.accent;
  }
  const headline = mergeTextAppearance(base?.headline, patch?.headline);
  if (headline !== undefined) {
    merged.headline = headline;
  } else {
    delete merged.headline;
  }
  const subline = mergeTextAppearance(base?.subline, patch?.subline);
  if (subline !== undefined) {
    merged.subline = subline;
  } else {
    delete merged.subline;
  }
  const scrim = definedEntries({
    ...definedEntries(base?.scrim),
    ...definedEntries(patch?.scrim),
  });
  if (Object.keys(scrim).length > 0) {
    merged.scrim = scrim;
  } else {
    delete merged.scrim;
  }
  return normalizeThumbnailAppearance(merged);
}

function applyTextAppearance(
  base: ResolvedThumbnailTextStyle,
  patch: ThumbnailTextAppearance | undefined,
): ResolvedThumbnailTextStyle {
  if (patch === undefined) {
    return base;
  }
  const decoration = {
    ...base.decoration,
    ...definedEntries(patch.decoration),
  };
  return {
    ...base,
    ...(patch.font !== undefined ? { font: patch.font } : {}),
    ...(patch.fontFace !== undefined ? { fontFace: patch.fontFace } : {}),
    ...(patch.fontSize !== undefined ? { fontSize: patch.fontSize } : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    ...(patch.lineHeight !== undefined ? { lineHeight: patch.lineHeight } : {}),
    decoration,
    outline: {
      color: patch.outline?.color ?? base.outline.color,
      width: patch.outline?.width ?? base.outline.width,
    },
  };
}

/** Applies a merged sparse patch to resolved Theme defaults. */
export function applyThumbnailAppearance(
  base: ResolvedThumbnailAppearance,
  patch: ThumbnailAppearance | null | undefined,
): ResolvedThumbnailAppearance {
  if (patch === null || patch === undefined) {
    return base;
  }
  return {
    headline: applyTextAppearance(base.headline, patch.headline),
    subline: applyTextAppearance(base.subline, patch.subline),
    accent: patch.accent ?? base.accent,
    scrim: {
      color: patch.scrim?.color ?? base.scrim.color,
      opacity: patch.scrim?.opacity ?? base.scrim.opacity,
    },
  };
}
