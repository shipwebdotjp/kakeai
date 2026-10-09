import { useRef, useState } from "react";
import type { Asset, AssetKindName } from "@kakeai/contracts";
import { renderContentUrl } from "../api/client";
import { useAssets, useUploadAsset } from "../api/hooks";
import { errorMessage } from "../lib/errorMessage";
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
  const upload = useUploadAsset();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);

  const selectable = (assets.data ?? []).filter(
    (asset) => asset.status === "ready" && kinds.includes(asset.kind),
  );
  const accept = kinds.map((kind) => `${kind}/*`).join(",");

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
        <div className="mt-2 rounded border border-border p-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept={accept}
              disabled={upload.isPending}
              className="text-sm"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file !== undefined) {
                  upload.mutate(file, {
                    onSuccess: () => {
                      if (inputRef.current !== null) {
                        inputRef.current.value = "";
                      }
                    },
                  });
                }
              }}
            />
            {upload.isPending && <span className={metaTextClass}>アップロード中…</span>}
          </div>
          {upload.isError && <p className={errorTextClass}>{errorMessage(upload.error)}</p>}

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
        </div>
      )}
    </div>
  );
}
