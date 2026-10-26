import {
  ASSET_LIST_MAX_LIMIT,
  ASSET_LIST_SORT_VALUES,
  type AssetListPage,
  type AssetListQuery,
  type AssetListSort,
} from "@kakeai/contracts";
import { toAsset } from "../../dto/mappers.ts";
import {
  Prisma,
  type Asset as AssetRow,
  type PrismaClient,
} from "../../generated/prisma/client.ts";
import { ApiError } from "../../http/errors.ts";
import { validationError } from "../../http/validation.ts";

/**
 * The position of a page boundary. It carries the sort key of the last row of
 * the previous page plus the row id, and the sort it was produced for: a
 * cursor may only be replayed with the same sort.
 */
type AssetCursorPosition =
  | { sort: "createdAt_desc" | "createdAt_asc"; createdAt: Date; id: string }
  | { sort: "filename_asc"; filename: string; id: string }
  | { sort: "duration_asc"; durationMs: number | null; id: string };

/**
 * Every sort is a stable two-part order (sort key, then id) so that rows
 * sharing the key never repeat or disappear between pages. `duration_asc`
 * puts rows without a known duration last.
 *
 * Every sort has two forms: the Prisma order by of the page query and the
 * same order in raw SQL, which is the order the id list of a tag filter is
 * read in. Both forms always describe the same order.
 */
const ASSET_LIST_SORTS: Record<
  AssetListSort,
  { orderBy: Prisma.AssetOrderByWithRelationInput[]; sql: Prisma.Sql }
> = {
  createdAt_desc: {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    sql: Prisma.sql`a.createdAt DESC, a.id DESC`,
  },
  createdAt_asc: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    sql: Prisma.sql`a.createdAt ASC, a.id ASC`,
  },
  filename_asc: {
    orderBy: [{ originalFilename: "asc" }, { id: "asc" }],
    sql: Prisma.sql`a.originalFilename ASC, a.id ASC`,
  },
  duration_asc: {
    orderBy: [{ durationMs: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    // Rows without a known duration come last, like the page query orders them.
    sql: Prisma.sql`(a.durationMs IS NULL), a.durationMs ASC, a.id ASC`,
  },
};

function invalidCursor(): ApiError {
  return validationError([
    {
      path: ["cursor"],
      code: "custom",
      message: "cursor の形式が不正です。",
    },
  ]);
}

/**
 * The cursor was produced for another sort. Replaying it would silently
 * reinterpret the page, so the caller has to start over with the same sort.
 */
function cursorSortMismatch(): ApiError {
  return validationError([
    {
      path: ["cursor"],
      code: "custom",
      message:
        "cursor は別の sort で取得されたものです。sort を揃えるか、先頭から取得し直してください。",
    },
  ]);
}

function encodeAssetCursor(position: AssetCursorPosition): string {
  let payload: Record<string, unknown>;
  switch (position.sort) {
    case "filename_asc":
      payload = {
        v: 2,
        sort: position.sort,
        filename: position.filename,
        id: position.id,
      };
      break;
    case "duration_asc":
      payload = {
        v: 2,
        sort: position.sort,
        durationMs: position.durationMs,
        id: position.id,
      };
      break;
    default:
      payload = {
        v: 2,
        sort: position.sort,
        createdAt: position.createdAt.toISOString(),
        id: position.id,
      };
      break;
  }
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeAssetCursor(
  cursor: string,
  sort: AssetListSort,
): AssetCursorPosition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw invalidCursor();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw invalidCursor();
  }
  const record = parsed as Record<string, unknown>;
  if (
    record.v !== 2 ||
    typeof record.id !== "string" ||
    record.id.length === 0
  ) {
    throw invalidCursor();
  }
  const cursorSort = record.sort;
  if (
    typeof cursorSort !== "string" ||
    !ASSET_LIST_SORT_VALUES.includes(cursorSort as AssetListSort)
  ) {
    throw invalidCursor();
  }
  if (cursorSort !== sort) {
    throw cursorSortMismatch();
  }
  if (sort === "filename_asc") {
    if (typeof record.filename !== "string") {
      throw invalidCursor();
    }
    return { sort, filename: record.filename, id: record.id };
  }
  if (sort === "duration_asc") {
    const durationMs = record.durationMs;
    if (
      durationMs !== null &&
      (typeof durationMs !== "number" ||
        !Number.isInteger(durationMs) ||
        durationMs < 0)
    ) {
      throw invalidCursor();
    }
    return { sort, durationMs, id: record.id };
  }
  if (typeof record.createdAt !== "string") {
    throw invalidCursor();
  }
  const createdAt = new Date(record.createdAt);
  if (
    Number.isNaN(createdAt.getTime()) ||
    createdAt.toISOString() !== record.createdAt
  ) {
    throw invalidCursor();
  }
  return { sort, createdAt, id: record.id };
}

