import { stat } from "node:fs/promises";
import type { SnapshotAssetRef } from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { bigIntToSafeNumber } from "../dto/mappers.ts";
import { hashFile, resolveStoragePath } from "../storage/asset-store.ts";
import type { AppConfig } from "../config.ts";
import { LiveExportError } from "./errors";
import type { ResolvedAssetFile } from "./profile-resolution";

/**
 * Loads the exact Asset/Rendition bytes frozen in the Job snapshot. The DB row
 * is used only for the storage key; sha, size and media type are checked
 * against the snapshot so a later Asset replacement cannot change the package.
 */
export async function loadSnapshotAssets(
  prisma: PrismaClient,
  config: AppConfig,
  assets: readonly SnapshotAssetRef[],
): Promise<Map<string, ResolvedAssetFile>> {
  const ids = [...new Set(assets.map((asset) => asset.assetId))];
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await prisma.asset.findMany({
    where: { id: { in: ids } },
    include: { renditions: true },
  });
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const result = new Map<string, ResolvedAssetFile>();

  for (const reference of assets) {
    const row = rowById.get(reference.assetId);
    if (row === undefined || row.status !== "ready") {
      throw new LiveExportError(
        "LIVE_EXPORT_INPUT_INVALID",
        "input",
        `素材を利用できません: ${reference.assetId}`,
        reference.assetId,
      );
    }
    const source =
      reference.renditionId === null
        ? row
        : row.renditions.find((rendition) => rendition.id === reference.renditionId);
    if (source === undefined) {
      throw new LiveExportError(
        "LIVE_EXPORT_INPUT_INVALID",
        "input",
        `素材のRenditionが見つかりません: ${reference.assetId}`,
        reference.assetId,
      );
    }
    if (
      source.sha256 !== reference.sha256 ||
      source.mediaType !== reference.mediaType ||
      bigIntToSafeNumber(source.byteSize) !== reference.byteSize
    ) {
      throw new LiveExportError(
        "LIVE_EXPORT_INPUT_INVALID",
        "input",
        `素材のメタデータがスナップショットと一致しません: ${reference.assetId}`,
        reference.assetId,
      );
    }
    if (row.kind !== "image" && row.kind !== "video" && row.kind !== "audio") {
      throw new LiveExportError(
        "LIVE_EXPORT_INPUT_INVALID",
        "input",
        `素材の種別が不正です: ${reference.assetId}`,
        reference.assetId,
      );
    }
    const path = resolveStoragePath(config.directories, source.storageKey);
    const info = await stat(path).catch(() => null);
    if (info === null || !info.isFile() || info.size !== reference.byteSize) {
      throw new LiveExportError(
        "LIVE_EXPORT_INPUT_INVALID",
        "input",
        `素材ファイルを利用できません: ${reference.assetId}`,
        reference.assetId,
      );
    }
    const digest = await hashFile(path);
    if (digest.sha256 !== reference.sha256 || digest.byteSize !== reference.byteSize) {
      throw new LiveExportError(
        "LIVE_EXPORT_INPUT_INVALID",
        "input",
        `素材ファイルのハッシュがスナップショットと一致しません: ${reference.assetId}`,
        reference.assetId,
      );
    }
    result.set(reference.assetId, {
      assetId: reference.assetId,
      path,
      kind: row.kind,
      mediaType: reference.mediaType,
      sha256: reference.sha256,
      byteSize: reference.byteSize,
      durationMs: reference.durationMs,
      widthPx: reference.widthPx,
      heightPx: reference.heightPx,
      hasAudio: row.hasAudio,
    });
  }
  return result;
}
