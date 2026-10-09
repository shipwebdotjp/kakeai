import { z } from "zod";
import { idSchema, localeSchema } from "./content/primitives";
import { contentDocumentInputSchema } from "./content/document";

export const createWorkRequestSchema = z.strictObject({
  title: z.string().trim().min(1),
  originalLocale: localeSchema,
});

export const updateWorkRequestSchema = z.strictObject({
  title: z.string().trim().min(1),
});

export const saveScriptVersionRequestSchema = z.strictObject({
  sourceScriptVersionId: idSchema.nullable().default(null),
  content: contentDocumentInputSchema,
});

export const createRenderJobRequestSchema = z.strictObject({});

export const DEFAULT_TTS_SPEED_SCALE = 1;
export const MIN_TTS_SPEED_SCALE = 0.5;
export const MAX_TTS_SPEED_SCALE = 2;
export const MAX_TTS_SPEECH_TEXT_LENGTH = 1000;

export const createTtsJobRequestSchema = z.strictObject({
  styleId: z.number().int().nonnegative().optional(),
  speedScale: z
    .number()
    .finite()
    .min(MIN_TTS_SPEED_SCALE)
    .max(MAX_TTS_SPEED_SCALE)
    .default(DEFAULT_TTS_SPEED_SCALE),
});

export type CreateWorkRequest = z.infer<typeof createWorkRequestSchema>;
export type UpdateWorkRequest = z.infer<typeof updateWorkRequestSchema>;
export type SaveScriptVersionRequest = z.infer<typeof saveScriptVersionRequestSchema>;
export type CreateRenderJobRequest = z.infer<typeof createRenderJobRequestSchema>;
export type CreateTtsJobRequest = z.infer<typeof createTtsJobRequestSchema>;
