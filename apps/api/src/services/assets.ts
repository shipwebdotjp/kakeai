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
import type {
  Asset as AssetRow,
  Prisma,
  PrismaClient,
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
 */
const ASSET_LIST_ORDER_BY: Record<AssetListSort, Prisma.AssetOrderByWithRelationInput[]> = {
  createdAt_desc: [{ createdAt: "desc" }, { id: "desc" }],
  createdAt_asc: [{ createdAt: "asc" }, { id: "asc" }],
  filename_asc: [{ originalFilename: "asc" }, { id: "asc" }],
  duration_asc: [{ durationMs: { sort: "asc", nulls: "last" } }, { id: "asc" }],
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

function archivedWhere(mode: AssetListQuery["archived"]): Prisma.AssetWhereInput {
  if (mode === "exclude") {
    return { archivedAt: null };
  }
  if (mode === "only") {
    return { archivedAt: { not: null } };
  }
  return {};
}

function durationWhere(query: AssetListQuery): Prisma.AssetWhereInput {
  if (query.durationMinMs === undefined && query.durationMaxMs === undefined) {
    return {};
  }
  return {
    durationMs: {
      ...(query.durationMinMs === undefined ? {} : { gte: query.durationMinMs }),
      ...(query.durationMaxMs === undefined ? {} : { lte: query.durationMaxMs }),
    },
  };
}

/**
 * The filter set of one search. It is used for the page and for the total
 * count, so both always describe the same set of assets.
 */
function assetFilters(query: AssetListQuery): Prisma.AssetWhereInput {
  const wanted = query.tags ?? [];
  const andConditions: Prisma.AssetWhereInput[] = [];
  if (wanted.length > 0) {
    // A tag matches when it appears as a quoted element of the stored tag
    // array, so `bgm` never matches `bgm_loop`. The comparison goes through
    // SQLite's LIKE, which ignores the case of ASCII letters and reads `_`
    // and `%` inside a tag as wildcards.
    const tagConditions = wanted.map((tag) => ({
      tagsJson: { contains: JSON.stringify(tag) },
    }));
    andConditions.push(
      query.tagMode === "or" ? { OR: tagConditions } : { AND: tagConditions },
    );
  }

  return {
    ...archivedWhere(query.archived),
    ...(query.kind === undefined ? {} : { kind: query.kind }),
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.filename === undefined
      ? {}
      : { originalFilename: { contains: query.filename } }),
    ...(query.favorite === undefined
      ? {}
      : { favoritedAt: query.favorite ? { not: null } : null }),
    ...(query.hasAudio === undefined ? {} : { hasAudio: query.hasAudio }),
    ...durationWhere(query),
    ...(andConditions.length > 0 ? { AND: andConditions } : {}),
  };
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
  const filters = assetFilters(query);
  const where: Prisma.AssetWhereInput =
    query.cursor === undefined
      ? filters
      : { AND: [filters, cursorWhere(decodeAssetCursor(query.cursor, sort))] };

  const [rows, total] = await Promise.all([
    prisma.asset.findMany({
      where,
      orderBy: ASSET_LIST_ORDER_BY[sort],
      take: limit + 1,
    }),
    prisma.asset.count({ where: filters }),
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
