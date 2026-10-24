import { z } from "zod";
import { templateRefSchema } from "../content/nested";
import { thumbnailAppearanceSchema } from "./appearance";

export const THUMBNAIL_SCHEMA_VERSION = 2;

export const thumbnailDocumentV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  template: templateRefSchema,
  input: z.unknown(),
});
export type ThumbnailDocumentV1 = z.infer<typeof thumbnailDocumentV1Schema>;

export const thumbnailDocumentV2Schema = z.strictObject({
  schemaVersion: z.literal(THUMBNAIL_SCHEMA_VERSION),
  template: templateRefSchema,
  input: z.unknown(),
  appearanceOverride: thumbnailAppearanceSchema.optional(),
});
export type ThumbnailDocumentV2 = z.infer<typeof thumbnailDocumentV2Schema>;

export const thumbnailDocumentSchema = z.union([
  thumbnailDocumentV2Schema,
  thumbnailDocumentV1Schema,
]);
export type ThumbnailDocument = z.infer<typeof thumbnailDocumentSchema>;

/** v1 documents have no candidate-level appearance override. */
export function thumbnailAppearanceOverrideOf(
  document: ThumbnailDocument,
): z.infer<typeof thumbnailAppearanceSchema> | undefined {
  return document.schemaVersion === 2 ? document.appearanceOverride : undefined;
}
