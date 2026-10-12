import { z } from "zod";
import { accentColorSchema, nonNegativeInt, positiveInt } from "./primitives";

export const visualThemeRefSchema = z.strictObject({
  id: z.string().min(1),
  version: positiveInt,
});
export type VisualThemeRef = z.infer<typeof visualThemeRefSchema>;

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

export const visualThemeTextTokenSchema = z.strictObject({
  font: themeFontCategorySchema,
  fontSize: z.number().int().min(8).max(240),
  color: themeHexSchema,
  lineHeight: z.number().min(1).max(3),
  decoration: visualThemeDecorationSchema,
});
export type VisualThemeTextToken = z.infer<typeof visualThemeTextTokenSchema>;

export const visualThemeOverlaySchema = z.strictObject({
  color: themeHexSchema,
  opacity: z.number().min(0).max(1),
});
export type VisualThemeOverlay = z.infer<typeof visualThemeOverlaySchema>;

export const visualThemeDefinitionSchema = z.strictObject({
  id: z.string().min(1),
  version: positiveInt,
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
    title: visualThemeTextTokenSchema,
    subtitle: visualThemeTextTokenSchema,
    heading: visualThemeTextTokenSchema,
    body: visualThemeTextTokenSchema,
    closing: visualThemeTextTokenSchema,
    caption: visualThemeTextTokenSchema,
    label: visualThemeTextTokenSchema,
    code: visualThemeTextTokenSchema,
  }),
  artDirection: z.strictObject({
    style: z.string().min(1),
    palette: z.array(themeHexSchema).min(1),
    avoid: z.string().min(1),
  }),
});
export type VisualThemeDefinition = z.infer<typeof visualThemeDefinitionSchema>;

export const SOFT_EDITORIAL_THEME_ID = "soft-editorial" as const;
export const SOFT_EDITORIAL_THEME_VERSION = 1 as const;

export const DEFAULT_VISUAL_THEME_REF: VisualThemeRef = {
  id: SOFT_EDITORIAL_THEME_ID,
  version: SOFT_EDITORIAL_THEME_VERSION,
};

const softEditorialV1 = visualThemeDefinitionSchema.parse({
  id: SOFT_EDITORIAL_THEME_ID,
  version: SOFT_EDITORIAL_THEME_VERSION,
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
  artDirection: {
    style:
      "soft editorial paper background in warm off-white (#FAF6EE) with deep ink-navy (#1F2A44) typography; restrained accents in deep teal (#19736D), muted coral (#A84D3E), and ochre (#80600F); flat soft shapes, generous whitespace, no gradients except subtle tints, no photorealism",
    palette: ["#FAF6EE", "#1F2A44", "#19736D", "#A84D3E", "#80600F"],
    avoid: "neon colors, dark mode backgrounds, glossy 3D, heavy drop shadows, cluttered collage",
  },
});

export const visualThemeDefinitions: readonly VisualThemeDefinition[] = [softEditorialV1];

export const visualThemeRegistry: ReadonlyMap<string, VisualThemeDefinition> = new Map(
  visualThemeDefinitions.map((definition) => [`${definition.id}@${definition.version}`, definition]),
);

export function getVisualTheme(id: string, version: number): VisualThemeDefinition | undefined {
  return visualThemeRegistry.get(`${id}@${version}`);
}

export function listVisualThemes(): VisualThemeDefinition[] {
  return [...visualThemeDefinitions];
}
