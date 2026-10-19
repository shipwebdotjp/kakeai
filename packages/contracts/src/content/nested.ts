import { z } from "zod";
import { idSchema, positiveInt } from "./primitives";
import { videoPlaybackSchema } from "./video-playback";

export const MAX_NESTED_VISUAL_DEPTH = 8;
export const MAX_NESTED_VISUAL_NODES = 64;

export const templateRefSchema = z.strictObject({
  id: idSchema,
  version: positiveInt,
});

export const fitSchema = z.enum(["cover", "contain"]);

export const focalPointSchema = z.strictObject({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const MEDIA_ZOOM_MIN = 0.5;
export const MEDIA_ZOOM_MAX = 3;

export const mediaZoomSchema = z.number().min(MEDIA_ZOOM_MIN).max(MEDIA_ZOOM_MAX);

export const nestedMediaVisualSchema = z.strictObject({
  kind: z.literal("media"),
  assetId: idSchema,
  fit: fitSchema.optional(),
  focalPoint: focalPointSchema.optional(),
  videoPlayback: videoPlaybackSchema.optional(),
});

export const nestedTemplateVisualSchema = z.strictObject({
  kind: z.literal("template"),
  template: templateRefSchema,
  input: z.unknown(),
});

export const nestedCompositionPositionSchema = z.strictObject({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});
export type NestedCompositionPosition = z.infer<typeof nestedCompositionPositionSchema>;

export const nestedCompositionVisualSchema = z.strictObject({
  kind: z.literal("composition"),
  compositionVersionId: idSchema,
  fit: fitSchema,
  zoom: mediaZoomSchema.optional(),
  position: nestedCompositionPositionSchema.optional(),
});

export const nestedVisualSchema = z.discriminatedUnion("kind", [
  nestedMediaVisualSchema,
  nestedTemplateVisualSchema,
  nestedCompositionVisualSchema,
]);

export type NestedVisual = z.infer<typeof nestedVisualSchema>;
export type NestedMediaVisual = z.infer<typeof nestedMediaVisualSchema>;
export type NestedTemplateVisual = z.infer<typeof nestedTemplateVisualSchema>;
export type NestedCompositionVisual = z.infer<typeof nestedCompositionVisualSchema>;
