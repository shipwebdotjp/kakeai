import { z } from "zod";

export const errorCodeSchema = z.enum([
  "MALFORMED_JSON",
  "LOCAL_ACCESS_DENIED",
  "RESOURCE_NOT_FOUND",
  "ASSET_PROCESSING",
  "ASSET_IN_USE",
  "WORK_HAS_CHILDREN",
  "JOB_NOT_CANCELLABLE",
  "FILE_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "VALIDATION_ERROR",
  "ASSET_NOT_FOUND",
  "ASSET_UNAVAILABLE",
  "MEDIA_INSPECTION_FAILED",
  "MEDIA_LIMIT_EXCEEDED",
  "PREVIEW_INPUT_INVALID",
  "RENDER_INPUT_INVALID",
  "INTERNAL_ERROR",
  "DATABASE_BUSY",
]);

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    requestId: z.string(),
    details: z.unknown().optional(),
  }),
});

export const warningSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  code: z.string(),
  message: z.string(),
});

export const warningsMetaSchema = z.object({
  warnings: z.array(warningSchema),
});

export function successEnvelope<T extends z.ZodTypeAny>(data: T) {
  return z.object({ data });
}

export function successEnvelopeWithMeta<T extends z.ZodTypeAny, M extends z.ZodTypeAny>(
  data: T,
  meta: M,
) {
  return z.object({ data, meta });
}

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
export type Warning = z.infer<typeof warningSchema>;
