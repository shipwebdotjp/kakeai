import { z } from "zod";
import { MAX_ASSET_TAGS, assetTagSchema } from "./asset";
import { nonNegativeInt } from "./content/primitives";
import { assetKindSchema, assetSchema, assetStatusSchema } from "./dto";

export const ASSET_LIST_DEFAULT_LIMIT = 50;
export const ASSET_LIST_MAX_LIMIT = 100;

/**
 * Sort orders the asset search supports. Every order is a stable two-part
 * order (sort key, then `id`), so rows that share the key never repeat or
 * disappear between pages.
 *
 * - `createdAt_desc` (default): newest first.
 * - `createdAt_asc`: oldest first.
 * - `filename_asc`: by `originalFilename`, byte order (case sensitive).
 * - `duration_asc`: by `durationMs`, shortest first; rows without a known
 *   duration (`durationMs` is null) come last.
 */
export const ASSET_LIST_SORT_VALUES = [
  "createdAt_desc",
  "createdAt_asc",
  "filename_asc",
  "duration_asc",
] as const;
export const assetListSortSchema = z.enum(ASSET_LIST_SORT_VALUES);
export type AssetListSort = z.infer<typeof assetListSortSchema>;
export const ASSET_LIST_DEFAULT_SORT: AssetListSort = "createdAt_desc";

/**
 * Opaque page cursor. The encoding is owned by the implementation (the API);
 * callers must pass back exactly the `nextCursor` they received.
 *
 * The cursor carries the sort it was produced for. Presenting it with a
 * different `sort` is a validation error, never a silent reinterpretation.
 */
export const assetListCursorSchema = z.string().min(1);

/**
 * Search/filter input for the asset library. The same schema is shared by the
 * HTTP API, the local control socket, MCP and the CLI.
 *
 * Filters combine as follows:
 * - `tags` matches assets that carry all (`tagMode: "and"`) or any
 *   (`tagMode: "or"`) of the given tags. A tag matches when it appears as a
 *   quoted element of the stored tag array, so `bgm` does not match
 *   `bgm_loop`. The comparison runs through SQLite's `LIKE`, so ASCII letters
 *   are compared case-insensitively while non-ASCII tags (for example
 *   Japanese) are compared exactly. `LIKE` also reads `_` (any single
 *   character) and `%` (any sequence) inside a tag as wildcards, so a tag that
 *   contains them also matches tags that differ at those positions.
 * - `filename` is a case-insensitive substring match on `originalFilename`.
 * - `favorite` filters on `favoritedAt`, `archived` on `archivedAt`
 *   (`exclude` is the default, so archived assets stay hidden).
 * - `hasAudio` filters on the audio track flag, `durationMinMs` /
 *   `durationMaxMs` on `durationMs`. Assets without a known duration
 *   (`durationMs` is null) never satisfy a duration range.
 *
 * Results are ordered by `sort` (default `createdAt desc, id desc`). A cursor
 * from a different filter set is not meaningful, and a malformed cursor or a
 * cursor produced for another sort is rejected with `VALIDATION_ERROR`.
 */
export const assetListQuerySchema = z
  .strictObject({
    kind: assetKindSchema.optional(),
    status: assetStatusSchema.optional(),
    filename: z.string().trim().min(1).optional(),
    tags: z.array(assetTagSchema).max(MAX_ASSET_TAGS).optional(),
    tagMode: z.enum(["and", "or"]).default("and"),
    favorite: z.boolean().optional(),
    archived: z.enum(["exclude", "include", "only"]).default("exclude"),
    hasAudio: z.boolean().optional(),
    durationMinMs: nonNegativeInt.optional(),
    durationMaxMs: nonNegativeInt.optional(),
    sort: assetListSortSchema.default(ASSET_LIST_DEFAULT_SORT),
    cursor: assetListCursorSchema.optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(ASSET_LIST_MAX_LIMIT)
      .default(ASSET_LIST_DEFAULT_LIMIT),
  })
  .superRefine((query, ctx) => {
    // An inverted range is a contradiction, not a filter that matches nothing.
    if (
      query.durationMinMs !== undefined &&
      query.durationMaxMs !== undefined &&
      query.durationMinMs > query.durationMaxMs
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["durationMaxMs"],
        message: "durationMaxMs は durationMinMs 以上にしてください。",
      });
    }
  });
export type AssetListQuery = z.infer<typeof assetListQuerySchema>;

/** Alias used by bindings that distinguish "input" from transport-level query. */
export const assetListInputSchema = assetListQuerySchema;

/**
 * One page of the asset search. `total` is the number of assets that match
 * the filter set (the same count on every page of that filter set).
 */
export const assetListPageSchema = z.strictObject({
  assets: z.array(assetSchema),
  nextCursor: assetListCursorSchema.nullable(),
  total: z.number().int().min(0),
});
export type AssetListPage = z.infer<typeof assetListPageSchema>;
