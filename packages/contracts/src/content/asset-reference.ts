export type AssetKindName = "image" | "video" | "audio";

export interface AssetReference {
  assetId: string;
  allowedKinds: readonly AssetKindName[];
  path: (string | number)[];
}
