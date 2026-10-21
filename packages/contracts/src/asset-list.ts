import { z } from "zod";
import { MAX_ASSET_TAGS, assetTagSchema } from "./asset";
import { assetKindSchema, assetSchema, assetStatusSchema } from "./dto";

export const ASSET_LIST_DEFAULT_LIMIT = 50;
export const ASSET_LIST_MAX_LIMIT = 100;

/**
 * Opaque page cursor. The encoding is owned by the implementation (the API);
 * callers must pass back exactly the `nextCursor` they received.
 */
export const assetListCursorSchema = z.string().min(1);

/**
 * Search/filter input for the asset library. The same schema is shared by the
 * HTTP API, the local control socket, MCP and the CLI.
 *
 * Filters combine as follows:
 * - `tags` matches assets that carry all (`tagMode: "and"`) or any
 *   (`tagMode: "or"`) of the given tags.
 * - `filename` is a case-insensitive substring match on `originalFilename`.
 * - `favorite` filters on `favoritedAt`, `archived` on `archivedAt`
 *   (`exclude` is the default, so archived assets stay hidden).
 *
 * Results are ordered by `createdAt desc, id desc`. A cursor from a different
 * filter set is not meaningful, and a malformed cursor is rejected by the
 * binding with `VALIDATION_ERROR`.
 */
export const assetListQuerySchema = z.strictObject({
  kind: assetKindSchema.optional(),
  status: assetStatusSchema.optional(),
  filename: z.string().trim().min(1).optional(),
  tags: z.array(assetTagSchema).max(MAX_ASSET_TAGS).optional(),
  tagMode: z.enum(["and", "or"]).default("and"),
  favorite: z.boolean().optional(),
  archived: z.enum(["exclude", "include", "only"]).default("exclude"),
  cursor: assetListCursorSchema.optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(ASSET_LIST_MAX_LIMIT)
    .default(ASSET_LIST_DEFAULT_LIMIT),
});
export type AssetListQuery = z.infer<typeof assetListQuerySchema>;

/** Alias used by bindings that distinguish "input" from transport-level query. */
export const assetListInputSchema = assetListQuerySchema;

export const assetListPageSchema = z.strictObject({
  assets: z.array(assetSchema),
  nextCursor: assetListCursorSchema.nullable(),
});
export type AssetListPage = z.infer<typeof assetListPageSchema>;
