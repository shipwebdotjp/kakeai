import { useEffect, useState } from "react";
import type { Asset, AssetKindName } from "@kakeai/contracts";
import { useAssets, useUploadAssets, type UploadAssetsResult } from "../api/hooks";
import { errorMessage } from "../lib/errorMessage";
import { AssetTagChips, AssetThumbnail, AssetTypeBadge } from "../lib/assets";
import { useAssetBrowser } from "../lib/useAssetBrowser";
import { errorTextClass, metaTextClass, textFieldClass } from "../ui";
import { AssetFilterControls, type AssetView } from "./AssetControls";
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

function selectCardClass(selected: boolean): string {
  return `flex w-full flex-col gap-1.5 rounded border p-1.5 text-left ${
    selected ? "border-brand-500 bg-surface-muted" : "border-border hover:bg-surface-muted"
  }`;
}

function selectRowClass(selected: boolean): string {
  return `flex w-full items-center gap-2 rounded border px-1.5 py-1 text-left ${
    selected ? "border-brand-500 bg-surface-muted" : "border-transparent hover:bg-surface-muted"
  }`;
}

function FavoriteMark() {
  return (
    <span className="text-amber-500" aria-label="お気に入り">
      ★
    </span>
  );
}

function ArchivedMark() {
  return (
    <span className="rounded border border-border px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
      アーカイブ
    </span>
  );
}

function emptyMessage(isFiltering: boolean, scopedCount: number): string {
  if (isFiltering) {
    return "一致する素材がありません。";
  }
  if (scopedCount > 0) {
    return "表示できる素材がありません。「アーカイブ」を表示すると出る場合があります。";
  }
  return "選択できる素材がありません。アップロードしてください。";
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
  const [view, setView] = useState<AssetView>("grid");
  const [failures, setFailures] = useState<UploadAssetsResult["failed"]>([]);
  const browser = useAssetBrowser(assets.data, { kinds, readyOnly: true });
  const {
    visible,
    scopedCount,
    allTags,
    isFiltering,
    query,
    setQuery,
    selectedTags,
    toggleTag,
    clearTags,
    kind,
    setKind,
    favoritesOnly,
    setFavoritesOnly,
    showArchived,
    setShowArchived,
    sort,
    setSort,
    reset,
  } = browser;

  useEffect(() => {
    if (open) {
      reset();
      setView("grid");
      setFailures([]);
    }
  }, [open, reset]);

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

  const choose = (asset: Asset) => {
    onSelect(asset.id);
    onClose();
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

      <div className="mt-2">
        <AssetFilterControls
          kind={kinds.length > 1 ? kind : undefined}
          kindOptions={kinds.length > 1 ? kinds : undefined}
          onKindChange={kinds.length > 1 ? setKind : undefined}
          sort={sort}
          onSortChange={setSort}
          favoritesOnly={favoritesOnly}
          onToggleFavorites={() => setFavoritesOnly((value) => !value)}
          showArchived={showArchived}
          onToggleArchived={() => setShowArchived((value) => !value)}
          view={view}
          onViewChange={setView}
        />
      </div>

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
      {!assets.isLoading && !assets.isError && visible.length === 0 && (
        <p className={metaTextClass}>{emptyMessage(isFiltering, scopedCount)}</p>
      )}

      {view === "grid" ? (
        <ul className="mt-3 grid list-none grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2 p-0">
          {visible.map((asset) => (
            <li key={asset.id}>
              <button
                type="button"
                className={selectCardClass(asset.id === selectedAssetId)}
                onClick={() => choose(asset)}
              >
                <AssetThumbnail asset={asset} className="h-24 w-full" />
                <span className="flex w-full items-center gap-1">
                  <AssetTypeBadge kind={asset.kind} />
                  {asset.favoritedAt !== null && <FavoriteMark />}
                  {asset.archivedAt !== null && <ArchivedMark />}
                  <AssetTagChips tags={asset.tags} max={2} className="min-w-0 overflow-hidden" />
                </span>
                <span className="w-full truncate text-xs" title={asset.originalFilename}>
                  {asset.originalFilename}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-3 list-none p-0">
          {visible.map((asset) => (
            <li key={asset.id}>
              <button
                type="button"
                className={selectRowClass(asset.id === selectedAssetId)}
                onClick={() => choose(asset)}
              >
                <AssetThumbnail asset={asset} className="h-8 w-12" />
                <AssetTypeBadge kind={asset.kind} />
                <span className="min-w-0 flex-1 truncate text-xs" title={asset.originalFilename}>
                  {asset.originalFilename}
                </span>
                <AssetTagChips tags={asset.tags} max={3} />
                {asset.archivedAt !== null && <ArchivedMark />}
                {asset.favoritedAt !== null && <FavoriteMark />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
