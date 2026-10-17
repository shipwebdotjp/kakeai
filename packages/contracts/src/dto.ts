import { z } from "zod";
import { idSchema, localeSchema, nonNegativeInt, positiveInt, timestampSchema } from "./content/primitives";
import { contentDocumentSchema } from "./content/document";
import { templateRefSchema } from "./content/nested";
import { visualThemeDefinitionSchema } from "./content/theme";
import { assetTagsSchema } from "./asset";
import { errorCodeSchema } from "./error";

export const jobKindSchema = z.enum(["asset_ingest", "render", "tts"]);
export const jobStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export const assetKindSchema = z.enum(["image", "video", "audio"]);
export const assetOriginSchema = z.enum(["uploaded", "generated"]);
export const assetStatusSchema = z.enum(["processing", "ready", "failed"]);
export const RENDITION_PURPOSE = "render" as const;

export const artifactRoleSchema = z.enum(["render", "thumbnail", "caption"]);
export const artifactFormatSchema = z.enum(["mp4", "png", "jpeg", "vtt"]);
export const jobErrorCodeSchema = z.enum([
  "ASSET_INGEST_FAILED",
  "ASSET_UNAVAILABLE",
  "RENDER_FAILED",
  "WORKER_INTERRUPTED",
  "TTS_ENGINE_UNAVAILABLE",
  "TTS_INPUT_REJECTED",
  "TTS_SYNTHESIS_FAILED",
]);

export const scriptVersionRefSchema = z.object({
  id: idSchema,
  versionNumber: positiveInt,
  createdAt: timestampSchema,
});

export const renderJobRefSchema = z.object({
  id: idSchema,
  status: jobStatusSchema,
  finishedAt: timestampSchema.nullable(),
});

export const languageEditionSummarySchema = z.object({
  id: idSchema,
  workId: idSchema,
  locale: localeSchema,
  updatedAt: timestampSchema,
  currentScriptVersion: scriptVersionRefSchema,
  latestRenderJob: renderJobRefSchema.nullable(),
});

export const workSummarySchema = z.object({
  id: idSchema,
  title: z.string(),
  originalLocale: localeSchema,
  updatedAt: timestampSchema,
  languageEditions: z.array(languageEditionSummarySchema),
});

export const workSchema = workSummarySchema.extend({
  createdAt: timestampSchema,
  parentWorkId: idSchema.nullable(),
});

export const scriptVersionSummarySchema = z.object({
  id: idSchema,
  languageEditionId: idSchema,
  versionNumber: positiveInt,
  contentSchemaVersion: positiveInt,
  createdAt: timestampSchema,
});

export const scriptVersionSchema = scriptVersionSummarySchema.extend({
  content: contentDocumentSchema,
});

export const assetSchema = z.object({
  id: idSchema,
  kind: assetKindSchema,
  origin: assetOriginSchema,
  status: assetStatusSchema,
  originalFilename: z.string().min(1),
  mediaType: z.string().min(1),
  byteSize: nonNegativeInt,
  sha256: z.string().min(1),
  durationMs: nonNegativeInt.nullable(),
  widthPx: positiveInt.nullable(),
  heightPx: positiveInt.nullable(),
  hasAudio: z.boolean(),
  tags: assetTagsSchema,
  favoritedAt: timestampSchema.nullable(),
  archivedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  contentUrl: z.string().min(1),
});

export const artifactSchema = z.object({
  id: idSchema,
  jobId: idSchema,
  role: artifactRoleSchema,
  format: artifactFormatSchema,
  byteSize: nonNegativeInt,
  durationMs: nonNegativeInt.nullable(),
  widthPx: positiveInt.nullable(),
  heightPx: positiveInt.nullable(),
  fps: z.number().finite().positive().nullable(),
  videoCodec: z.string().min(1).nullable(),
  audioCodec: z.string().min(1).nullable(),
  createdAt: timestampSchema,
  contentUrl: z.string().min(1),
});

export const jobErrorSchema = z.object({
  code: jobErrorCodeSchema,
  message: z.string(),
});

export const ttsJobResultSchema = z.object({
  narrationSegmentId: idSchema,
  assetId: idSchema,
  durationMs: nonNegativeInt,
  source: z.literal("tts"),
});

export type TtsJobResult = z.infer<typeof ttsJobResultSchema>;

