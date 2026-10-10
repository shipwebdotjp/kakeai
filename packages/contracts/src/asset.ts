import { z } from "zod";

export const MAX_ASSET_TAGS = 30;
export const MAX_ASSET_TAG_LENGTH = 40;

export const assetTagSchema = z.string().trim().min(1).max(MAX_ASSET_TAG_LENGTH);

export const assetTagsSchema = z
  .array(z.string())
  .transform((tags) =>
    [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))],
  )
  .pipe(z.array(assetTagSchema).max(MAX_ASSET_TAGS));

export type AssetTag = z.infer<typeof assetTagSchema>;
