import { z } from "zod";
import { idSchema, localeSchema, nonNegativeInt, positiveInt, timestampSchema } from "./content/primitives";
import { contentDocumentSchema } from "./content/document";

export const jobKindSchema = z.enum(["asset_ingest", "render"]);
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
export const artifactRoleSchema = z.enum(["render", "thumbnail", "caption"]);
export const artifactFormatSchema = z.enum(["mp4", "png", "jpeg", "vtt"]);
export const jobErrorCodeSchema = z.enum([
  "ASSET_INGEST_FAILED",
  "ASSET_UNAVAILABLE",
  "RENDER_FAILED",
  "WORKER_INTERRUPTED",
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
  createdAt: timestampSchema,
  contentUrl: z.string().min(1),
});

export const jobErrorSchema = z.object({
  code: jobErrorCodeSchema,
  message: z.string(),
});

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
    artifacts: z.array(artifactSchema),
  })
  .superRefine((job, ctx) => {
    if (job.kind === "render") {
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
  });

export type WorkSummary = z.infer<typeof workSummarySchema>;
export type Work = z.infer<typeof workSchema>;
export type LanguageEditionSummary = z.infer<typeof languageEditionSummarySchema>;
export type ScriptVersionSummary = z.infer<typeof scriptVersionSummarySchema>;
export type ScriptVersion = z.infer<typeof scriptVersionSchema>;
export type Asset = z.infer<typeof assetSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type Job = z.infer<typeof jobSchema>;
