import { z } from "zod";
import { idSchema, nonNegativeInt } from "../content/primitives";
import { liveFixtureCommentSchema } from "./comment";

const liveExportOutDirSchema = z
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
  );

/**
 * Export one immutable Live Program Version. The version already owns its
 * script, cast, theme, materials and CutIns, so no Work, ScriptVersion or Show
 * Profile is accepted.
 */
export const liveExportProgramRequestSchema = z.strictObject({
  programVersionId: idSchema,
  fixture: z.array(liveFixtureCommentSchema).max(10000).optional(),
  outDir: liveExportOutDirSchema,
});
export type LiveExportProgramRequest = z.infer<typeof liveExportProgramRequestSchema>;

/** The only supported live export input. */
export const liveExportRequestSchema = liveExportProgramRequestSchema;
export type LiveExportRequest = z.infer<typeof liveExportRequestSchema>;

export const liveExportFailureStageSchema = z.enum([
  "input",
  "cue",
  "voice",
  "material",
  "tts",
  "manifest",
  "output",
  "unknown",
]);
export type LiveExportFailureStage = z.infer<typeof liveExportFailureStageSchema>;

export const liveExportFailureSchema = z.strictObject({
  stage: liveExportFailureStageSchema,
  id: idSchema.nullable(),
  message: z.string().min(1),
});
export type LiveExportFailure = z.infer<typeof liveExportFailureSchema>;

export const liveExportResultSchema = z.strictObject({
  packagePath: z.string().min(1).nullable(),
  packageId: z.string().min(1).nullable(),
  manifestSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  fileCount: nonNegativeInt.nullable(),
  preparedCueCount: nonNegativeInt.nullable(),
  warnings: z.array(z.string()),
  failures: z.array(liveExportFailureSchema),
});
export type LiveExportResult = z.infer<typeof liveExportResultSchema>;
