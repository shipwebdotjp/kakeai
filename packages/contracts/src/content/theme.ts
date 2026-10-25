import { z } from "zod";
import { accentColorSchema, nonNegativeInt, positiveInt } from "./primitives";

export const visualThemeRefSchema = z.strictObject({
  id: z.string().min(1),
  version: positiveInt,
});
export type VisualThemeRef = z.infer<typeof visualThemeRefSchema>;

export const visualSkinRefSchema = z.strictObject({
  id: z.string().min(1),
  version: positiveInt,
});
export type VisualSkinRef = z.infer<typeof visualSkinRefSchema>;

export const visualSkinDefinitionSchema = z.strictObject({
  id: z.string().min(1),
  version: positiveInt,
  name: z.string().min(1),
  description: z.string().min(1),
});
export type VisualSkinDefinition = z.infer<typeof visualSkinDefinitionSchema>;

export const NEUTRAL_VISUAL_SKIN_ID = "neutral" as const;
export const NEUTRAL_VISUAL_SKIN_VERSION = 1 as const;

export const HANDMADE_PAPER_SKIN_ID = "handmade-paper" as const;
export const HANDMADE_PAPER_SKIN_VERSION = 1 as const;

export const NEUTRAL_VISUAL_SKIN_REF: VisualSkinRef = {
  id: NEUTRAL_VISUAL_SKIN_ID,
  version: NEUTRAL_VISUAL_SKIN_VERSION,
};

export const HANDMADE_PAPER_SKIN_REF: VisualSkinRef = {
  id: HANDMADE_PAPER_SKIN_ID,
  version: HANDMADE_PAPER_SKIN_VERSION,
};

export const visualSkinDefinitions: readonly VisualSkinDefinition[] = [
  {
    id: NEUTRAL_VISUAL_SKIN_ID,
    version: NEUTRAL_VISUAL_SKIN_VERSION,
    name: "Neutral",
    description: "Visual Template標準のTheme準拠描画。全Templateへのfallbackを持つ。",
  },
  {
    id: HANDMADE_PAPER_SKIN_ID,
    version: HANDMADE_PAPER_SKIN_VERSION,
    name: "Handmade Paper",
    description: "温かな紙と控えめなテープで情報を整理した編集ノート風の世界観。",
  },
];

export const visualSkinRegistry: ReadonlyMap<string, VisualSkinDefinition> = new Map(
  visualSkinDefinitions.map((definition) => [`${definition.id}@${definition.version}`, definition]),
);

export function getVisualSkinDefinition(
  id: string,
  version: number,
): VisualSkinDefinition | undefined {
  return visualSkinRegistry.get(`${id}@${version}`);
}

export function isKnownVisualSkinRef(ref: VisualSkinRef): boolean {
  return visualSkinRegistry.has(`${ref.id}@${ref.version}`);
}

export function listVisualSkinDefinitions(): VisualSkinDefinition[] {
  return [...visualSkinDefinitions];
}

export const knownVisualSkinRefSchema = visualSkinRefSchema.refine(
  (ref) => isKnownVisualSkinRef(ref),
  { message: "未対応のVisual Skinです" },
);

export const themeAccentTokenSchema = z.enum(["primary", "secondary", "tertiary"]);
export type ThemeAccentToken = z.infer<typeof themeAccentTokenSchema>;
export const THEME_ACCENT_TOKENS = themeAccentTokenSchema.options;

const themeHexSchema = accentColorSchema;

export const themeFontCategorySchema = z.enum(["sans", "serif", "mono"]);
export type ThemeFontCategory = z.infer<typeof themeFontCategorySchema>;

export const visualThemeTextRoleSchema = z.enum([
  "title",
  "subtitle",
  "heading",
  "body",
  "closing",
  "caption",
  "label",
  "code",
]);
export type VisualThemeTextRole = z.infer<typeof visualThemeTextRoleSchema>;

export const visualThemeDecorationSchema = z.strictObject({
  bold: z.boolean(),
  italic: z.boolean(),
  outline: z.boolean(),
  shadow: z.boolean(),
});
export type VisualThemeDecoration = z.infer<typeof visualThemeDecorationSchema>;

export const fontFaceSpecSchema = z.strictObject({
  platformId: z.string().min(1).optional(),
  family: z.string().min(1),
  style: z.enum(["normal", "italic", "oblique"]).default("normal"),
  weight: z.union([z.number().int().min(100).max(900), z.string()]).default(400),
  fallbacks: z.array(z.string()).default([]),
});
export type FontFaceSpec = z.infer<typeof fontFaceSpecSchema>;

export const textStyleSchema = z.strictObject({
  font: themeFontCategorySchema,
  fontFace: fontFaceSpecSchema.optional(),
  fontSize: z.number().int().min(8).max(240),
  color: themeHexSchema,
  lineHeight: z.number().min(1).max(3),
  decoration: visualThemeDecorationSchema,
});
export type TextStyle = z.infer<typeof textStyleSchema>;