function cursorWhere(position: AssetCursorPosition): Prisma.AssetWhereInput {
  // Keyset pagination over the exact order the sort produced.
  switch (position.sort) {
    case "createdAt_desc":
      return {
        OR: [
          { createdAt: { lt: position.createdAt } },
          { createdAt: position.createdAt, id: { lt: position.id } },
        ],
      };
    case "createdAt_asc":
      return {
        OR: [
          { createdAt: { gt: position.createdAt } },
          { createdAt: position.createdAt, id: { gt: position.id } },
        ],
      };
    case "filename_asc":
      return {
        OR: [
          { originalFilename: { gt: position.filename } },
          { originalFilename: position.filename, id: { gt: position.id } },
        ],
      };
    case "duration_asc":
      // Rows without a known duration come last, so they follow every row with
      // a duration and are ordered by id among themselves.
      return position.durationMs === null
        ? { durationMs: null, id: { gt: position.id } }
        : {
            OR: [
              { durationMs: { gt: position.durationMs } },
              { durationMs: position.durationMs, id: { gt: position.id } },
              { durationMs: null },
            ],
          };
  }
}

function cursorPositionOf(
  row: AssetRow,
  sort: AssetListSort,
): AssetCursorPosition {
  switch (sort) {
    case "createdAt_desc":
    case "createdAt_asc":
      return { sort, createdAt: row.createdAt, id: row.id };
    case "filename_asc":
      return { sort, filename: row.originalFilename, id: row.id };
    case "duration_asc":
      return { sort, durationMs: row.durationMs, id: row.id };
  }
}

/**
 * One filter of a search. Every filter has two forms: the Prisma filter the
 * page and the count use, and the same condition in raw SQL. The raw form
 * narrows the id list of a tag filter, so that list stays close to the rows
 * that can actually match. Both forms always express the same condition.
 */
interface AssetFilter {
  prisma: Prisma.AssetWhereInput;
  sql: Prisma.Sql;
}

/**
 * The filters of one search. They are used for the page and for the total
 * count, so both always describe the same set of assets.
 */
function assetFilters(query: AssetListQuery): AssetFilter[] {
  const filters: AssetFilter[] = [];
  if (query.kind !== undefined) {
    filters.push({
      prisma: { kind: query.kind },
      sql: Prisma.sql`a.kind = ${query.kind}`,
    });
  }
  if (query.status !== undefined) {
    filters.push({
      prisma: { status: query.status },
      sql: Prisma.sql`a.status = ${query.status}`,
    });
  }
  if (query.filename !== undefined) {
    filters.push({
      prisma: { originalFilename: { contains: query.filename } },
      // The same substring match Prisma builds: the value is not escaped, so
      // `%` and `_` inside a filename keep their LIKE meaning.
      sql: Prisma.sql`a.originalFilename LIKE ('%' || ${query.filename} || '%')`,
    });
  }
  if (query.favorite !== undefined) {
    filters.push(
      query.favorite
        ? {
            prisma: { favoritedAt: { not: null } },
            sql: Prisma.sql`a.favoritedAt IS NOT NULL`,
          }
        : {
            prisma: { favoritedAt: null },
            sql: Prisma.sql`a.favoritedAt IS NULL`,
          },
    );
  }
  if (query.archived === "exclude") {
    filters.push({
      prisma: { archivedAt: null },
      sql: Prisma.sql`a.archivedAt IS NULL`,
    });
  } else if (query.archived === "only") {
    filters.push({
      prisma: { archivedAt: { not: null } },
      sql: Prisma.sql`a.archivedAt IS NOT NULL`,
    });
  }
  if (query.hasAudio !== undefined) {
    filters.push({
      prisma: { hasAudio: query.hasAudio },
      sql: Prisma.sql`a.hasAudio = ${query.hasAudio}`,
    });
  }
  if (query.durationMinMs !== undefined) {
    filters.push({
      prisma: { durationMs: { gte: query.durationMinMs } },
      sql: Prisma.sql`a.durationMs >= ${query.durationMinMs}`,
    });
  }
  if (query.durationMaxMs !== undefined) {
    filters.push({
      prisma: { durationMs: { lte: query.durationMaxMs } },
      sql: Prisma.sql`a.durationMs <= ${query.durationMaxMs}`,
    });
  }
  return filters;
}

/**
 * The exact element match for one tag.
 *
 * `Asset.tagsJson` is a JSON array of strings, so a tag matches when it is one
 * of its elements: `bgm` never matches `bgm_loop`, and `%` or `_` inside a
 * tag are ordinary characters instead of wildcards.
 *
 * The needle is the JSON encoded tag (`"bgm_loop"`), searched behind an
 * element boundary: the first element is preceded by `[`, every later element
 * by `,`. A quote inside a JSON string is always escaped, so `["` and `,"` can
 * only occur at an element boundary, and the closing quote of the needle is
 * the closing quote of that element. The match is therefore exact, and it
 * never depends on where the needle happens to occur first.
 *
 * `lower()` in SQLite folds ASCII letters only, so ASCII tags compare
 * case-insensitively (`Summer` matches `summer`) while non-ASCII tags
 * (Japanese) compare exactly.
 *
 * The fragment reads the `tagsJson` column of the alias `a`, so it belongs to
 * a statement that selects from `Asset a`.
 */