export const jobSchema = z
  .object({
    id: idSchema,
    kind: jobKindSchema,
    status: jobStatusSchema,
    workId: idSchema.nullable(),
    assetId: idSchema.nullable(),
    languageEditionId: idSchema.nullable(),
    scriptVersionId: idSchema.nullable(),
    progressPercent: z.number().int().min(0).max(100),
    createdAt: timestampSchema,
    startedAt: timestampSchema.nullable(),
    finishedAt: timestampSchema.nullable(),
    error: jobErrorSchema.nullable(),
    ttsResult: ttsJobResultSchema.nullable(),
    artifacts: z.array(artifactSchema),
  })
  .superRefine((job, ctx) => {
    if (job.kind === "tts") {
      for (const field of ["workId", "languageEditionId", "scriptVersionId"] as const) {
        if (job[field] === null) {
          ctx.addIssue({
            code: "custom",
            message: `tts Job は ${field} を必須とします`,
            path: [field],
          });
        }
      }
      if (job.assetId !== null) {
        ctx.addIssue({
          code: "custom",
          message: "tts Job は assetId を持ちません",
          path: ["assetId"],
        });
      }
    } else if (job.kind === "render") {
      for (const field of ["workId", "languageEditionId", "scriptVersionId"] as const) {
        if (job[field] === null) {
          ctx.addIssue({
            code: "custom",
            message: `render Job は ${field} を必須とします`,
            path: [field],
          });
        }
      }
      if (job.assetId !== null) {
        ctx.addIssue({
          code: "custom",
          message: "render Job は assetId を持ちません",
          path: ["assetId"],
        });
      }
    } else if (job.kind === "asset_ingest" && job.assetId === null) {
      ctx.addIssue({
        code: "custom",
        message: "asset_ingest Job は assetId を必須とします",
        path: ["assetId"],
      });
    }
    if (job.kind !== "tts" && job.ttsResult !== null) {
      ctx.addIssue({
        code: "custom",
        message: "ttsResult は tts Job だけが持ちます",
        path: ["ttsResult"],
      });
    }
    if (job.kind === "tts") {
      if (job.status === "succeeded" && job.ttsResult === null) {
        ctx.addIssue({
          code: "custom",
          message: "succeeded な tts Job は ttsResult を必須とします",
          path: ["ttsResult"],
        });
      }
      if (job.status !== "succeeded" && job.ttsResult !== null) {
        ctx.addIssue({
          code: "custom",
          message: "ttsResult は succeeded な tts Job だけが持ちます",
          path: ["ttsResult"],
        });
      }
    }
  });

export const bulkTtsJobEntrySchema = z.object({
  narrationSegmentId: idSchema,
  job: jobSchema,
});

export const bulkTtsJobExclusionSchema = z.object({
  narrationSegmentId: idSchema,
  code: errorCodeSchema,
  message: z.string().min(1),
});

export const bulkTtsJobsResultSchema = z.object({
  jobs: z.array(bulkTtsJobEntrySchema),
  excluded: z.array(bulkTtsJobExclusionSchema),
});

export const previewAssetSchema = z.object({
  assetId: idSchema,
  contentUrl: z.string().min(1),
  sha256: z.string().min(1),
});

export const previewCompositionSchema = z.object({
  compositionVersionId: idSchema,
  entryUrl: z.string().min(1),
});

export const previewRendererSchema = z.object({
  engine: z.literal("hyperframes"),
  compilerVersion: z.string().min(1),
  playerVersion: z.string().min(1),
});

export const previewLineTimingSchema = z.object({
  lineId: idSchema,
  startMs: nonNegativeInt,
  durationMs: nonNegativeInt,
});

export const previewCueTimingSchema = z.object({
  cueId: idSchema,
  startMs: nonNegativeInt,
});

export const previewSceneTimingSchema = z.object({
  sceneId: idSchema,
  startMs: nonNegativeInt,
  durationMs: nonNegativeInt,
  lines: z.array(previewLineTimingSchema),
  cues: z.array(previewCueTimingSchema),
});

export const previewTimelineSchema = z.object({
  totalDurationMs: nonNegativeInt,
  fps: positiveInt,
  scenes: z.array(previewSceneTimingSchema),
});

const previewBodySchema = z.object({
  compositionHtml: z.string().min(1),
  assets: z.array(previewAssetSchema),
  compositions: z.array(previewCompositionSchema),
  renderer: previewRendererSchema,
  timeline: previewTimelineSchema,
});

