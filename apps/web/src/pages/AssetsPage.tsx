import { useRef, useState, type FormEvent } from "react";
import type { Asset } from "@kakeai/contracts";
import { renderContentUrl } from "../api/client";
import { useAssets, useDeleteAsset, useUploadAsset } from "../api/hooks";
import { errorMessage } from "../lib/errorMessage";
import {
  buttonDangerClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
} from "../ui";

const KIND_LABEL: Record<Asset["kind"], string> = {
  image: "画像",
  video: "動画",
  audio: "音声",
};

const STATUS_LABEL: Record<Asset["status"], string> = {
  processing: "取り込み中",
  ready: "準備完了",
  failed: "失敗",
};

function formatBytes(bytes: number): string {
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

function formatDuration(durationMs: number | null): string | null {
  if (durationMs === null) {
    return null;
  }
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function AssetPreview({ asset }: { asset: Asset }) {
  if (asset.status !== "ready") {
    return <div className="h-16 w-24 rounded bg-surface-muted" />;
  }
  const renderUrl = renderContentUrl(asset.id);
  if (asset.kind === "image") {
    return (
      <img
        src={renderUrl}
        alt={asset.originalFilename}
        className="h-16 w-24 rounded border border-border object-cover"
      />
    );
  }
  if (asset.kind === "video") {
    return (
      <video
        src={renderUrl}
        controls
        preload="metadata"
        className="h-16 w-24 rounded border border-border bg-black"
      />
    );
  }
  return <audio src={renderUrl} controls preload="metadata" className="w-48" />;
}

export function AssetsPage() {
  const assets = useAssets();
  const uploadAsset = useUploadAsset();
  const deleteAsset = useDeleteAsset();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File | null>(null);

  const onUpload = (event: FormEvent) => {
    event.preventDefault();
    if (selected === null) {
      return;
    }
    uploadAsset.mutate(selected, {
      onSuccess: () => {
        setSelected(null);
        if (inputRef.current !== null) {
          inputRef.current.value = "";
        }
      },
    });
  };

  return (
    <section>
      <h1 className="mb-4 text-2xl font-bold">素材ライブラリ</h1>

      <form onSubmit={onUpload} className="my-3 flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*,audio/*"
          onChange={(event) => setSelected(event.target.files?.[0] ?? null)}
          className="text-sm"
        />
        <button type="submit" className={buttonPrimaryClass} disabled={selected === null || uploadAsset.isPending}>
          アップロード
        </button>
      </form>
      {uploadAsset.isError && <p className={errorTextClass}>{errorMessage(uploadAsset.error)}</p>}
      {deleteAsset.isError && <p className={errorTextClass}>{errorMessage(deleteAsset.error)}</p>}

      {assets.isLoading && <p>読み込み中…</p>}
      {assets.isError && <p className={errorTextClass}>{errorMessage(assets.error)}</p>}

      <ul className="list-none p-0">
        {assets.data?.map((asset) => {
          const duration = formatDuration(asset.durationMs);
          const dimensions =
            asset.widthPx !== null && asset.heightPx !== null
              ? `${asset.widthPx}×${asset.heightPx}`
              : null;
          return (
            <li key={asset.id} className="flex items-center gap-3 border-b border-border py-2.5">
              <AssetPreview asset={asset} />
              <div className="flex-1">
                <p className="font-semibold">{asset.originalFilename}</p>
                <p className={metaTextClass}>
                  {KIND_LABEL[asset.kind]} ・ {formatBytes(asset.byteSize)}
                  {dimensions !== null ? ` ・ ${dimensions}` : ""}
                  {duration !== null ? ` ・ ${duration}` : ""}
                </p>
              </div>
              <span
                className={
                  asset.status === "failed" ? errorTextClass : metaTextClass
                }
              >
                {STATUS_LABEL[asset.status]}
              </span>
              <button
                type="button"
                className={buttonDangerClass}
                disabled={deleteAsset.isPending}
                onClick={() => {
                  if (window.confirm(`「${asset.originalFilename}」を削除しますか？`)) {
                    deleteAsset.mutate(asset.id);
                  }
                }}
              >
                削除
              </button>
            </li>
          );
        })}
      </ul>
      {assets.data?.length === 0 && <p>素材がありません。上のフォームからアップロードしてください。</p>}
    </section>
  );
}