function tagElementCondition(tag: string): Prisma.Sql {
  const needle = JSON.stringify(tag);
  return Prisma.sql`(
    instr(lower(a.tagsJson), lower('[' || ${needle})) > 0
    OR instr(lower(a.tagsJson), lower(',' || ${needle})) > 0
  )`;
}

/**
 * The ids of the assets that carry the requested tags.
 *
 * Prisma has no exact element operator for a SQLite JSON column, so the tag
 * condition runs as a small raw SQL query and the matching ids are handed to
 * the regular Prisma filters. `tagMode: "and"` requires every requested tag
 * (the conditions are joined with `AND`), `"or"` requires at least one (the
 * conditions are joined with `OR`).
 *
 * The other filters join the same statement, so the id list only holds the
 * assets that can match anyway. The ids come back in the order of the
 * requested sort. Together with the chunking below that keeps a long id list
 * usable: the page reads the chunks one after the other and the rows of the
 * chunks are already in page order.
 */
async function assetIdsByTags(
  prisma: PrismaClient,
  tags: readonly string[],
  tagMode: AssetListQuery["tagMode"],
  sort: AssetListSort,
  filters: readonly AssetFilter[],
): Promise<string[]> {
  const tagConditions = tags.map((tag) => tagElementCondition(tag));
  const conditions = [
    // The tag conditions are one group: the other filters have to hold for
    // every requested tag, also in the `or` mode.
    Prisma.sql`(${Prisma.join(tagConditions, tagMode === "or" ? " OR " : " AND ")})`,
    ...filters.map((filter) => filter.sql),
  ];
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT a.id AS id FROM Asset a
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY ${ASSET_LIST_SORTS[sort].sql}
  `;
  return rows.map((row) => row.id);
}

/**
 * Prisma's SQLite connector rejects a statement with more than 999 bind
 * parameters, so a tag filter that matches many assets cannot hand all of
 * their ids to one statement. The id list is split into chunks that stay well
 * below that limit; every chunk carries the same filters, so the page and the
 * count still describe exactly the same assets.
 *
 * Trade-off: the ids of every asset that carries the tag are read into memory
 * and the count needs one statement per chunk. A personal library stays far
 * below that; a library large enough to feel it needs the deferred tag index
 * (Agent Access roadmap).
 */
const ASSET_TAG_ID_CHUNK_SIZE = 800;

function chunkIds(ids: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += ASSET_TAG_ID_CHUNK_SIZE) {
    chunks.push(ids.slice(index, index + ASSET_TAG_ID_CHUNK_SIZE));
  }
  return chunks;
}

/**
 * Asset library search. Every filter runs in the database query, the result is
 * ordered by the requested sort, and the cursor is a keyset over that exact
 * order so rows that share the sort key never repeat or disappear between
 * pages. `total` counts the rows that match the same filter set.
 */
export async function searchAssets(
  prisma: PrismaClient,
  query: AssetListQuery,
): Promise<AssetListPage> {
  const limit = Math.min(query.limit, ASSET_LIST_MAX_LIMIT);
  const sort = query.sort;
  const wanted = query.tags ?? [];
  const filters = assetFilters(query);
  // The tag condition is resolved once and then shared by the page query and
  // the total count, so the count always describes the same rows.
  const tagIds =
    wanted.length > 0
      ? await assetIdsByTags(prisma, wanted, query.tagMode, sort, filters)
      : null;
  const cursorFilter =
    query.cursor === undefined
      ? null
      : cursorWhere(decodeAssetCursor(query.cursor, sort));
  // Without a tag filter the search runs as one statement; with a tag filter
  // the ids are read in chunks that stay below the bind parameter limit.
  const idChunks: (string[] | null)[] =
    tagIds === null ? [null] : chunkIds(tagIds);
  const whereOf = (
    chunk: string[] | null,
    withCursor: boolean,
  ): Prisma.AssetWhereInput => {
    const parts: Prisma.AssetWhereInput[] = filters.map(
      (filter) => filter.prisma,
    );
    if (chunk !== null) {
      parts.push({ id: { in: chunk } });
    }
    if (withCursor && cursorFilter !== null) {
      parts.push(cursorFilter);
    }
    return parts.length === 1 ? parts[0] : { AND: parts };
  };

  const [rows, total] = await Promise.all([
    (async () => {
      const collected: AssetRow[] = [];
      for (const chunk of idChunks) {
        const chunkRows = await prisma.asset.findMany({
          where: whereOf(chunk, true),
          orderBy: ASSET_LIST_SORTS[sort].orderBy,
          take: limit + 1,
        });
        collected.push(...chunkRows);
        // The chunks are in page order, so the page is complete as soon as
        // one row more than the page size was read.
        if (collected.length > limit) {
          break;
        }
      }
      return collected;
    })(),
    (async () => {
      let count = 0;
      for (const chunk of idChunks) {
        count += await prisma.asset.count({ where: whereOf(chunk, false) });
      }
      return count;
    })(),
  ]);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows.at(-1);
  return {
    assets: pageRows.map((row) => toAsset(row)),
    nextCursor:
      hasMore && last !== undefined
        ? encodeAssetCursor(cursorPositionOf(last, sort))
        : null,
    total,
  };
}
