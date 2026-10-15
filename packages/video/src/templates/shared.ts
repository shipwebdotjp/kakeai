import type { AssetResolver } from "../resolver";
import { CompositionCompileError } from "../compile-error";

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
  path: (string | number)[],
): ResolvedMedia {
  const resolved = assetResolver(assetId);
  if (resolved.kind === "audio") {
    throw new CompositionCompileError([
      { path, code: "invalid_asset_kind", message: "画像または動画を指定してください。" },
    ]);
  }
  return { url: resolved.url, kind: resolved.kind };
}

export function focalPointStyle(focalPoint: { x: number; y: number } | undefined): string {
  const point = focalPoint ?? { x: 0.5, y: 0.5 };
  return `object-position:${point.x * 100}% ${point.y * 100}%;`;
}

export function mediaCropStyle(
  focalPoint: { x: number; y: number } | undefined,
  zoom: number | undefined,
): string {
  const base = focalPointStyle(focalPoint);
  if (zoom === undefined) {
    return base;
  }
  const point = focalPoint ?? { x: 0.5, y: 0.5 };
  return `${base}transform:scale(${zoom});transform-origin:${point.x * 100}% ${point.y * 100}%;`;
}
