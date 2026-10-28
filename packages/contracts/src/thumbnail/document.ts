import { z } from "zod";
import { templateRefSchema } from "../content/nested";
import { thumbnailAppearanceSchema } from "./appearance";

/**
 * v3 replaces the single candidate-level Font Face with locale-specific
 * entries. Existing v1/v2 candidates and Edition appearances are discarded by
 * the database migration, so there is deliberately no read compatibility.
 */
export const THUMBNAIL_SCHEMA_VERSION = 3;

export const thumbnailDocumentSchema = z.strictObject({
  schemaVersion: z.literal(THUMBNAIL_SCHEMA_VERSION),
  template: templateRefSchema,
  input: z.unknown(),
  appearanceOverride: thumbnailAppearanceSchema.optional(),
});
export type ThumbnailDocument = z.infer<typeof thumbnailDocumentSchema>;

/** A candidate carries a sparse appearance override on top of the Work one. */
export function thumbnailAppearanceOverrideOf(
  document: ThumbnailDocument,
): z.infer<typeof thumbnailAppearanceSchema> | undefined {
  return document.appearanceOverride;
}