export const visualThemeTextTokenSchema = textStyleSchema;
export type VisualThemeTextToken = z.infer<typeof visualThemeTextTokenSchema>;

export const textSurfaceSchema = z.strictObject({
  enabled: z.boolean(),
  backgroundColor: themeHexSchema,
  backgroundOpacity: z.number().min(0).max(1),
  paddingHorizontal: nonNegativeInt,
  paddingVertical: nonNegativeInt,
  borderRadius: nonNegativeInt,
  border: z
    .strictObject({
      color: themeHexSchema,
      width: nonNegativeInt,
    })
    .optional(),
});
export type TextSurface = z.infer<typeof textSurfaceSchema>;

export const visualThemeOverlaySchema = z.strictObject({
  color: themeHexSchema,
  opacity: z.number().min(0).max(1),
});
export type VisualThemeOverlay = z.infer<typeof visualThemeOverlaySchema>;

const visualThemeDefinitionV1Fields = {
  themeDefinitionSchemaVersion: z.literal(1).default(1),
  id: z.string().min(1),
  version: positiveInt,
  name: z.string().min(1).optional(),
  canvas: z.strictObject({
    base: themeHexSchema,
    ink: themeHexSchema,
  }),
  accents: z.strictObject({
    primary: themeHexSchema,
    secondary: themeHexSchema,
    tertiary: themeHexSchema,
  }),
  surface: themeHexSchema,
  surfaceMuted: themeHexSchema,
  text: themeHexSchema,
  muted: themeHexSchema,
  border: themeHexSchema,
  onMedia: themeHexSchema,
  scrim: visualThemeOverlaySchema,
  shadow: visualThemeOverlaySchema,
  radius: z.strictObject({
    sm: nonNegativeInt,
    md: nonNegativeInt,
    lg: nonNegativeInt,
  }),
  motion: z.strictObject({
    enterMs: nonNegativeInt,
    exitMs: nonNegativeInt,
    maxMs: positiveInt,
  }),
  semantic: z.strictObject({
    success: themeHexSchema,
    warning: themeHexSchema,
    error: themeHexSchema,
    info: themeHexSchema,
  }),
  categoryColors: z.array(themeHexSchema).min(1),
  textRoles: z.strictObject({
    title: textStyleSchema,
    subtitle: textStyleSchema,
    heading: textStyleSchema,
    body: textStyleSchema,
    closing: textStyleSchema,
    caption: textStyleSchema,
    label: textStyleSchema,
    code: textStyleSchema,
  }),
  surfaces: z
    .strictObject({
      caption: textSurfaceSchema.optional(),
      label: textSurfaceSchema.optional(),
    })
    .optional(),
  artDirection: z.strictObject({
    style: z.string().min(1),
    palette: z.array(themeHexSchema).min(1),
    avoid: z.string().min(1),
  }),
};

export const visualThemeDefinitionV1Schema = z.strictObject(visualThemeDefinitionV1Fields);
export type VisualThemeDefinitionV1 = z.infer<typeof visualThemeDefinitionV1Schema>;

export const visualThemeDefinitionV2Schema = z.strictObject({
  ...visualThemeDefinitionV1Fields,
  themeDefinitionSchemaVersion: z.literal(2),
  skin: knownVisualSkinRefSchema,
});
export type VisualThemeDefinitionV2 = z.infer<typeof visualThemeDefinitionV2Schema>;

export const visualThemeDefinitionSchema = z.union([
  visualThemeDefinitionV2Schema,
  visualThemeDefinitionV1Schema,
]);
export type VisualThemeDefinition = z.infer<typeof visualThemeDefinitionSchema>;

export const LATEST_THEME_DEFINITION_SCHEMA_VERSION = 2 as const;

export function resolveVisualThemeSkin(definition: VisualThemeDefinition): VisualSkinRef {
  return definition.themeDefinitionSchemaVersion === 2
    ? definition.skin
    : NEUTRAL_VISUAL_SKIN_REF;
}

export function toVisualThemeDefinitionV2(
  definition: VisualThemeDefinition,
  skin: VisualSkinRef = resolveVisualThemeSkin(definition),
): VisualThemeDefinitionV2 {
  if (definition.themeDefinitionSchemaVersion === 2) {
    return skin === definition.skin ? definition : { ...definition, skin };
  }
  return {
    ...definition,
    themeDefinitionSchemaVersion: 2,
    skin,
  };
}

export const SOFT_EDITORIAL_THEME_ID = "soft-editorial" as const;
export const SOFT_EDITORIAL_THEME_VERSION = 1 as const;

export const DEFAULT_VISUAL_THEME_REF: VisualThemeRef = {
  id: SOFT_EDITORIAL_THEME_ID,
  version: SOFT_EDITORIAL_THEME_VERSION,
};

