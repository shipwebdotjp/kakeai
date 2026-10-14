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

export function AssetTypeBadge({ kind }: { kind: Asset["kind"] }) {
  return (
    <span className="rounded border border-border bg-surface-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
      {KIND_LABEL[kind] ?? kind}
    </span>
  );
}

export function AssetTagChips({
  tags,
  max,
  className,
}: {
  tags: readonly string[];
  max?: number;
  className?: string;
}) {
  if (tags.length === 0) {
    return null;
  }
  const shown = max === undefined ? tags : tags.slice(0, max);
  const rest = tags.length - shown.length;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className ?? ""}`}>
      {shown.map((tag) => (
        <span
          key={tag}
          className="rounded-full border border-border px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground"
        >
          {tag}
        </span>
      ))}
      {rest > 0 && <span className="text-[10px] text-muted-foreground">+{rest}</span>}
    </span>
  );
}

export function AssetFavoriteButton({
  favorited,
  disabled,
  onToggle,
}: {
  favorited: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`text-sm leading-none ${
        favorited ? "text-amber-500" : "text-muted-foreground hover:text-foreground"
      }`}
      disabled={disabled}
      aria-pressed={favorited}
      aria-label={favorited ? "お気に入りを解除" : "お気に入りに追加"}
      onClick={onToggle}
    >
      {favorited ? "★" : "☆"}
    </button>
  );
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
