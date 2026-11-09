import { RENDITION_PURPOSE, type LiveAssetSnapshot } from "@kakeai/contracts";
import type { Prisma } from "../generated/prisma/client.ts";
import { bigIntToSafeNumber } from "../dto/mappers.ts";
import { ApiError } from "../http/errors.ts";

export type AssetWithRenditions = Prisma.AssetGetPayload<{
  include: { renditions: true };
}>;

export function renditionOf(asset: AssetWithRenditions) {
  return asset.renditions.find((entry) => entry.purpose === RENDITION_PURPOSE);
}

export function toLiveAssetSnapshot(asset: AssetWithRenditions): LiveAssetSnapshot {
  if (asset.kind !== "image" && asset.kind !== "video" && asset.kind !== "audio") {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      `未対応の Asset 種別です: ${asset.id} (${asset.kind})`,
    );
  }
  const rendition = renditionOf(asset);
  const source = rendition ?? asset;
  return {
    assetId: asset.id,
    renditionId: rendition?.id ?? null,
    kind: asset.kind,
    mediaType: source.mediaType,
    sha256: source.sha256,
    byteSize: bigIntToSafeNumber(source.byteSize),
    durationMs: rendition?.durationMs ?? asset.durationMs,
    widthPx: source.widthPx,
    heightPx: source.heightPx,
    hasAudio: asset.hasAudio,
  };
}
