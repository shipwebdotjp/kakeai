import { z } from "zod";
import { idSchema, nonNegativeInt, positiveInt, timestampSchema } from "../content/primitives";
import { liveFormatDocumentV1Schema } from "./format";
import {
  LIVE_MATERIAL_DEFAULT_DURATION_MS,
  liveMaterialDurationMsSchema,
  liveMaterialFormatSchema,
  liveMaterialProvenanceSchema,
  liveMaterialSnapshotSchema,
} from "./material";
import {
  liveProgramDocumentSchema,
  liveProgramSourceFormatSchema,
} from "./program";
import { liveResolutionSnapshotSchema } from "./resolution";
import { liveSha256Schema } from "./snapshot";

export const liveFormatSummarySchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  title: z.string().min(1),
  locale: z.literal("ja-JP"),
  targetDurationMs: positiveInt,
  segmentCount: nonNegativeInt,
  cardCount: nonNegativeInt,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type LiveFormatSummary = z.infer<typeof liveFormatSummarySchema>;

export const liveFormatDetailSchema = liveFormatSummarySchema.extend({
  document: liveFormatDocumentV1Schema,
});
export type LiveFormatDetail = z.infer<typeof liveFormatDetailSchema>;

export const liveFormatListSchema = z.strictObject({
  items: z.array(liveFormatSummarySchema),
  limit: positiveInt,
  offset: nonNegativeInt,
  total: nonNegativeInt,
});
export type LiveFormatList = z.infer<typeof liveFormatListSchema>;

export const createLiveFormatRequestSchema = z.strictObject({
  document: liveFormatDocumentV1Schema,
});
export type CreateLiveFormatRequest = z.infer<typeof createLiveFormatRequestSchema>;

export const updateLiveFormatRequestSchema = createLiveFormatRequestSchema;
export type UpdateLiveFormatRequest = z.infer<typeof updateLiveFormatRequestSchema>;

export const duplicateLiveFormatRequestSchema = z.strictObject({
  name: z.string().trim().min(1).optional(),
});
export type DuplicateLiveFormatRequest = z.infer<
  typeof duplicateLiveFormatRequestSchema
>;

export const liveProgramVersionSummarySchema = z.strictObject({
  id: idSchema,
  programId: idSchema,
  versionNumber: positiveInt,
  schemaVersion: positiveInt,
  documentSha256: liveSha256Schema,
  resolutionSnapshotSha256: liveSha256Schema,
  note: z.string().nullable(),
  createdAt: timestampSchema,
});
export type LiveProgramVersionSummary = z.infer<
  typeof liveProgramVersionSummarySchema
>;

export const liveProgramVersionDetailSchema = liveProgramVersionSummarySchema.extend({
  document: liveProgramDocumentSchema,
  resolutionSnapshot: liveResolutionSnapshotSchema,
});
export type LiveProgramVersionDetail = z.infer<
  typeof liveProgramVersionDetailSchema
>;

export const liveProgramVersionListSchema = z.array(liveProgramVersionSummarySchema);
export type LiveProgramVersionList = z.infer<typeof liveProgramVersionListSchema>;

export const liveProgramSummarySchema = z.strictObject({
  id: idSchema,
  title: z.string().min(1),
  draftRevision: nonNegativeInt,
  sourceFormat: liveProgramSourceFormatSchema.nullable(),
  versionCount: nonNegativeInt,
  latestVersionNumber: positiveInt.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type LiveProgramSummary = z.infer<typeof liveProgramSummarySchema>;

export const liveProgramDetailSchema = liveProgramSummarySchema.extend({
  draftDocument: liveProgramDocumentSchema,
  versions: z.array(liveProgramVersionSummarySchema),
});
export type LiveProgramDetail = z.infer<typeof liveProgramDetailSchema>;

export const liveProgramListSchema = z.strictObject({
  items: z.array(liveProgramSummarySchema),
  limit: positiveInt,
  offset: nonNegativeInt,
  total: nonNegativeInt,
});
export type LiveProgramList = z.infer<typeof liveProgramListSchema>;

export const createLiveProgramRequestSchema = z.strictObject({
  formatId: idSchema,
  title: z.string().trim().min(1).optional(),
});
export type CreateLiveProgramRequest = z.infer<typeof createLiveProgramRequestSchema>;

export const saveLiveProgramDraftRequestSchema = z.strictObject({
  expectedRevision: nonNegativeInt,
  document: liveProgramDocumentSchema,
});
export type SaveLiveProgramDraftRequest = z.infer<
  typeof saveLiveProgramDraftRequestSchema
>;

export const finalizeLiveProgramVersionRequestSchema = z.strictObject({
  expectedRevision: nonNegativeInt,
  note: z.string().trim().min(1).max(2000).optional(),
});
export type FinalizeLiveProgramVersionRequest = z.infer<
  typeof finalizeLiveProgramVersionRequestSchema
>;

export const restoreLiveProgramVersionDraftRequestSchema = z.strictObject({
  expectedRevision: nonNegativeInt,
});
export type RestoreLiveProgramVersionDraftRequest = z.infer<
  typeof restoreLiveProgramVersionDraftRequestSchema
>;

export const liveMaterialSummarySchema = z.strictObject({
  id: idSchema,
  programId: idSchema,
  name: z.string().min(1),
  provenance: liveMaterialProvenanceSchema,
  createdAt: timestampSchema,
});
export type LiveMaterialSummary = z.infer<typeof liveMaterialSummarySchema>;

export const liveMaterialDetailSchema = liveMaterialSummarySchema.extend({
  snapshot: liveMaterialSnapshotSchema,
});
export type LiveMaterialDetail = z.infer<typeof liveMaterialDetailSchema>;

export const liveMaterialListSchema = z.strictObject({
  items: z.array(liveMaterialSummarySchema),
  limit: positiveInt,
  offset: nonNegativeInt,
  total: nonNegativeInt,
});
export type LiveMaterialList = z.infer<typeof liveMaterialListSchema>;

export const importLiveMaterialRequestSchema = z
  .strictObject({
    expectedRevision: nonNegativeInt,
    workId: idSchema,
    sceneId: idSchema,
    name: z.string().trim().min(1).optional(),
    /** Output card format. Defaults to a static PNG card. */
    format: liveMaterialFormatSchema.default("png"),
    /** Used by MP4 cards. PNG/HTML cards are always exported as 4000ms stills. */
    durationMs: liveMaterialDurationMsSchema.default(LIVE_MATERIAL_DEFAULT_DURATION_MS),
  })
  .superRefine((request, ctx) => {
    if (
      request.format !== "mp4" &&
      request.durationMs !== LIVE_MATERIAL_DEFAULT_DURATION_MS
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["durationMs"],
        message: "durationMs は mp4 形式のときだけ指定できます。",
      });
    }
  });
export type ImportLiveMaterialRequest = z.infer<
  typeof importLiveMaterialRequestSchema
>;

export const liveMaterialImportResultSchema = z.strictObject({
  material: liveMaterialDetailSchema,
  program: liveProgramDetailSchema,
});
export type LiveMaterialImportResult = z.infer<
  typeof liveMaterialImportResultSchema
>;
