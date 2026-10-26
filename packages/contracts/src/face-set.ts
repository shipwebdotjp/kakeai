import { z } from "zod";
import { idSchema, positiveInt, timestampSchema } from "./content/primitives";

/**
 * Revision used by a work appearance that has a faceSetId but no explicit
 * faceSetVersion. The migration snapshots existing Face Sets as v1, so this
 * freezes legacy works instead of following later edits.
 */
export const LEGACY_FACE_SET_VERSION = 1;

export const faceLayerPartSchema = z.enum(["brow", "eye", "mouth", "foreground"]);

export const faceLayerSchema = z.strictObject({
  id: idSchema,
  part: faceLayerPartSchema,
  assetId: idSchema,
  blinkLayerId: idSchema.nullable(),
  speakingLayerId: idSchema.nullable(),
});

export const expressionPresetSchema = z.strictObject({
  id: idSchema,
  name: z.string().trim().min(1),
  browLayerId: idSchema.nullable(),
  eyeLayerId: idSchema.nullable(),
  mouthLayerId: idSchema.nullable(),
});

/** The latest revision of a Face Set, expanded for the existing readers. */
export const faceSetSchema = z.object({
  id: idSchema,
  name: z.string(),
  version: positiveInt,
  layers: z.array(faceLayerSchema),
  expressions: z.array(expressionPresetSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

/** An immutable Face Set revision. */
export const faceSetRevisionSchema = z.object({
  id: idSchema,
  faceSetId: idSchema,
  version: positiveInt,
  layers: z.array(faceLayerSchema),
  expressions: z.array(expressionPresetSchema),
  createdAt: timestampSchema,
});

export const faceSetUsageAppearanceSchema = z.object({
  characterId: idSchema,
  characterName: z.string(),
  appearanceId: idSchema,
  label: z.string().nullable(),
  assetId: idSchema,
  widthPx: positiveInt.nullable(),
  heightPx: positiveInt.nullable(),
});

export const faceSetUsagesSchema = z.object({
  libraryAppearances: z.array(faceSetUsageAppearanceSchema),
});

export const createFaceSetRequestSchema = z.strictObject({
  name: z.string().trim().min(1),
  layers: z.array(faceLayerSchema).max(50),
  expressions: z.array(expressionPresetSchema).max(50),
});

export const updateFaceSetRequestSchema = createFaceSetRequestSchema;

export type FaceLayerPart = z.infer<typeof faceLayerPartSchema>;
export type FaceLayer = z.infer<typeof faceLayerSchema>;
export type ExpressionPreset = z.infer<typeof expressionPresetSchema>;
export type FaceSet = z.infer<typeof faceSetSchema>;
export type FaceSetRevision = z.infer<typeof faceSetRevisionSchema>;
export type FaceSetUsageAppearance = z.infer<typeof faceSetUsageAppearanceSchema>;
export type FaceSetUsages = z.infer<typeof faceSetUsagesSchema>;
export type CreateFaceSetRequest = z.infer<typeof createFaceSetRequestSchema>;
export type UpdateFaceSetRequest = z.infer<typeof updateFaceSetRequestSchema>;
