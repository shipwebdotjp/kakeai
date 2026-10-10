import { useEffect, useMemo, useState } from "react";
import type { AssetKindName } from "@kakeai/contracts";
import { useAssets, useUploadAssets, type UploadAssetsResult } from "../api/hooks";
import { errorMessage } from "../lib/errorMessage";
import { AssetThumbnail, assetLabel } from "../lib/assets";
import { useAssetTagFilter } from "../lib/useAssetTagFilter";
import { errorTextClass, metaTextClass, textFieldClass } from "../ui";
import { FileDropZone, filesFromInput } from "./FileDropZone";
import { Modal } from "./Modal";
import { TagFilter } from "./AssetTags";

interface MediaLibraryModalProps {
  open: boolean;
  onClose: () => void;
  kinds: readonly AssetKindName[];
  selectedAssetId: string | null;
  onSelect: (assetId: string) => void;
}

export function MediaLibraryModal({
  open,
  onClose,
  kinds,
  selectedAssetId,
  onSelect,
}: MediaLibraryModalProps) {
  const assets = useAssets();
  const upload = useUploadAssets();
  const [query, setQuery] = useState("");
  const [failures, setFailures] = useState<UploadAssetsResult["failed"]>([]);

  const candidates = useMemo(
    () => (assets.data ?? []).filter((asset) => asset.status === "ready" && kinds.includes(asset.kind)),
    [assets.data, kinds],
  );
  const { allTags, matches, selectedTags, toggleTag, clearTags } = useAssetTagFilter(candidates);

  useEffect(() => {
    if (open) {
      setQuery("");
      clearTags();
      setFailures([]);
    }
  }, [open, clearTags]);

  const accept = kinds.map((kind) => `${kind}/*`).join(",");
  const keyword = query.trim().toLowerCase();
  const selectable = matches.filter(
    (asset) => keyword.length === 0 || asset.originalFilename.toLowerCase().includes(keyword),
  );

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
    <Modal open={open} onClose={onClose} title="素材ライブラリ">
      <FileDropZone onFiles={onFiles} disabled={upload.isPending}>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            placeholder="ファイル名で検索"
            aria-label="ファイル名で検索"
            className={`min-w-[200px] flex-1 ${textFieldClass}`}
            onChange={(event) => setQuery(event.target.value)}
          />
          <input
            type="file"
            multiple
            accept={accept}
            aria-label="素材をアップロード"
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
      </FileDropZone>

      {allTags.length > 0 && (
        <div className="mt-2">
          <TagFilter
            allTags={allTags}
            selected={selectedTags}
            onToggle={toggleTag}
            onClear={clearTags}
          />
        </div>
      )}

      {upload.isError && <p className={errorTextClass}>{errorMessage(upload.error)}</p>}
      {failures.length > 0 && (
        <div className="mt-2 rounded border border-red-400 bg-red-50 p-2 text-sm dark:bg-red-950/40">
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
      {!assets.isLoading && !assets.isError && selectable.length === 0 && (
        <p className={metaTextClass}>
          {keyword.length > 0 || selectedTags.length > 0
            ? "一致する素材がありません。"
            : "選択できる素材がありません。アップロードしてください。"}
        </p>
      )}

      <ul className="mt-3 grid list-none grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2 p-0">
        {selectable.map((asset) => (
          <li key={asset.id}>
            <button
              type="button"
              className={`flex w-full items-center gap-2 rounded border p-1.5 text-left ${
                asset.id === selectedAssetId ? "border-brand-500 bg-surface-muted" : "border-border"
              }`}
              onClick={() => {
                onSelect(asset.id);
                onClose();
              }}
            >
              <AssetThumbnail asset={asset} />
              <span className="truncate text-xs">{assetLabel(asset)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
