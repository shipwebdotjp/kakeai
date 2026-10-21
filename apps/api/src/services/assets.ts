import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import {
  ASSET_LIST_MAX_LIMIT,
  ASSET_LIST_SORT_VALUES,
  RENDITION_PURPOSE,
  SNAPSHOT_SCHEMA_VERSION,
  assetIngestJobSnapshotSchema,
  assetTagsSchema,
  collectAssetReferences,
  renderJobSnapshotSchema,
  type Asset,
  type AssetKindName,
  type AssetListPage,
  type AssetListQuery,
  type AssetListSort,
} from "@kakeai/contracts";
import type { LimitsConfig } from "../config.ts";
import { deserializeContent } from "../domain/content-json.ts";
import { bigIntToSafeNumber, toAsset } from "../dto/mappers.ts";
import {
  Prisma,
  type Asset as AssetRow,
  type PrismaClient,
} from "../generated/prisma/client.ts";
import { ApiError } from "../http/errors.ts";
import { resourceNotFound, validationError } from "../http/validation.ts";
import { allowedMediaTypes, detectMedia } from "../media/kind.ts";
import { probeMedia, type MediaProbe } from "../media/probe.ts";
import {
  assetStorageKey,
  commitFile,
  fileMatches,
  removeStorageFile,
  resolveStoragePath,
} from "../storage/asset-store.ts";
import type { DataDirectories } from "../storage/paths.ts";

export interface UploadInput {
  tempPath: string;
  originalFilename: string;
  sha256: string;
  byteSize: number;
  /** Defaults to `uploaded`. Agent imports with provenance are `generated`. */
  origin?: "uploaded" | "generated";
  /** Optional JSON provenance (model, prompt, generation parameters). */
  provenanceJson?: string;
}

export interface IngestOutcome {
  asset: Asset;
  deduplicated: boolean;
  httpStatus: 200 | 202;
  /** The enqueued ingest job, or null when an already-ready asset was reused. */
  jobId: string | null;
}

export interface ContentLocation {
  path: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
}

type Transaction = Prisma.TransactionClient;

function isPrismaCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
}

function limitViolation(
  probe: MediaProbe,
  limits: LimitsConfig,
): { measured: Record<string, number>; limits: Record<string, number> } | null {
  const measured: Record<string, number> = {};
  const exceeded: Record<string, number> = {};
  if (probe.durationMs !== null && probe.durationMs > limits.maxMediaDurationMs) {
    measured.durationMs = probe.durationMs;
    exceeded.maxMediaDurationMs = limits.maxMediaDurationMs;
  }
  if (probe.widthPx !== null && probe.widthPx > limits.maxWidthPx) {
    measured.widthPx = probe.widthPx;
    exceeded.maxWidthPx = limits.maxWidthPx;
  }
  if (probe.heightPx !== null && probe.heightPx > limits.maxHeightPx) {
    measured.heightPx = probe.heightPx;
    exceeded.maxHeightPx = limits.maxHeightPx;
  }
  return Object.keys(measured).length > 0 ? { measured, limits: exceeded } : null;
}

function createIngestJob(transaction: Transaction, asset: { id: string; sha256: string; mediaType: string; storageKey: string }) {
  const snapshot = assetIngestJobSnapshotSchema.parse({
    snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
    kind: "asset_ingest",
    assetId: asset.id,
    sha256: asset.sha256,
    mediaType: asset.mediaType,
    storageKey: asset.storageKey,
  });
  return transaction.job.create({
    data: {
      kind: "asset_ingest",
      status: "queued",
      assetId: asset.id,
      snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
      inputSnapshotJson: JSON.stringify(snapshot),
    },
  });
}

async function inspectUpload(
  tempPath: string,
  limits: LimitsConfig,
): Promise<{ kind: AssetKindName; mediaType: string; probe: MediaProbe }> {
  const detected = await detectMedia(tempPath);
  if (detected === null) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", undefined, {
      allowedMediaTypes: allowedMediaTypes(),
    });
  }
  let probe: MediaProbe;
  try {
    probe = await probeMedia(tempPath, detected.kind, detected.mediaType);
  } catch {
    throw new ApiError(422, "MEDIA_INSPECTION_FAILED");
  }
  const violation = limitViolation(probe, limits);
  if (violation !== null) {
    throw new ApiError(422, "MEDIA_LIMIT_EXCEEDED", undefined, violation);
  }
  return { kind: detected.kind, mediaType: detected.mediaType, probe };
}

/**
 * Reuses an existing asset. Provenance is additive: the first metadata that
 * described the bytes wins, so a later agent import never relabels a human
 * upload or replaces TTS generation metadata.
 */
