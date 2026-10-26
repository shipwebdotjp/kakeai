import type { ContentLocation } from "./ingest";
import { stat } from "node:fs/promises";
import { RENDITION_PURPOSE } from "@kakeai/contracts";
import { bigIntToSafeNumber } from "../../dto/mappers.ts";
import { type PrismaClient } from "../../generated/prisma/client.ts";
import { ApiError } from "../../http/errors.ts";
import { resourceNotFound } from "../../http/validation.ts";
import { resolveStoragePath } from "../../storage/asset-store.ts";
import type { DataDirectories } from "../../storage/paths.ts";

async function locateContentFile(
  directories: DataDirectories,
  storageKey: string,
  expectedByteSize: number,
  assetId: string,
): Promise<string> {
  const path = resolveStoragePath(directories, storageKey);
  const info = await stat(path).catch(() => null);
  if (info === null || !info.isFile() || info.size !== expectedByteSize) {
    throw new ApiError(422, "ASSET_UNAVAILABLE", undefined, {
      assetIds: [assetId],
    });
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
    throw new ApiError(409, "ASSET_PROCESSING", undefined, {
      assetIds: [assetId],
    });
  }
  if (asset.status === "failed") {
    throw new ApiError(422, "ASSET_UNAVAILABLE", undefined, {
      assetIds: [assetId],
    });
  }

  if (preferRendition) {
    const rendition = asset.renditions.find(
      (row) => row.purpose === RENDITION_PURPOSE,
    );
    if (rendition !== undefined) {
      const byteSize = bigIntToSafeNumber(rendition.byteSize);
      const path = await locateContentFile(
        directories,
        rendition.storageKey,
        byteSize,
        assetId,
      );
      return {
        path,
        mediaType: rendition.mediaType,
        byteSize,
        sha256: rendition.sha256,
      };
    }
  }

  const byteSize = bigIntToSafeNumber(asset.byteSize);
  const path = await locateContentFile(
    directories,
    asset.storageKey,
    byteSize,
    assetId,
  );
  return {
    path,
    mediaType: asset.mediaType,
    byteSize,
    sha256: asset.sha256,
  };
}
