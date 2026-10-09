import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import {
  RENDITION_PURPOSE,
  SNAPSHOT_SCHEMA_VERSION,
  assetIngestJobSnapshotSchema,
  collectAssetReferences,
  renderJobSnapshotSchema,
  type Asset,
  type AssetKindName,
} from "@kakeai/contracts";
import type { LimitsConfig } from "../config.ts";
import { deserializeContent } from "../domain/content-json.ts";
import { bigIntToSafeNumber, toAsset } from "../dto/mappers.ts";
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { ApiError } from "../http/errors.ts";
import { resourceNotFound } from "../http/validation.ts";
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
}

export interface IngestOutcome {
  asset: Asset;
  deduplicated: boolean;
  httpStatus: 200 | 202;
}

export interface ContentLocation {
  path: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
}

type Transaction = Prisma.TransactionClient;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
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

async function requeueExisting(
  prisma: PrismaClient,
  existing: { id: string; sha256: string; mediaType: string; storageKey: string },
): Promise<IngestOutcome> {
  const updated = await prisma.$transaction(async (transaction) => {
    const asset = await transaction.asset.update({
      where: { id: existing.id },
      data: { status: "processing" },
    });
    await createIngestJob(transaction, asset);
    return asset;
  });
  return { asset: toAsset(updated), deduplicated: true, httpStatus: 202 };
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
      return {
        asset: toAsset(existing),
        deduplicated: true,
        httpStatus: existing.status === "ready" ? 200 : 202,
      };
    }
    await inspectUpload(input.tempPath, limits);
    if (matches) {
      await rm(input.tempPath, { force: true });
    } else {
      await commitFile(input.tempPath, existing.storageKey, directories);
    }
    return requeueExisting(prisma, existing);
  }

  const { kind, mediaType } = await inspectUpload(input.tempPath, limits);
  await commitFile(input.tempPath, storageKey, directories);
  try {
    const created = await prisma.$transaction(async (transaction) => {
      const asset = await transaction.asset.create({
        data: {
          kind,
          origin: "uploaded",
          status: "processing",
          storageKey,
          originalFilename: input.originalFilename,
          mediaType,
          byteSize: BigInt(input.byteSize),
          sha256: input.sha256,
        },
      });
      await createIngestJob(transaction, asset);
      return asset;
    });
    return { asset: toAsset(created), deduplicated: false, httpStatus: 202 };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await prisma.asset.findUnique({ where: { sha256: input.sha256 } });
      if (raced !== null) {
        return requeueExisting(prisma, raced);
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

export async function listAssets(prisma: PrismaClient, kind?: AssetKindName): Promise<Asset[]> {
  const rows = await prisma.asset.findMany({
    where: kind === undefined ? undefined : { kind },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toAsset);
}

export async function getAsset(prisma: PrismaClient, assetId: string): Promise<Asset> {
  const row = await prisma.asset.findUnique({ where: { id: assetId } });
  if (row === null) {
    throw resourceNotFound("asset", assetId);
  }
  return toAsset(row);
}

interface AssetReference {
  type: "script_version" | "render_job";
  id: string;
}

async function findAssetReferences(
  client: Prisma.TransactionClient,
  assetId: string,
): Promise<AssetReference[]> {
  const references: AssetReference[] = [];

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
      if (snapshot.assets.some((asset) => asset.assetId === assetId)) {
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
