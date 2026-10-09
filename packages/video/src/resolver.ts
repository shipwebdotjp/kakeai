export type ResolvedAssetKind = "image" | "video";

export interface ResolvedAsset {
  url: string;
  kind: ResolvedAssetKind;
}

export type AssetResolver = (assetId: string) => ResolvedAsset;
