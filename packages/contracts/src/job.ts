import { z } from "zod";
import { idSchema, localeSchema, nonNegativeInt, positiveInt } from "./content/primitives";
import { contentDocumentSchema } from "./content/document";
import { liveFixtureCommentSchema } from "./live/comment";
import { liveManifestFontSchema } from "./live/paths";
import { liveShowProfileSchema } from "./live/profile";
import { voiceAdapterIdSchema, voiceIdSchema, voiceProfileExtrasSchema } from "./voice-profile";
import { MAX_TTS_SPEED_SCALE, MIN_TTS_SPEED_SCALE } from "./requests";
import { compositionManifestSchema, CANVAS_PROFILE_DIMENSIONS } from "./composition";
import { expressionPresetSchema, faceLayerSchema } from "./face-set";
import { visualSkinRefSchema, visualThemeDefinitionSchema } from "./content/theme";

export const SNAPSHOT_SCHEMA_VERSION = 3 as const;

/**
 * Live export has its own snapshot version. Bumping the shared render/tts
 * version would make queued legacy jobs unreadable, so the new kind starts at
 * 1 and evolves independently.
 */
export const LIVE_EXPORT_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export const snapshotCompositionVersionRefSchema = z.object({
  id: idSchema,
  bundleHash: z.string().min(1),
  storageKey: z.string().min(1),
  manifest: compositionManifestSchema,
});

export const snapshotFaceSetRefSchema = z.object({
  id: idSchema,
  /** Set for revisions created after Face Set versioning; absent in old jobs. */
  version: positiveInt.optional(),
  name: z.string(),
  layers: z.array(faceLayerSchema),
  expressions: z.array(expressionPresetSchema),
});

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

/**
 * Output canvas recorded in a render snapshot. The Work's Output Profile
 * decides the size; only the two supported profiles are accepted so a corrupt
 * snapshot cannot silently render an unexpected canvas.
 */
export const outputSettingsSchema = z
  .object({
    width: positiveInt,
    height: positiveInt,
    fps: z.literal(30),
    format: z.literal("mp4"),
  })
  .refine(
    (value) =>
      Object.values(CANVAS_PROFILE_DIMENSIONS).some(
        (size) => size.width === value.width && size.height === value.height,
      ),
    {
      message: `出力寸法は ${Object.values(CANVAS_PROFILE_DIMENSIONS)
        .map((size) => `${size.width}×${size.height}`)
        .join(" / ")} のいずれかです。`,
      path: ["width"],
    },
  );

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
  compositionVersions: z.array(snapshotCompositionVersionRefSchema).optional().default([]),
  faceSets: z.array(snapshotFaceSetRefSchema).optional().default([]),
  themeDefinition: visualThemeDefinitionSchema.optional(),
  skin: visualSkinRefSchema.optional(),
  fontDiagnostics: z
    .object({
      missingFonts: z.array(z.string()),
      diagnostics: z.array(z.string()).optional().default([]),
    })
    .optional(),
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

export const ttsJobSnapshotSchema = z.object({
  snapshotSchemaVersion: z.literal(SNAPSHOT_SCHEMA_VERSION),
  kind: z.literal("tts"),
  scriptVersionId: idSchema,
  narrationSegmentId: idSchema,
  languageEditionId: idSchema,
  workId: idSchema,
  speakerId: idSchema,
  speakerName: z.string().min(1).max(200).optional(),
  voiceProfileId: idSchema,
  adapterId: voiceAdapterIdSchema,
  voice: z.object({
    voiceId: voiceIdSchema,
  }),
  voiceName: z.string().min(1).max(200).optional(),
  settings: voiceProfileExtrasSchema,
  speedScale: z.number().finite().min(MIN_TTS_SPEED_SCALE).max(MAX_TTS_SPEED_SCALE),
  speechText: z.string().min(1),
  engineVersion: z.string().nullable(),
});

export const liveVoiceProfileSnapshotSchema = z.object({
  id: idSchema,
  name: z.string(),
  adapterId: voiceAdapterIdSchema,
  voiceId: voiceIdSchema,
  locale: localeSchema,
  settings: voiceProfileExtrasSchema,
});
export type LiveVoiceProfileSnapshot = z.infer<typeof liveVoiceProfileSnapshotSchema>;

export const liveExportJobSnapshotSchema = z.object({
  snapshotSchemaVersion: z.literal(LIVE_EXPORT_SNAPSHOT_SCHEMA_VERSION),
  kind: z.literal("live_export"),
  workId: idSchema,
  languageEditionId: idSchema,
  scriptVersionId: idSchema,
  versionNumber: positiveInt,
  locale: localeSchema,
  content: contentDocumentSchema,
  profile: liveShowProfileSchema,
  profileSha256: z.string().regex(/^[0-9a-f]{64}$/),
  fixture: z.array(liveFixtureCommentSchema).optional(),
  outDir: z
    .string()
    .min(1)
    .refine(
      (value) =>
        value.startsWith("/") &&
        value !== "/" &&
        value.split("/").filter(Boolean).length >= 2 &&
        !value.includes("\0") &&
        !value.includes("\\") &&
        !value.split("/").includes(".."),
      { message: "outDir には .. を含まない絶対パスを指定してください" },
    ),
  exporterVersion: z.string().min(1),
  theme: visualThemeDefinitionSchema,
  skin: visualSkinRefSchema.optional(),
  assets: z.array(snapshotAssetRefSchema),
  faceSets: z.array(snapshotFaceSetRefSchema).optional().default([]),
  voiceProfiles: z.array(liveVoiceProfileSnapshotSchema),
  fonts: z.array(liveManifestFontSchema),
  fontDiagnostics: z
    .object({
      missingFonts: z.array(z.string()),
      diagnostics: z.array(z.string()).optional().default([]),
    })
    .optional(),
});
export type LiveExportJobSnapshot = z.infer<typeof liveExportJobSnapshotSchema>;

export const jobInputSnapshotSchema = z.discriminatedUnion("kind", [
  renderJobSnapshotSchema,
  assetIngestJobSnapshotSchema,
  ttsJobSnapshotSchema,
  liveExportJobSnapshotSchema,
]);

export function parseRenderJobSnapshot(input: unknown): RenderJobSnapshot {
  return renderJobSnapshotSchema.parse(input);
}

export function parseLiveExportJobSnapshot(input: unknown): LiveExportJobSnapshot {
  return liveExportJobSnapshotSchema.parse(input);
}

export type RenderJobSnapshot = z.infer<typeof renderJobSnapshotSchema>;
export type SnapshotAssetRef = z.infer<typeof snapshotAssetRefSchema>;
export type SnapshotFaceSet = z.infer<typeof snapshotFaceSetRefSchema>;
export type AssetIngestJobSnapshot = z.infer<typeof assetIngestJobSnapshotSchema>;
export type TtsJobSnapshot = z.infer<typeof ttsJobSnapshotSchema>;
export type JobInputSnapshot = z.infer<typeof jobInputSnapshotSchema>;
