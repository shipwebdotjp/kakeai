import { z } from "zod";
import { idSchema } from "./content/primitives.ts";

export const compositionManifestSchema = z.strictObject({
  entrypoint: z.string().min(1),
  contentHash: z.string().min(1).optional(),
  runtimeCompositionId: z.string().min(1),
  width: z.literal(1920),
  height: z.literal(1080),
  durationMs: z.number().int().positive(),
  dependencies: z.array(z.string().min(1)),
});

export type CompositionManifest = z.infer<typeof compositionManifestSchema>;

export const compositionDraftFilesSchema = z.strictObject({
  entrypoint: z.string().min(1),
  files: z.record(z.string(), z.string()),
});

export type CompositionDraftFiles = z.infer<typeof compositionDraftFilesSchema>;

export const compositionDraftSchema = z.strictObject({
  id: idSchema,
  compositionId: idSchema,
  entrypoint: z.string().min(1),
  storageKey: z.string().min(1),
  updatedAt: z.string(),
});

export type CompositionDraft = z.infer<typeof compositionDraftSchema>;

export const compositionVersionSchema = z.strictObject({
  id: idSchema,
  compositionId: idSchema,
  versionNumber: z.number().int().positive(),
  bundleHash: z.string().min(1),
  storageKey: z.string().min(1),
  manifest: compositionManifestSchema,
  createdAt: z.string(),
});

export type CompositionVersion = z.infer<typeof compositionVersionSchema>;

export const compositionSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  runtimeCompositionId: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  draft: compositionDraftSchema.nullable().optional(),
  versions: z.array(compositionVersionSchema).optional(),
});

export type Composition = z.infer<typeof compositionSchema>;
