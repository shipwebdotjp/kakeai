import { z } from "zod";
import { templateRefSchema } from "../content/nested";

export const THUMBNAIL_SCHEMA_VERSION = 1;

export const thumbnailDocumentSchema = z.strictObject({
  schemaVersion: z.literal(THUMBNAIL_SCHEMA_VERSION),
  template: templateRefSchema,
  input: z.unknown(),
});
export type ThumbnailDocument = z.infer<typeof thumbnailDocumentSchema>;
