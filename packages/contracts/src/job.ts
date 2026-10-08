import { z } from "zod";
import { idSchema, nonNegativeInt, positiveInt } from "./content/primitives";
import { contentDocumentSchema } from "./content/document";

export const SNAPSHOT_SCHEMA_VERSION = 1 as const;

export const snapshotAssetRefSchema = z.object({
  assetId: idSchema,
  renditionId: idSchema.nullable(),
  sha256: z.string().min(1),
  mediaType: z.string().min(1),
  byteSize: nonNegativeInt,
  durationMs: nonNegativeInt.nullable(),
  widthPx: positiveInt.nullable(),
  heightPx: positiveInt.nullable(),
});

export const outputSettingsSchema = z.object({
  width: z.literal(1920),
  height: z.literal(1080),
  fps: z.literal(30),
  format: z.literal("mp4"),
});

export const rendererVersionsSchema = z.object({
  engine: z.literal("hyperframes"),
  compilerVersion: z.string(),
  producerVersion: z.string().optional(),
  ffmpegVersion: z.string().optional(),
  chromeVersion: z.string().optional(),
});

export const renderJobSnapshotSchema = z.object({
  snapshotSchemaVersion: z.literal(SNAPSHOT_SCHEMA_VERSION),
  kind: z.literal("render"),
  scriptVersionId: idSchema,
  versionNumber: positiveInt,
  content: contentDocumentSchema,
  assets: z.array(snapshotAssetRefSchema),
  template: z.object({
    id: z.string().min(1),
    version: positiveInt,
  }),
  output: outputSettingsSchema,
  renderer: rendererVersionsSchema.optional(),
});

export const assetIngestJobSnapshotSchema = z.object({
  snapshotSchemaVersion: z.literal(SNAPSHOT_SCHEMA_VERSION),
  kind: z.literal("asset_ingest"),
  assetId: idSchema,
  sha256: z.string().min(1),
  mediaType: z.string().min(1),
  storageKey: z.string().min(1),
});

export const jobInputSnapshotSchema = z.discriminatedUnion("kind", [
  renderJobSnapshotSchema,
  assetIngestJobSnapshotSchema,
]);

export type RenderJobSnapshot = z.infer<typeof renderJobSnapshotSchema>;
export type AssetIngestJobSnapshot = z.infer<typeof assetIngestJobSnapshotSchema>;
export type JobInputSnapshot = z.infer<typeof jobInputSnapshotSchema>;
