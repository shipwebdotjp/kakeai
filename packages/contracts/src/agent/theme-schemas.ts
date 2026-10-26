import { z } from "zod";
import {
  AGENT_PREVIEW_IMAGE_BASE64_MAX,
  agentEmptyInputSchema,
} from "./protocol";
import {
  idSchema,
  localeSchema,
  nonNegativeInt,
  positiveInt,
  timestampSchema,
} from "../content/primitives";
import { fontFaceSchema, themeDraftSchema } from "../dto";
import { createThemeRequestSchema } from "../requests";
import {
  themeFontCategorySchema,
  visualThemeDefinitionSchema,
  visualThemeTextRoleSchema,
} from "../content/theme";
import { DEFAULT_AGENT_LOCALE } from "./defaults";

/**
 * A selectable Visual Theme. Only the latest published Revision of an
 * unarchived user Theme (or a built-in) is listed. The definition is returned
 * by `theme.get`, not by `theme.list`, so a list read stays small.
 */
export const agentThemeSummarySchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  isBuiltIn: z.boolean(),
  version: positiveInt,
});
export type AgentThemeSummary = z.infer<typeof agentThemeSummarySchema>;

export const agentThemeDetailSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  isBuiltIn: z.boolean(),
  version: positiveInt,
  definition: visualThemeDefinitionSchema,
});
export type AgentThemeDetail = z.infer<typeof agentThemeDetailSchema>;

export const agentThemeListInputSchema = agentEmptyInputSchema;
export const agentThemeListOutputSchema = z.strictObject({
  themes: z.array(agentThemeSummarySchema),
});

/** Shared Theme Revision selector for `theme.get` and `theme.diagnose`. */
export const agentThemeRevisionSelectorSchema = z.strictObject({
  themeId: idSchema,
  version: positiveInt.optional(),
});

/**
 * `version` selects one published Revision. Without it the latest selectable
 * Revision is returned, which is the historic contract. A version-specific read
 * also resolves archived Themes, because existing Script Versions may still
 * reference their Revisions.
 */
export const agentThemeGetInputSchema = agentThemeRevisionSelectorSchema;
export const agentThemeGetOutputSchema = z.strictObject({
  theme: agentThemeDetailSchema,
});

/** Reuses the HTTP creation contract: `{ name, sourceThemeRef? }`. */
export const agentThemeCreateInputSchema = createThemeRequestSchema;
export const agentThemeCreateOutputSchema = z.strictObject({
  themeId: idSchema,
  draft: themeDraftSchema,
});

export const agentThemeDraftGetInputSchema = z.strictObject({
  themeId: idSchema,
});
export const agentThemeDraftGetOutputSchema = z.strictObject({
  draft: themeDraftSchema.nullable(),
});

export const agentThemeDraftSaveInputSchema = z.strictObject({
  themeId: idSchema,
  definition: visualThemeDefinitionSchema,
});
export const agentThemeDraftSaveOutputSchema = z.strictObject({
  draft: themeDraftSchema,
});

export const agentThemePublishInputSchema = z.strictObject({
  themeId: idSchema,
});
export const agentThemePublishOutputSchema = z.strictObject({
  theme: agentThemeDetailSchema,
});

const fontStyleSchema = fontFaceSchema.shape.style;

export const agentFontListInputSchema = z
  .strictObject({
    query: z.string().trim().min(1).max(200).optional(),
    style: fontStyleSchema.optional(),
    minWeight: z.number().int().min(0).max(1000).optional(),
    maxWeight: z.number().int().min(0).max(1000).optional(),
    available: z.boolean().optional(),
    limit: z.number().int().min(1).max(200).default(50),
    offset: z.number().int().min(0).default(0),
  })
  .superRefine((value, ctx) => {
    if (
      value.minWeight !== undefined &&
      value.maxWeight !== undefined &&
      value.minWeight > value.maxWeight
    ) {
      ctx.addIssue({
        code: "custom",
        message: "minWeight は maxWeight 以下にしてください。",
        path: ["minWeight"],
      });
    }
  });

