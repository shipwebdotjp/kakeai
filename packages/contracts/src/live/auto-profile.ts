import { z } from "zod";
import { idSchema, nonNegativeInt, positiveInt } from "../content/primitives";
import {
  liveMaterialFormatSchema,
  liveSegmentKindSchema,
  liveShowProfileSchema,
} from "./profile";

/**
 * Input for generating a Show Profile draft from a Work's ScriptVersion.
 * The generated profile is a normal `LiveShowProfile`; callers may save and
 * edit it before exporting.
 */
export const liveAutoProfileRequestSchema = z.strictObject({
  workId: idSchema,
  scriptVersionId: idSchema,
  /** Defaults to the Work title. */
  title: z.string().trim().min(1).optional(),
  includeCommentCorners: z.boolean().default(true),
});
export type LiveAutoProfileRequest = z.infer<typeof liveAutoProfileRequestSchema>;

/**
 * Human-readable summary of a generated draft. This is presentation data for
 * the CLI and future editor; the profile itself remains the source of truth.
 */
export const liveAutoProfileSummarySchema = z.strictObject({
  title: z.string().trim().min(1),
  targetDurationMs: positiveInt,
  characters: z.strictObject({
    left: z.string().trim().min(1).nullable(),
    right: z.string().trim().min(1).nullable(),
  }),
  segments: z.array(
    z.strictObject({
      kind: liveSegmentKindSchema,
      label: z.string().trim().min(1),
      cueCount: nonNegativeInt,
      materialLabel: z.string().trim().min(1).nullable(),
    }),
  ),
  materials: z.array(
    z.strictObject({
      id: idSchema,
      sceneId: idSchema,
      label: z.string().trim().min(1),
      format: liveMaterialFormatSchema,
    }),
  ),
});
export type LiveAutoProfileSummary = z.infer<typeof liveAutoProfileSummarySchema>;

export const liveAutoProfileResultSchema = z.strictObject({
  profile: liveShowProfileSchema,
  summary: liveAutoProfileSummarySchema,
  warnings: z.array(z.string().trim().min(1)),
});
export type LiveAutoProfileResult = z.infer<typeof liveAutoProfileResultSchema>;