export const scriptVersionPreviewSchema = previewBodySchema.extend({
  scriptVersionId: idSchema,
});

export const draftPreviewSourceSchema = z.object({
  kind: z.literal("draft"),
});

export const draftPreviewSchema = previewBodySchema.extend({
  source: draftPreviewSourceSchema,
});

export type WorkSummary = z.infer<typeof workSummarySchema>;
export type Work = z.infer<typeof workSchema>;
export type LanguageEditionSummary = z.infer<typeof languageEditionSummarySchema>;
export type ScriptVersionSummary = z.infer<typeof scriptVersionSummarySchema>;
export type ScriptVersion = z.infer<typeof scriptVersionSchema>;
export type Asset = z.infer<typeof assetSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type Job = z.infer<typeof jobSchema>;
export type BulkTtsJobEntry = z.infer<typeof bulkTtsJobEntrySchema>;
export type BulkTtsJobExclusion = z.infer<typeof bulkTtsJobExclusionSchema>;
export type BulkTtsJobsResult = z.infer<typeof bulkTtsJobsResultSchema>;
export type PreviewAsset = z.infer<typeof previewAssetSchema>;
export type PreviewComposition = z.infer<typeof previewCompositionSchema>;
export type PreviewRenderer = z.infer<typeof previewRendererSchema>;
export type PreviewLineTiming = z.infer<typeof previewLineTimingSchema>;
export type PreviewCueTiming = z.infer<typeof previewCueTimingSchema>;
export type PreviewSceneTiming = z.infer<typeof previewSceneTimingSchema>;
export type PreviewTimeline = z.infer<typeof previewTimelineSchema>;
export type ScriptVersionPreview = z.infer<typeof scriptVersionPreviewSchema>;
export type DraftPreviewSource = z.infer<typeof draftPreviewSourceSchema>;
export type DraftPreview = z.infer<typeof draftPreviewSchema>;

export const fontFaceSchema = z.object({
  platformId: z.string().min(1),
  family: z.string().min(1),
  displayName: z.string().min(1),
  postScriptName: z.string().min(1),
  weight: z.number().int(),
  style: z.enum(["normal", "italic", "oblique"]),
  stretch: z.string(),
  variableAxes: z
    .array(
      z.object({
        tag: z.string(),
        min: z.number(),
        max: z.number(),
        default: z.number(),
      }),
    )
    .optional(),
  available: z.boolean(),
});
export type FontFace = z.infer<typeof fontFaceSchema>;

export const fontCatalogSchema = z.object({
  supported: z.boolean(),
  faces: z.array(fontFaceSchema),
  reason: z.string().nullable(),
  updatedAt: timestampSchema,
});
export type FontCatalog = z.infer<typeof fontCatalogSchema>;

export const themeRevisionSchema = z.object({
  id: idSchema,
  themeId: idSchema,
  version: positiveInt,
  definition: visualThemeDefinitionSchema,
  createdAt: timestampSchema,
});
export type ThemeRevision = z.infer<typeof themeRevisionSchema>;

export const themeDraftSchema = z.object({
  id: idSchema,
  themeId: idSchema,
  definition: visualThemeDefinitionSchema,
  updatedAt: timestampSchema,
});
export type ThemeDraft = z.infer<typeof themeDraftSchema>;

export const themeSummarySchema = z.object({
  id: idSchema,
  isBuiltIn: z.boolean(),
  name: z.string().min(1),
  archivedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  latestRevision: themeRevisionSchema.nullable(),
  hasDraft: z.boolean(),
  missingFonts: z.array(z.string()).optional(),
});
export type ThemeSummary = z.infer<typeof themeSummarySchema>;

export const themeDetailSchema = themeSummarySchema.extend({
  revisions: z.array(themeRevisionSchema),
  draft: themeDraftSchema.nullable(),
});
export type ThemeDetail = z.infer<typeof themeDetailSchema>;

export const thumbnailSchema = z.object({
  id: idSchema,
  languageEditionId: idSchema,
  label: z.string(),
  schemaVersion: positiveInt,
  template: templateRefSchema,
  input: z.unknown(),
  isPrimary: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Thumbnail = z.infer<typeof thumbnailSchema>;

export const thumbnailPreviewSchema = z.object({
  html: z.string().min(1),
  width: positiveInt,
  height: positiveInt,
});
export type ThumbnailPreview = z.infer<typeof thumbnailPreviewSchema>;