async function requeueExisting(
  prisma: PrismaClient,
  existing: {
    id: string;
    sha256: string;
    mediaType: string;
    storageKey: string;
    provenanceJson: string | null;
  },
  provenanceJson?: string,
): Promise<IngestOutcome> {
  const { asset: updated, job } = await prisma.$transaction(async (transaction) => {
    const asset = await transaction.asset.update({
      where: { id: existing.id },
      data: { status: "processing" },
    });
    if (provenanceJson !== undefined) {
      // Conditional update: never replace provenance that already exists.
      await transaction.asset.updateMany({
        where: { id: existing.id, provenanceJson: null },
        data: { provenanceJson },
      });
    }
    const job = await createIngestJob(transaction, asset);
    return { asset, job };
  });
  return {
    asset: toAsset(updated),
    deduplicated: true,
    httpStatus: 202,
    jobId: job.id,
  };
}

async function storeProvenance(
  prisma: PrismaClient,
  existing: { id: string; provenanceJson: string | null },
  provenanceJson: string | undefined,
): Promise<void> {
  if (existing.provenanceJson !== null || provenanceJson === undefined) {
    return;
  }
  // Conditional update: only the first provenance that describes these bytes wins.
  await prisma.asset.updateMany({
    where: { id: existing.id, provenanceJson: null },
    data: { provenanceJson },
  });
}

