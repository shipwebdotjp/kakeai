import type { SnapshotFaceSet } from "@kakeai/contracts";

export type ResolvedAssetKind = "image" | "video" | "audio";

export interface ResolvedAsset {
  url: string;
  kind: ResolvedAssetKind;
  durationMs?: number | null;
}

export type AssetResolver = (assetId: string) => ResolvedAsset;

/**
 * セリフゲート保持区間の静止フレームURLを返す。sourceMs は元動画の先頭からの
 * ミリ秒で、実フレーム解決は実装（プレビュー/レンダー）側が行う。
 */
export type StillResolver = (assetId: string, sourceMs: number) => string;

export type FaceSetResolver = (faceSetId: string, version: number) => SnapshotFaceSet;
