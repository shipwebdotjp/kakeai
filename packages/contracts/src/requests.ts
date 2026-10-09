import { z } from "zod";
import { idSchema, localeSchema } from "./content/primitives";
import { contentDocumentSchema } from "./content/document";

export const createWorkRequestSchema = z.strictObject({
  title: z.string().trim().min(1),
  originalLocale: localeSchema,
});

export const updateWorkRequestSchema = z.strictObject({
  title: z.string().trim().min(1),
});

export const saveScriptVersionRequestSchema = z.strictObject({
  sourceScriptVersionId: idSchema.nullable().default(null),
  content: contentDocumentSchema,
});

export const createRenderJobRequestSchema = z.strictObject({});

export type CreateWorkRequest = z.infer<typeof createWorkRequestSchema>;
export type UpdateWorkRequest = z.infer<typeof updateWorkRequestSchema>;
export type SaveScriptVersionRequest = z.infer<typeof saveScriptVersionRequestSchema>;
export type CreateRenderJobRequest = z.infer<typeof createRenderJobRequestSchema>;
