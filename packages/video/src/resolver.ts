import type { SnapshotFaceSet } from "@kakeai/contracts";

export type ResolvedAssetKind = "image" | "video" | "audio";

export interface ResolvedAsset {
  url: string;
  kind: ResolvedAssetKind;
  durationMs?: number | null;
}

export type AssetResolver = (assetId: string) => ResolvedAsset;

export type FaceSetResolver = (faceSetId: string) => SnapshotFaceSet;
