import { z } from "zod";
import { idSchema, nonNegativeInt, positiveInt } from "../content/primitives";

export const liveSha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * A resolved Asset or AssetRendition captured in an immutable Live Program
 * version. The hash is always the hash of the bytes an export would use:
 * the render rendition when one exists, otherwise the source Asset.
 */
export const liveAssetSnapshotSchema = z.strictObject({
  assetId: idSchema,
  renditionId: idSchema.nullable(),
  kind: z.enum(["image", "video", "audio"]),
  mediaType: z.string().min(1),
  sha256: liveSha256Schema,
  byteSize: nonNegativeInt,
  durationMs: nonNegativeInt.nullable(),
  widthPx: positiveInt.nullable(),
  heightPx: positiveInt.nullable(),
  hasAudio: z.boolean(),
});
export type LiveAssetSnapshot = z.infer<typeof liveAssetSnapshotSchema>;