/**
 * A page of installed Font Faces. The catalog can hold thousands of faces, so
 * the response is filtered and paged instead of returning every face at once.
 */
export const agentFontListOutputSchema = z.strictObject({
  fonts: z.array(fontFaceSchema),
  total: nonNegativeInt,
  nextOffset: nonNegativeInt.nullable(),
  catalog: z.strictObject({
    supported: z.boolean(),
    reason: z.string().nullable(),
    updatedAt: timestampSchema,
  }),
});

/**
 * Resolved font for one Theme text role. Exactly one state holds:
 * - `localFaceName` set and `usesFallback: false`: a local face resolved.
 * - `usesFallback: true`: a face was requested but no local face resolved, so
 *   the generic stack is used as a fallback.
 * - no local-face field and `usesFallback: false`: the definition requests no
 *   face for this role, so the generic stack applies by design.
 */
export const agentThemeFontRoleSchema = z
  .strictObject({
    role: visualThemeTextRoleSchema,
    category: themeFontCategorySchema,
    localFaceName: z.string().min(1).optional(),
    localFaceWeight: z.number().int().optional(),
    localFaceStyle: fontStyleSchema.optional(),
    usesFallback: z.boolean(),
  })
  .superRefine((value, ctx) => {
    const hasLocalFace = value.localFaceName !== undefined;
    if (value.usesFallback && hasLocalFace) {
      ctx.addIssue({
        code: "custom",
        message: "usesFallback が true の role に local face を指定できません。",
        path: ["usesFallback"],
      });
    }
    if (
      !hasLocalFace &&
      (value.localFaceWeight !== undefined || value.localFaceStyle !== undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "localFaceName がない role に local face の属性を指定できません。",
        path: ["localFaceName"],
      });
    }
  });

/**
 * Font diagnostics for one Theme Revision. `verify` defaults to true to match
 * the render preflight, which checks whether Chromium can actually resolve the
 * local face; set it to false for a faster catalog-only answer.
 */
export const agentThemeDiagnoseInputSchema = agentThemeRevisionSelectorSchema.extend({
  locale: localeSchema.default(DEFAULT_AGENT_LOCALE),
  verify: z.boolean().default(true),
});
export const agentThemeDiagnoseOutputSchema = z.strictObject({
  diagnosis: z.strictObject({
    themeId: idSchema,
    version: positiveInt,
    locale: localeSchema,
    catalogSupported: z.boolean(),
    verificationSupported: z.boolean(),
    verificationReason: z.string().nullable(),
    roles: z.array(agentThemeFontRoleSchema),
    missingFonts: z.array(z.string()),
    diagnostics: z.array(z.string()),
  }),
});

/**
 * The representative sample starts with a 4-second intro, then the point scene
 * that shows the heading, body, label and caption roles. Half a second into it
 * shows the most text styles in one frame.
 */
export const AGENT_THEME_PREVIEW_DEFAULT_TIME_MS = 4500;

export const agentPreviewThemeInputSchema = z.strictObject({
  definition: visualThemeDefinitionSchema,
  locale: localeSchema.default(DEFAULT_AGENT_LOCALE),
  timeMs: nonNegativeInt.default(AGENT_THEME_PREVIEW_DEFAULT_TIME_MS),
});
export const agentPreviewThemeOutputSchema = z.strictObject({
  themeId: idSchema,
  version: positiveInt,
  locale: localeSchema,
  requestedTimeMs: nonNegativeInt,
  durationMs: nonNegativeInt,
  width: positiveInt,
  height: positiveInt,
  mimeType: z.literal("image/png"),
  imageBase64: z.string().min(1).max(AGENT_PREVIEW_IMAGE_BASE64_MAX),
});
export type AgentPreviewThemeInput = z.infer<typeof agentPreviewThemeInputSchema>;
export type AgentPreviewThemeOutput = z.infer<typeof agentPreviewThemeOutputSchema>;
