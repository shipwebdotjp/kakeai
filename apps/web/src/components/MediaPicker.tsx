import { useState } from "react";
import type { Asset, AssetKindName } from "@kakeai/contracts";
import { renderContentUrl } from "../api/client";
import { useAssets, useUploadAssets, type UploadAssetsResult } from "../api/hooks";
import { errorMessage } from "../lib/errorMessage";
import { FileDropZone, filesFromInput } from "./FileDropZone";
import { buttonNeutralClass, errorTextClass, metaTextClass } from "../ui";

interface MediaPickerProps {
  label: string;
  kinds: readonly AssetKindName[];
  selectedAssetId: string | null;
  onSelect: (assetId: string | null) => void;
}

const KIND_LABEL: Record<Asset["kind"], string> = {
  image: "画像",
  video: "動画",
  audio: "音声",
};

function assetLabel(asset: Asset): string {
  return `${asset.originalFilename}（${KIND_LABEL[asset.kind]}）`;
}

function Thumbnail({ asset }: { asset: Asset }) {
  const url = renderContentUrl(asset.id);
  if (asset.kind === "image") {
    return (
      <img
        src={url}
        alt={asset.originalFilename}
        loading="lazy"
        decoding="async"
        className="h-12 w-20 rounded border border-border object-cover"
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
        className="pointer-events-none h-12 w-20 rounded border border-border bg-black"
      />
    );
  }
  return <span className="text-xs">{KIND_LABEL.audio}</span>;
}

export function MediaPicker({ label, kinds, selectedAssetId, onSelect }: MediaPickerProps) {
  const assets = useAssets();
  const upload = useUploadAssets();
  const [open, setOpen] = useState(false);
  const [failures, setFailures] = useState<UploadAssetsResult["failed"]>([]);

  const selectable = (assets.data ?? []).filter(
    (asset) => asset.status === "ready" && kinds.includes(asset.kind),
  );
  const accept = kinds.map((kind) => `${kind}/*`).join(",");

  const onFiles = (files: File[]) => {
    if (files.length === 0 || upload.isPending) {
      return;
    }
    setFailures([]);
    upload.mutate(files, {
      onSuccess: (result) => {
        setFailures(result.failed);
      },
    });
  };

  return (
    <div className="my-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{label}</span>
        <button type="button" className={buttonNeutralClass} onClick={() => setOpen((v) => !v)}>
          {open ? "閉じる" : "選択"}
        </button>
        {selectedAssetId === null ? (
          <span className={metaTextClass}>未指定</span>
        ) : (
          <button type="button" className={buttonNeutralClass} onClick={() => onSelect(null)}>
            解除
          </button>
        )}
      </div>

      {open && (
        <FileDropZone onFiles={onFiles} disabled={upload.isPending} className="mt-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              multiple
              accept={accept}
              disabled={upload.isPending}
              className="text-sm"
              onChange={(event) => {
                const files = filesFromInput(event.target);
                event.target.value = "";
                onFiles(files);
              }}
            />
            {upload.isPending && <span className={metaTextClass}>アップロード中…</span>}
          </div>
          <p className={metaTextClass}>ここにファイルをドラッグ&amp;ドロップでも追加できます。</p>
          {upload.isError && <p className={errorTextClass}>{errorMessage(upload.error)}</p>}
          {failures.length > 0 && (
            <div className="rounded border border-red-400 bg-red-50 p-2 text-sm dark:bg-red-950/40">
              <ul>
                {failures.map((entry, index) => (
                  <li key={`${entry.file.name}-${index}`}>
                    {entry.file.name}: {errorMessage(entry.error)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {assets.isLoading && <p className={metaTextClass}>読み込み中…</p>}
          {assets.isError && <p className={errorTextClass}>{errorMessage(assets.error)}</p>}
          {selectable.length === 0 && !assets.isLoading && !assets.isError && (
            <p className={metaTextClass}>選択できる素材がありません。アップロードしてください。</p>
          )}
          <ul className="mt-2 grid list-none grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2 p-0">
            {selectable.map((asset) => (
              <li key={asset.id}>
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 rounded border p-1.5 text-left ${
                    asset.id === selectedAssetId
                      ? "border-brand-500 bg-surface-muted"
                      : "border-border"
                  }`}
                  onClick={() => onSelect(asset.id)}
                >
                  <Thumbnail asset={asset} />
                  <span className="truncate text-xs">{assetLabel(asset)}</span>
                </button>
              </li>
            ))}
          </ul>
        </FileDropZone>
      )}
    </div>
  );
}