const softEditorialV1 = visualThemeDefinitionV1Schema.parse({
  themeDefinitionSchemaVersion: 1,
  id: SOFT_EDITORIAL_THEME_ID,
  version: SOFT_EDITORIAL_THEME_VERSION,
  name: "Soft Editorial",
  canvas: {
    base: "#FAF6EE",
    ink: "#1F2A44",
  },
  accents: {
    primary: "#19736D",
    secondary: "#A84D3E",
    tertiary: "#80600F",
  },
  surface: "#FFFFFF",
  surfaceMuted: "#F1EAD9",
  text: "#232B3D",
  muted: "#4E5A6B",
  border: "#E2DAC6",
  onMedia: "#FFFFFF",
  scrim: { color: "#1B2740", opacity: 0.55 },
  shadow: { color: "#1B2740", opacity: 0.5 },
  radius: { sm: 12, md: 16, lg: 20 },
  motion: { enterMs: 350, exitMs: 0, maxMs: 2000 },
  semantic: {
    success: "#2E7D4F",
    warning: "#80600F",
    error: "#A84D3E",
    info: "#19736D",
  },
  categoryColors: ["#19736D", "#A84D3E", "#80600F", "#4E7FA6", "#7A6BA8", "#5F8A4E"],
  textRoles: {
    title: {
      font: "sans",
      fontSize: 96,
      color: "#175C57",
      lineHeight: 1.4,
      decoration: { bold: true, italic: false, outline: false, shadow: false },
    },
    subtitle: {
      font: "sans",
      fontSize: 48,
      color: "#4E5A6B",
      lineHeight: 1.4,
      decoration: { bold: false, italic: false, outline: false, shadow: false },
    },
    heading: {
      font: "sans",
      fontSize: 72,
      color: "#175C57",
      lineHeight: 1.4,
      decoration: { bold: true, italic: false, outline: false, shadow: false },
    },
    body: {
      font: "sans",
      fontSize: 42,
      color: "#232B3D",
      lineHeight: 1.8,
      decoration: { bold: false, italic: false, outline: false, shadow: false },
    },
    closing: {
      font: "sans",
      fontSize: 48,
      color: "#232B3D",
      lineHeight: 1.4,
      decoration: { bold: true, italic: false, outline: false, shadow: false },
    },
    caption: {
      font: "sans",
      fontSize: 40,
      color: "#FFFFFF",
      lineHeight: 1.5,
      decoration: { bold: false, italic: false, outline: false, shadow: true },
    },
    label: {
      font: "sans",
      fontSize: 28,
      color: "#4E5A6B",
      lineHeight: 1.4,
      decoration: { bold: true, italic: false, outline: false, shadow: false },
    },
    code: {
      font: "mono",
      fontSize: 34,
      color: "#232B3D",
      lineHeight: 1.6,
      decoration: { bold: false, italic: false, outline: false, shadow: false },
    },
  },
  surfaces: {
    caption: {
      enabled: true,
      backgroundColor: "#1B2740",
      backgroundOpacity: 0.55,
      paddingHorizontal: 36,
      paddingVertical: 12,
      borderRadius: 12,
    },
    label: {
      enabled: true,
      backgroundColor: "#F1EAD9",
      backgroundOpacity: 0.8,
      paddingHorizontal: 16,
      paddingVertical: 6,
      borderRadius: 8,
    },
  },
  artDirection: {
    style:
      "soft editorial paper background in warm off-white (#FAF6EE) with deep ink-navy (#1F2A44) typography; restrained accents in deep teal (#19736D), muted coral (#A84D3E), and ochre (#80600F); flat soft shapes, generous whitespace, no gradients except subtle tints, no photorealism",
    palette: ["#FAF6EE", "#1F2A44", "#19736D", "#A84D3E", "#80600F"],
    avoid: "neon colors, dark mode backgrounds, glossy 3D, heavy drop shadows, cluttered collage",
  },
});

export const visualThemeDefinitions: readonly VisualThemeDefinition[] = [softEditorialV1];

const latestVisualThemeDefinitionCache: readonly VisualThemeDefinition[] = (() => {
  const latestById = new Map<string, VisualThemeDefinition>();
  for (const definition of visualThemeDefinitions) {
    const current = latestById.get(definition.id);
    if (current === undefined || definition.version > current.version) {
      latestById.set(definition.id, definition);
    }
  }
  return [...latestById.values()];
})();

/**
 * The latest built-in definition per theme id, in registry order. Built-in
 * Themes are selectable at their latest version only, matching user Themes.
 */
export function latestVisualThemeDefinitions(): readonly VisualThemeDefinition[] {
  return latestVisualThemeDefinitionCache;
}

export function isLatestVisualThemeDefinition(id: string, version: number): boolean {
  return latestVisualThemeDefinitionCache.some(
    (definition) => definition.id === id && definition.version === version,
  );
}

export const visualThemeRegistry: ReadonlyMap<string, VisualThemeDefinition> = new Map(
  visualThemeDefinitions.map((definition) => [`${definition.id}@${definition.version}`, definition]),
);

export function getVisualTheme(id: string, version: number): VisualThemeDefinition | undefined {
  return visualThemeRegistry.get(`${id}@${version}`);
}

export function listVisualThemes(): VisualThemeDefinition[] {
  return [...visualThemeDefinitions];
}