/** The in-flight ingest Job for an asset that is still processing, if any. */
async function pendingIngestJobId(
  prisma: PrismaClient,
  assetId: string,
): Promise<string | null> {
  const job = await prisma.job.findFirst({
    where: {
      assetId,
      kind: "asset_ingest",
      status: { in: ["queued", "running"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return job?.id ?? null;
}

export async function ingestUpload(
  prisma: PrismaClient,
  directories: DataDirectories,
  limits: LimitsConfig,
  input: UploadInput,
): Promise<IngestOutcome> {
  const storageKey = assetStorageKey(input.sha256);

  const existing = await prisma.asset.findUnique({ where: { sha256: input.sha256 } });
  if (existing !== null) {
    const filePath = resolveStoragePath(directories, existing.storageKey);
    const matches = await fileMatches(filePath, existing.sha256, bigIntToSafeNumber(existing.byteSize));
    if (matches && existing.status !== "failed") {
      await rm(input.tempPath, { force: true });
      await storeProvenance(prisma, existing, input.provenanceJson);
      return {
        asset: toAsset(existing),
        deduplicated: true,
        httpStatus: existing.status === "ready" ? 200 : 202,
        jobId:
          existing.status === "ready"
            ? null
            : await pendingIngestJobId(prisma, existing.id),
      };
    }
    await inspectUpload(input.tempPath, limits);
    if (matches) {
      await rm(input.tempPath, { force: true });
    } else {
      await commitFile(input.tempPath, existing.storageKey, directories);
    }
    return requeueExisting(prisma, existing, input.provenanceJson);
  }

  const { kind, mediaType } = await inspectUpload(input.tempPath, limits);
  await commitFile(input.tempPath, storageKey, directories);
  try {
    const { asset: created, jobId } = await prisma.$transaction(async (transaction) => {
      const asset = await transaction.asset.create({
        data: {
          kind,
          origin: input.origin ?? "uploaded",
          status: "processing",
          storageKey,
          originalFilename: input.originalFilename,
          mediaType,
          byteSize: BigInt(input.byteSize),
          sha256: input.sha256,
          ...(input.provenanceJson === undefined
            ? {}
            : { provenanceJson: input.provenanceJson }),
        },
      });
      const job = await createIngestJob(transaction, asset);
      return { asset, jobId: job.id };
    });
    return { asset: toAsset(created), deduplicated: false, httpStatus: 202, jobId };
  } catch (error) {
    if (isPrismaCode(error, "P2002")) {
      const raced = await prisma.asset.findUnique({ where: { sha256: input.sha256 } });
      if (raced !== null) {
        return requeueExisting(prisma, raced, input.provenanceJson);
      }
    }
    const claimed = await prisma.asset
      .findUnique({ where: { sha256: input.sha256 } })
      .catch(() => null);
    if (claimed === null) {
      await removeStorageFile(directories, storageKey).catch(() => undefined);
    }
    throw error;
  }
}

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
      message: "cursor は別の sort で取得されたものです。sort を揃えるか、先頭から取得し直してください。",
    },
  ]);
}

function encodeAssetCursor(position: AssetCursorPosition): string {
  let payload: Record<string, unknown>;
  switch (position.sort) {
    case "filename_asc":
      payload = { v: 2, sort: position.sort, filename: position.filename, id: position.id };
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

function decodeAssetCursor(cursor: string, sort: AssetListSort): AssetCursorPosition {
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
  if (record.v !== 2 || typeof record.id !== "string" || record.id.length === 0) {
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
      (typeof durationMs !== "number" || !Number.isInteger(durationMs) || durationMs < 0)
    ) {
      throw invalidCursor();
    }
    return { sort, durationMs, id: record.id };
  }
  if (typeof record.createdAt !== "string") {
    throw invalidCursor();
  }
  const createdAt = new Date(record.createdAt);
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== record.createdAt) {
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

function cursorPositionOf(row: AssetRow, sort: AssetListSort): AssetCursorPosition {
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
        : { prisma: { favoritedAt: null }, sql: Prisma.sql`a.favoritedAt IS NULL` },
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
    query.cursor === undefined ? null : cursorWhere(decodeAssetCursor(query.cursor, sort));
  // Without a tag filter the search runs as one statement; with a tag filter
  // the ids are read in chunks that stay below the bind parameter limit.
  const idChunks: (string[] | null)[] = tagIds === null ? [null] : chunkIds(tagIds);
  const whereOf = (chunk: string[] | null, withCursor: boolean): Prisma.AssetWhereInput => {
    const parts: Prisma.AssetWhereInput[] = filters.map((filter) => filter.prisma);
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
      hasMore && last !== undefined ? encodeAssetCursor(cursorPositionOf(last, sort)) : null,
    total,
  };
}

export async function getAsset(prisma: PrismaClient, assetId: string): Promise<Asset> {
  const row = await prisma.asset.findUnique({ where: { id: assetId } });
  if (row === null) {
    throw resourceNotFound("asset", assetId);
  }
  return toAsset(row);
}

export interface AssetMetadataPatch {
  tags?: readonly string[];
  favorited?: boolean;
  archived?: boolean;
}

export async function updateAsset(
  prisma: PrismaClient,
  assetId: string,
  patch: AssetMetadataPatch,
): Promise<Asset> {
  const data: Prisma.AssetUpdateInput = {};
  if (patch.tags !== undefined) {
    const normalized = assetTagsSchema.parse([...patch.tags]);
    data.tagsJson = normalized.length === 0 ? null : JSON.stringify(normalized);
  }
  if (patch.favorited !== undefined) {
    data.favoritedAt = patch.favorited ? new Date() : null;
  }
  if (patch.archived !== undefined) {
    data.archivedAt = patch.archived ? new Date() : null;
  }
  if (Object.keys(data).length === 0) {
    const row = await prisma.asset.findUnique({ where: { id: assetId } });
    if (row === null) {
      throw resourceNotFound("asset", assetId);
    }
    return toAsset(row);
  }
  try {
    const row = await prisma.asset.update({ where: { id: assetId }, data });
    return toAsset(row);
  } catch (error) {
    if (isPrismaCode(error, "P2025")) {
      throw resourceNotFound("asset", assetId);
    }
    throw error;
  }
}

interface AssetReference {
  type: "script_version" | "render_job" | "character" | "face_set";
  id: string;
}

async function findAssetReferences(
  client: Prisma.TransactionClient,
  assetId: string,
): Promise<AssetReference[]> {
  const references: AssetReference[] = [];

  const characters = await client.characterAppearance.findMany({
    where: { assetId },
    select: { characterId: true },
  });
  for (const appearance of characters) {
    references.push({ type: "character", id: appearance.characterId });
  }

  const faceLayers = await client.faceLayer.findMany({
    where: { assetId },
    select: { faceSetId: true },
  });
  for (const faceSetId of new Set(faceLayers.map((layer) => layer.faceSetId))) {
    references.push({ type: "face_set", id: faceSetId });
  }

  const versions = await client.scriptVersion.findMany({
    select: { id: true, contentJson: true },
  });
  for (const version of versions) {
    try {
      const content = deserializeContent(version.contentJson);
      if (collectAssetReferences(content).some((reference) => reference.assetId === assetId)) {
        references.push({ type: "script_version", id: version.id });
      }
    } catch {
      continue;
    }
  }

  const jobs = await client.job.findMany({
    where: { kind: "render", status: { in: ["queued", "running"] } },
    select: { id: true, inputSnapshotJson: true },
  });
  for (const job of jobs) {
    try {
      const snapshot = renderJobSnapshotSchema.parse(JSON.parse(job.inputSnapshotJson));
      if (
        snapshot.assets.some((asset) => asset.assetId === assetId) ||
        snapshot.faceSets.some((faceSet) =>
          faceSet.layers.some((layer) => layer.assetId === assetId),
        )
      ) {
        references.push({ type: "render_job", id: job.id });
      }
    } catch {
      continue;
    }
  }

  return references;
}

export async function deleteAsset(
  prisma: PrismaClient,
  directories: DataDirectories,
  assetId: string,
): Promise<void> {
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    include: { renditions: true },
  });
  if (asset === null) {
    throw resourceNotFound("asset", assetId);
  }

  await prisma.$transaction(async (transaction) => {
    const references = await findAssetReferences(transaction, assetId);
    if (references.length > 0) {
      throw new ApiError(409, "ASSET_IN_USE", undefined, { assetId, references });
    }
    await transaction.assetRendition.deleteMany({ where: { assetId } });
    await transaction.job.deleteMany({ where: { assetId, kind: "asset_ingest" } });
    await transaction.asset.delete({ where: { id: assetId } });
  });

  const originalPath = resolveStoragePath(directories, asset.storageKey);
  const quarantinePath = resolveStoragePath(directories, `tmp/asset-trash-${randomUUID()}`);
  await mkdir(dirname(quarantinePath), { recursive: true }).catch(() => undefined);
  const quarantineResult = await rename(originalPath, quarantinePath)
    .then(() => "moved" as const)
    .catch(async (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return "failed" as const;
      }
      const original = await stat(originalPath).catch(() => null);
      if (original === null) {
        return "missing" as const;
      }
      const live = await prisma.asset
        .findUnique({ where: { storageKey: asset.storageKey }, select: { id: true } })
        .catch(() => null);
      return live === null ? ("failed" as const) : ("recreated" as const);
    });
  if (quarantineResult === "failed") {
    const live = await prisma.asset
      .findUnique({ where: { storageKey: asset.storageKey }, select: { id: true } })
      .catch(() => null);
    if (live === null) {
      await removeStorageFile(directories, asset.storageKey).catch(() => undefined);
    }
  }
  const quarantined = quarantineResult === "moved";
  if (quarantined) {
    const live = await prisma.asset
      .findUnique({ where: { storageKey: asset.storageKey }, select: { id: true } })
      .catch(() => null);
    if (live !== null) {
      const recreated = await stat(originalPath).catch(() => null);
      if (recreated === null) {
        await rename(quarantinePath, originalPath).catch(() => undefined);
      } else {
        await rm(quarantinePath, { force: true }).catch(() => undefined);
      }
    } else {
      await rm(quarantinePath, { force: true }).catch(() => undefined);
    }
  }
  for (const rendition of asset.renditions) {
    const stillReferenced = await prisma.assetRendition.count({
      where: { storageKey: rendition.storageKey, assetId: { not: assetId } },
    });
    if (stillReferenced === 0) {
      await removeStorageFile(directories, rendition.storageKey).catch(() => undefined);
    }
  }
}

