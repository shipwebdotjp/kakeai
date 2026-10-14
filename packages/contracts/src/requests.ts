import { z } from "zod";
import { idSchema, localeSchema } from "./content/primitives";
import { contentDocumentSchema } from "./content/document";
import { visualThemeRefSchema, visualThemeDefinitionSchema } from "./content/theme";
import { styleIdSchema } from "./voice-profile";
import { assetTagsSchema } from "./asset";

export const createWorkRequestSchema = z.strictObject({
  title: z.string().trim().min(1),
  originalLocale: localeSchema,
});

export const updateWorkRequestSchema = z.strictObject({
  title: z.string().trim().min(1),
});

export const cloneWorkRequestSchema = z.strictObject({
  title: z.string().trim().min(1),
});

export const saveScriptVersionRequestSchema = z.strictObject({
  sourceScriptVersionId: idSchema.nullable().default(null),
  content: contentDocumentSchema,
});

export const draftPreviewRequestSchema = z.strictObject({
  content: contentDocumentSchema,
});

export const createRenderJobRequestSchema = z.strictObject({});

export const updateAssetRequestSchema = z.strictObject({
  tags: assetTagsSchema,
});

export const DEFAULT_TTS_SPEED_SCALE = 1;
export const MIN_TTS_SPEED_SCALE = 0.5;
export const MAX_TTS_SPEED_SCALE = 2;
export const MAX_TTS_SPEECH_TEXT_LENGTH = 1000;

export const createTtsJobRequestSchema = z.strictObject({
  styleId: styleIdSchema.optional(),
  speechText: z.string().max(MAX_TTS_SPEECH_TEXT_LENGTH).optional(),
  speedScale: z
    .number()
    .finite()
    .min(MIN_TTS_SPEED_SCALE)
    .max(MAX_TTS_SPEED_SCALE)
    .default(DEFAULT_TTS_SPEED_SCALE),
});

export const createBulkTtsJobsRequestSchema = z.strictObject({});

export type CreateWorkRequest = z.infer<typeof createWorkRequestSchema>;
export type UpdateWorkRequest = z.infer<typeof updateWorkRequestSchema>;
export type CloneWorkRequest = z.infer<typeof cloneWorkRequestSchema>;
export type SaveScriptVersionRequest = z.infer<typeof saveScriptVersionRequestSchema>;
export type DraftPreviewRequest = z.infer<typeof draftPreviewRequestSchema>;
export type CreateRenderJobRequest = z.infer<typeof createRenderJobRequestSchema>;
export type CreateTtsJobRequest = z.infer<typeof createTtsJobRequestSchema>;
export type CreateBulkTtsJobsRequest = z.infer<typeof createBulkTtsJobsRequestSchema>;
export type UpdateAssetRequest = z.infer<typeof updateAssetRequestSchema>;

export const bundleRelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !/^[a-zA-Z]:[\\/]/.test(value) &&
      !value.split(/[\\/]/).includes(".."),
    { message: "バンドル内の相対パスを指定してください" },
  );

export const createCompositionRequestSchema = z.strictObject({
  name: z.string().trim().min(1),
  runtimeCompositionId: z.string().trim().min(1),
  entrypoint: bundleRelativePathSchema.optional(),
});

export type CreateCompositionRequest = z.infer<typeof createCompositionRequestSchema>;

export const compositionDraftManifestInputSchema = z.strictObject({
  durationMs: z.number().int().positive().optional(),
  dependencies: z.array(z.string().min(1)).optional(),
});

export type CompositionDraftManifestInput = z.infer<typeof compositionDraftManifestInputSchema>;

export const updateCompositionDraftRequestSchema = z.strictObject({
  entrypoint: bundleRelativePathSchema.optional(),
  files: z.record(bundleRelativePathSchema, z.string()).optional(),
  filesBase64: z.record(bundleRelativePathSchema, z.string()).optional(),
  manifest: compositionDraftManifestInputSchema.optional(),
});

export type UpdateCompositionDraftRequest = z.infer<typeof updateCompositionDraftRequestSchema>;

export const publishCompositionRequestSchema = z.strictObject({
  entrypoint: bundleRelativePathSchema.optional(),
});

export type PublishCompositionRequest = z.infer<typeof publishCompositionRequestSchema>;

export const createThemeRequestSchema = z.strictObject({
  name: z.string().trim().min(1),
  sourceThemeRef: visualThemeRefSchema.optional(),
});
export type CreateThemeRequest = z.infer<typeof createThemeRequestSchema>;

export const updateThemeDraftRequestSchema = z.strictObject({
  definition: visualThemeDefinitionSchema,
});
export type UpdateThemeDraftRequest = z.infer<typeof updateThemeDraftRequestSchema>;

export const previewThemeDraftRequestSchema = z.strictObject({
  definition: visualThemeDefinitionSchema,
});
export type PreviewThemeDraftRequest = z.infer<typeof previewThemeDraftRequestSchema>;

export const publishThemeDraftRequestSchema = z.strictObject({});
export type PublishThemeDraftRequest = z.infer<typeof publishThemeDraftRequestSchema>;

export const refreshFontCatalogRequestSchema = z.strictObject({});
export type RefreshFontCatalogRequest = z.infer<typeof refreshFontCatalogRequestSchema>;
