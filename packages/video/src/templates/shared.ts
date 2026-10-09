import type { AssetResolver } from "../resolver";

export interface RenderedMedia {
  html: string;
  assetIds: string[];
}

export interface ResolvedMedia {
  url: string;
  kind: "image" | "video";
}

export function resolveCueMedia(
  assetId: string,
  assetResolver: AssetResolver,
): ResolvedMedia {
  return assetResolver(assetId);
}

export function focalPointStyle(focalPoint: { x: number; y: number } | undefined): string {
  const point = focalPoint ?? { x: 0.5, y: 0.5 };
  return `object-position:${point.x * 100}% ${point.y * 100}%;`;
}
