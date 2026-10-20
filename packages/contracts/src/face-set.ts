import { z } from "zod";
import { idSchema, timestampSchema } from "./content/primitives";

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

export const faceSetSchema = z.object({
  id: idSchema,
  name: z.string(),
  layers: z.array(faceLayerSchema),
  expressions: z.array(expressionPresetSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
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
export type CreateFaceSetRequest = z.infer<typeof createFaceSetRequestSchema>;
export type UpdateFaceSetRequest = z.infer<typeof updateFaceSetRequestSchema>;
