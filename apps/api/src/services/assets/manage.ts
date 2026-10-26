import { isPrismaCode } from "./internal";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import {
  assetTagsSchema,
  collectAssetReferences,
  renderJobSnapshotSchema,
  type Asset,
} from "@kakeai/contracts";
import { deserializeContent } from "../../domain/content-json.ts";
import { toAsset } from "../../dto/mappers.ts";
import { Prisma, type PrismaClient } from "../../generated/prisma/client.ts";
import { ApiError } from "../../http/errors.ts";
import { resourceNotFound } from "../../http/validation.ts";
import {
  removeStorageFile,
  resolveStoragePath,
} from "../../storage/asset-store.ts";
import type { DataDirectories } from "../../storage/paths.ts";

export async function getAsset(
  prisma: PrismaClient,
  assetId: string,
): Promise<Asset> {
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
      if (
        collectAssetReferences(content).some(
          (reference) => reference.assetId === assetId,
        )
      ) {
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
      const snapshot = renderJobSnapshotSchema.parse(
        JSON.parse(job.inputSnapshotJson),
      );
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
      throw new ApiError(409, "ASSET_IN_USE", undefined, {
        assetId,
        references,
      });
    }
    await transaction.assetRendition.deleteMany({ where: { assetId } });
    await transaction.job.deleteMany({
      where: { assetId, kind: "asset_ingest" },
    });
    await transaction.asset.delete({ where: { id: assetId } });
  });

  const originalPath = resolveStoragePath(directories, asset.storageKey);
  const quarantinePath = resolveStoragePath(
    directories,
    `tmp/asset-trash-${randomUUID()}`,
  );
  await mkdir(dirname(quarantinePath), { recursive: true }).catch(
    () => undefined,
  );
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
        .findUnique({
          where: { storageKey: asset.storageKey },
          select: { id: true },
        })
        .catch(() => null);
      return live === null ? ("failed" as const) : ("recreated" as const);
    });
  if (quarantineResult === "failed") {
    const live = await prisma.asset
      .findUnique({
        where: { storageKey: asset.storageKey },
        select: { id: true },
      })
      .catch(() => null);
    if (live === null) {
      await removeStorageFile(directories, asset.storageKey).catch(
        () => undefined,
      );
    }
  }
  const quarantined = quarantineResult === "moved";
  if (quarantined) {
    const live = await prisma.asset
      .findUnique({
        where: { storageKey: asset.storageKey },
        select: { id: true },
      })
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
      await removeStorageFile(directories, rendition.storageKey).catch(
        () => undefined,
      );
    }
  }
}
