import { z } from "zod";
import { idSchema, positiveInt } from "./primitives";

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

export const nestedMediaVisualSchema = z.strictObject({
  kind: z.literal("media"),
  assetId: idSchema,
  fit: fitSchema.optional(),
  focalPoint: focalPointSchema.optional(),
});

export const nestedTemplateVisualSchema = z.strictObject({
  kind: z.literal("template"),
  template: templateRefSchema,
  input: z.unknown(),
});

export const nestedVisualSchema = z.discriminatedUnion("kind", [
  nestedMediaVisualSchema,
  nestedTemplateVisualSchema,
]);

export type NestedVisual = z.infer<typeof nestedVisualSchema>;
export type NestedMediaVisual = z.infer<typeof nestedMediaVisualSchema>;
export type NestedTemplateVisual = z.infer<typeof nestedTemplateVisualSchema>;
