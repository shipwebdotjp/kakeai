import { useState } from "react";
import type { Asset } from "@kakeai/contracts";
import { renderContentUrl } from "../api/client";
import { useAssets, useDeleteAsset, useUploadAssets, type UploadAssetsResult } from "../api/hooks";
import { errorMessage } from "../lib/errorMessage";
import { KIND_LABEL, formatBytes, formatDuration } from "../lib/assets";
import { FileDropZone, filesFromInput } from "../components/FileDropZone";
import {
  buttonDangerClass,
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
} from "../ui";

const STATUS_LABEL: Record<Asset["status"], string> = {
  processing: "取り込み中",
  ready: "準備完了",
  failed: "失敗",
};

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
  const uploadAssets = useUploadAssets();
  const deleteAsset = useDeleteAsset();
  const [pending, setPending] = useState<File[]>([]);
  const [failures, setFailures] = useState<UploadAssetsResult["failed"]>([]);

  const addFiles = (files: File[]) => {
    if (files.length === 0 || uploadAssets.isPending) {
      return;
    }
    setFailures([]);
    setPending((previous) => [...previous, ...files]);
  };

  const removePending = (index: number) => {
    setPending((previous) => previous.filter((_, currentIndex) => currentIndex !== index));
  };

  const onUpload = () => {
    if (pending.length === 0) {
      return;
    }
    const files = pending;
    uploadAssets.mutate(files, {
      onSuccess: (result) => {
        setFailures(result.failed);
        setPending(result.failed.map((entry) => entry.file));
      },
    });
  };

  return (
    <section>
      <h1 className="mb-4 text-2xl font-bold">素材ライブラリ</h1>

      <FileDropZone
        onFiles={addFiles}
        disabled={uploadAssets.isPending}
        className="my-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className={metaTextClass}>ここにファイルをドラッグ&amp;ドロップ</span>
          <input
            type="file"
            multiple
            accept="image/*,video/*,audio/*"
            disabled={uploadAssets.isPending}
            onChange={(event) => {
              addFiles(filesFromInput(event.target));
              event.target.value = "";
            }}
            className="text-sm"
          />
        </div>

        {pending.length > 0 && (
          <ul className="mt-2 list-none p-0">
            {pending.map((file, index) => (
              <li
                key={`${file.name}-${file.lastModified}-${index}`}
                className="flex items-center gap-2 border-t border-border py-1 text-sm first:border-t-0"
              >
                <span className="flex-1 truncate">{file.name}</span>
                <span className={metaTextClass}>{formatBytes(file.size)}</span>
                <button
                  type="button"
                  className={buttonNeutralClass}
                  disabled={uploadAssets.isPending}
                  onClick={() => removePending(index)}
                >
                  外す
                </button>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          className={`mt-2 ${buttonPrimaryClass}`}
          disabled={pending.length === 0 || uploadAssets.isPending}
          onClick={onUpload}
        >
          {uploadAssets.isPending
            ? "アップロード中…"
            : pending.length > 0
              ? `${pending.length}件をアップロード`
              : "アップロード"}
        </button>
      </FileDropZone>

      {uploadAssets.isError && (
        <p className={errorTextClass}>{errorMessage(uploadAssets.error)}</p>
      )}
      {failures.length > 0 && (
        <div className="rounded border border-red-400 bg-red-50 p-3 text-sm dark:bg-red-950/40">
          <strong>{failures.length}件のアップロードに失敗しました</strong>
          <ul>
            {failures.map((entry, index) => (
              <li key={`${entry.file.name}-${index}`}>
                {entry.file.name}: {errorMessage(entry.error)}
              </li>
            ))}
          </ul>
        </div>
      )}
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
