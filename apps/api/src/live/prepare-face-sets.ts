import {
  type LiveFaceSet,
  type LiveFaceSetLayer,
  type SnapshotFaceSet,
} from "@kakeai/contracts";
import { LiveExportError } from "./errors.ts";
import { toLiveMediaType } from "./media-types.ts";
import type { PackageWriter } from "./package-writer.ts";
import type { ResolvedAssetFile } from "./resolved-assets.ts";

function fail(message: string, id: string | null = null): never {
  throw new LiveExportError("LIVE_EXPORT_MATERIAL_FAILED", "material", message, id);
}

async function writeImageAsset(
  writer: PackageWriter,
  assetById: Map<string, ResolvedAssetFile>,
  assetId: string,
  usage: string,
): Promise<string> {
  const asset = assetById.get(assetId);
  if (asset === undefined) {
    fail(`${usage} の画像が見つかりません: ${assetId}`, assetId);
  }
  if (asset.kind !== "image") {
    fail(`${usage} は画像ではありません: ${assetId}`, assetId);
  }
  return writer.writeAsset(asset.path, {
    mediaType: toLiveMediaType(asset.mediaType, assetId),
    kind: "asset",
    durationMs: null,
    width: asset.widthPx,
    height: asset.heightPx,
    hasAudio: false,
  });
}

/** Writes every layer of a pinned Face Set revision into the package. */
export async function prepareFaceSet(
  faceSet: SnapshotFaceSet,
  assetById: Map<string, ResolvedAssetFile>,
  writer: PackageWriter,
): Promise<LiveFaceSet> {
  const layerById = new Map(faceSet.layers.map((layer) => [layer.id, layer]));
  const layers: LiveFaceSetLayer[] = [];
  for (const layer of faceSet.layers) {
    const file = await writeImageAsset(writer, assetById, layer.assetId, "顔レイヤー");
    const blink = layer.blinkLayerId === null ? undefined : layerById.get(layer.blinkLayerId);
    if (layer.blinkLayerId !== null && blink === undefined) {
      fail(`瞬きレイヤーが見つかりません: ${layer.blinkLayerId}`, layer.id);
    }
    const speaking =
      layer.speakingLayerId === null ? undefined : layerById.get(layer.speakingLayerId);
    if (layer.speakingLayerId !== null && speaking === undefined) {
      fail(`口パクレイヤーが見つかりません: ${layer.speakingLayerId}`, layer.id);
    }
    const blinkFile =
      blink === undefined
        ? undefined
        : await writeImageAsset(writer, assetById, blink.assetId, "瞬きレイヤー");
    const speakingFile =
      speaking === undefined
        ? undefined
        : await writeImageAsset(writer, assetById, speaking.assetId, "口パクレイヤー");
    layers.push({
      id: layer.id,
      part: layer.part,
      file,
      ...(blinkFile === undefined ? {} : { blinkFile }),
      ...(speakingFile === undefined ? {} : { speakingFile }),
    });
  }
  return {
    id: faceSet.id,
    version: faceSet.version ?? 1,
    layers,
    expressions: faceSet.expressions.map((expression) => ({ ...expression })),
  };
}