async function locateContentFile(
  directories: DataDirectories,
  storageKey: string,
  expectedByteSize: number,
  assetId: string,
): Promise<string> {
  const path = resolveStoragePath(directories, storageKey);
  const info = await stat(path).catch(() => null);
  if (info === null || !info.isFile() || info.size !== expectedByteSize) {
    throw new ApiError(422, "ASSET_UNAVAILABLE", undefined, { assetIds: [assetId] });
  }
  return path;
}

export async function resolveAssetContent(
  prisma: PrismaClient,
  directories: DataDirectories,
  assetId: string,
  preferRendition: boolean,
): Promise<ContentLocation> {
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    include: { renditions: true },
  });
  if (asset === null) {
    throw resourceNotFound("asset", assetId);
  }

  if (asset.status === "processing") {
    throw new ApiError(409, "ASSET_PROCESSING", undefined, { assetIds: [assetId] });
  }
  if (asset.status === "failed") {
    throw new ApiError(422, "ASSET_UNAVAILABLE", undefined, { assetIds: [assetId] });
  }

  if (preferRendition) {
    const rendition = asset.renditions.find((row) => row.purpose === RENDITION_PURPOSE);
    if (rendition !== undefined) {
      const byteSize = bigIntToSafeNumber(rendition.byteSize);
      const path = await locateContentFile(directories, rendition.storageKey, byteSize, assetId);
      return { path, mediaType: rendition.mediaType, byteSize, sha256: rendition.sha256 };
    }
  }

  const byteSize = bigIntToSafeNumber(asset.byteSize);
  const path = await locateContentFile(directories, asset.storageKey, byteSize, assetId);
  return {
    path,
    mediaType: asset.mediaType,
    byteSize,
    sha256: asset.sha256,
  };
}
