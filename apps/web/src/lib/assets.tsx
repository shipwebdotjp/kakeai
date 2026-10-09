import type { Asset } from "@kakeai/contracts";
import { renderContentUrl } from "../api/client";

export const KIND_LABEL: Record<Asset["kind"], string> = {
  image: "画像",
  video: "動画",
  audio: "音声",
};

export function assetLabel(asset: Asset): string {
  return `${asset.originalFilename}（${KIND_LABEL[asset.kind] ?? asset.kind}）`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(durationMs: number | null): string | null {
  if (durationMs === null) {
    return null;
  }
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

interface AssetThumbnailProps {
  asset: Asset;
  className?: string;
}

export function AssetThumbnail({ asset, className }: AssetThumbnailProps) {
  const url = renderContentUrl(asset.id);
  const base = className ?? "h-12 w-20";
  if (asset.kind === "image") {
    return (
      <img
        src={url}
        alt={asset.originalFilename}
        loading="lazy"
        decoding="async"
        className={`${base} rounded border border-border object-cover`}
      />
    );
  }
  if (asset.kind === "video") {
    return (
      <video
        src={url}
        muted
        playsInline
        preload="metadata"
        className={`${base} pointer-events-none rounded border border-border bg-black`}
      />
    );
  }
  return (
    <span
      className={`${base} inline-flex items-center justify-center rounded border border-border bg-surface-muted text-xs`}
    >
      {KIND_LABEL.audio}
    </span>
  );
}
