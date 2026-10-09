export type ResolvedAssetKind = "image" | "video" | "audio";

export interface ResolvedAsset {
  url: string;
  kind: ResolvedAssetKind;
  durationMs?: number | null;
}

export type AssetResolver = (assetId: string) => ResolvedAsset;
