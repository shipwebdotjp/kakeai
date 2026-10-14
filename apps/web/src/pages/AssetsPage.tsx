import { useState } from "react";
import type { Asset } from "@kakeai/contracts";
import { renderContentUrl } from "../api/client";
import {
  useAssets,
  useCleanupAssets,
  useDeleteAsset,
  useUpdateAsset,
  useUploadAssets,
  type CleanupAssetsResult,
  type UploadAssetsResult,
} from "../api/hooks";
import { errorMessage } from "../lib/errorMessage";
import {
  AssetFavoriteButton,
  AssetTagChips,
  AssetTypeBadge,
  formatBytes,
  formatDuration,
  KIND_LABEL,
} from "../lib/assets";
import { useAssetBrowser } from "../lib/useAssetBrowser";
import { AssetFilterControls, type AssetView } from "../components/AssetControls";
import { AssetTagEditor, TagFilter } from "../components/AssetTags";
import { FileDropZone, filesFromInput } from "../components/FileDropZone";
import {
  buttonDangerClass,
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
  textFieldClass,
} from "../ui";

const STATUS_LABEL: Record<Asset["status"], string> = {
  processing: "取り込み中",
  ready: "準備完了",
  failed: "失敗",
};

function archiveButtonLabel(archived: boolean, compact: boolean): string {
  if (!archived) {
    return "アーカイブ";
  }
  return compact ? "戻す" : "アーカイブを戻す";
}

function AssetPreview({ asset, variant }: { asset: Asset; variant: AssetView }) {
  const size = variant === "grid" ? "h-32 w-full" : "h-16 w-24";
  if (asset.status !== "ready") {
    return <div className={`${size} rounded bg-surface-muted`} />;
  }
  const renderUrl = renderContentUrl(asset.id);
  if (asset.kind === "image") {
    return (
      <img
        src={renderUrl}
        alt={asset.originalFilename}
        loading="lazy"
        decoding="async"
        className={`${size} rounded border border-border object-cover`}
      />
    );
  }
  if (asset.kind === "video") {
    if (variant === "grid") {
      return (
        <video
          src={renderUrl}
          muted
          playsInline
          preload="metadata"
          className={`${size} pointer-events-none rounded border border-border bg-black`}
        />
      );
    }
    return (
      <video
        src={renderUrl}
        controls
        preload="metadata"
        className={`${size} rounded border border-border bg-black`}
      />
    );
  }
  return (
    <audio
      src={renderUrl}
      controls
      preload={variant === "grid" ? "none" : "metadata"}
      className={variant === "grid" ? "w-full" : "w-48"}
    />
  );
}

export function AssetsPage() {
  const assets = useAssets();
  const uploadAssets = useUploadAssets();
  const deleteAsset = useDeleteAsset();
  const updateAsset = useUpdateAsset();
  const cleanupAssets = useCleanupAssets();
  const [pending, setPending] = useState<File[]>([]);
  const [failures, setFailures] = useState<UploadAssetsResult["failed"]>([]);
  const [cleanupResult, setCleanupResult] = useState<CleanupAssetsResult | null>(null);
  const [view, setView] = useState<AssetView>("list");
  const browser = useAssetBrowser(assets.data);
  const {
    visible: visibleAssets,
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
  } = browser;

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

  const saveTags = (assetId: string, tags: string[]) => {
    updateAsset.mutate({ assetId, tags });
  };

  const isPending = (assetId: string) => updateAsset.pendingIds.includes(assetId);

  const renderActions = (asset: Asset, compact: boolean) => (
    <>
      <button
        type="button"
        className={buttonNeutralClass}
        disabled={isPending(asset.id) || deleteAsset.isPending}
        onClick={() => updateAsset.mutate({ assetId: asset.id, archived: asset.archivedAt === null })}
      >
        {archiveButtonLabel(asset.archivedAt !== null, compact)}
      </button>
      <button
        type="button"
        className={buttonDangerClass}
        disabled={isPending(asset.id) || deleteAsset.isPending || cleanupAssets.isPending}
        onClick={() => {
          if (window.confirm(`「${asset.originalFilename}」を削除しますか？`)) {
            deleteAsset.mutate(asset.id);
          }
        }}
      >
        削除
      </button>
    </>
  );

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">素材ライブラリ</h1>
        <button
          type="button"
          className={buttonNeutralClass}
          disabled={cleanupAssets.isPending || deleteAsset.isPending}
          onClick={() => {
            if (window.confirm("どの台本からも参照されていない素材を削除しますか？")) {
              setCleanupResult(null);
              cleanupAssets.mutate(undefined, { onSuccess: setCleanupResult });
            }
          }}
        >
          {cleanupAssets.isPending ? "清掃中…" : "未参照素材を清掃"}
        </button>
      </div>
      {cleanupResult !== null && (
        <p className={metaTextClass}>
          {cleanupResult.deleted}件を削除しました（参照中の{cleanupResult.retained}件は残しました）。
          {cleanupResult.failed > 0 ? ` ${cleanupResult.failed}件は失敗しました。` : ""}
        </p>
      )}
      {cleanupAssets.isError && (
        <p className={errorTextClass}>{errorMessage(cleanupAssets.error)}</p>
      )}

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
      {updateAsset.isError && <p className={errorTextClass}>{errorMessage(updateAsset.error)}</p>}

      {assets.isLoading && <p>読み込み中…</p>}
      {assets.isError && <p className={errorTextClass}>{errorMessage(assets.error)}</p>}

      <div className="my-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          placeholder="ファイル名で検索"
          aria-label="ファイル名で検索"
          className={`min-w-[200px] flex-1 ${textFieldClass}`}
          onChange={(event) => setQuery(event.target.value)}
        />
        <AssetFilterControls
          kind={kind}
          onKindChange={setKind}
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
        <div className="my-3">
          <TagFilter
            allTags={allTags}
            selected={selectedTags}
            onToggle={toggleTag}
            onClear={clearTags}
          />
        </div>
      )}

      {view === "grid" ? (
        <ul className="mt-3 grid list-none grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3 p-0">
          {visibleAssets.map((asset) => (
            <li key={asset.id} className="flex flex-col gap-1.5 rounded border border-border p-2">
              <div className="relative">
                <AssetPreview asset={asset} variant="grid" />
                <span className="absolute right-1 top-1 rounded bg-surface/80 px-1">
                  <AssetFavoriteButton
                    favorited={asset.favoritedAt !== null}
                    disabled={isPending(asset.id)}
                    onToggle={() =>
                      updateAsset.mutate({
                        assetId: asset.id,
                        favorited: asset.favoritedAt === null,
                      })
                    }
                  />
                </span>
              </div>
              <div className="flex items-center gap-1">
                <AssetTypeBadge kind={asset.kind} />
                {asset.archivedAt !== null && (
                  <span className="rounded border border-border px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
                    アーカイブ
                  </span>
                )}
                <span
                  className={`ml-auto text-xs ${
                    asset.status === "failed" ? errorTextClass : metaTextClass
                  }`}
                >
                  {STATUS_LABEL[asset.status]}
                </span>
              </div>
              <p className="truncate text-sm font-semibold" title={asset.originalFilename}>
                {asset.originalFilename}
              </p>
              <AssetTagChips tags={asset.tags} max={3} />
              <div className="mt-auto flex flex-wrap gap-1 pt-1">{renderActions(asset, true)}</div>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="list-none p-0">
          {visibleAssets.map((asset) => {
            const duration = formatDuration(asset.durationMs);
            const dimensions =
              asset.widthPx !== null && asset.heightPx !== null
                ? `${asset.widthPx}×${asset.heightPx}`
                : null;
            return (
              <li key={asset.id} className="flex items-center gap-3 border-b border-border py-2.5">
                <AssetPreview asset={asset} variant="list" />
                <div className="flex-1">
                  <p className="font-semibold">
                    {asset.favoritedAt !== null && (
                      <span className="mr-1 text-amber-500" aria-label="お気に入り">
                        ★
                      </span>
                    )}
                    {asset.originalFilename}
                  </p>
                  <p className={metaTextClass}>
                    {KIND_LABEL[asset.kind]} ・ {formatBytes(asset.byteSize)}
                    {dimensions !== null ? ` ・ ${dimensions}` : ""}
                    {duration !== null ? ` ・ ${duration}` : ""}
                    {asset.archivedAt !== null ? " ・ アーカイブ" : ""}
                  </p>
                  <AssetTagEditor
                    tags={asset.tags}
                    disabled={isPending(asset.id)}
                    onAdd={(tag) => saveTags(asset.id, [...asset.tags, tag])}
                    onRemove={(tag) =>
                      saveTags(asset.id, asset.tags.filter((value) => value !== tag))
                    }
                  />
                </div>
                <AssetFavoriteButton
                  favorited={asset.favoritedAt !== null}
                  disabled={isPending(asset.id)}
                  onToggle={() =>
                    updateAsset.mutate({
                      assetId: asset.id,
                      favorited: asset.favoritedAt === null,
                    })
                  }
                />
                <span
                  className={asset.status === "failed" ? errorTextClass : metaTextClass}
                >
                  {STATUS_LABEL[asset.status]}
                </span>
                {renderActions(asset, false)}
              </li>
            );
          })}
        </ul>
      )}
      {assets.data?.length === 0 && (
        <p>素材がありません。上のフォームからアップロードしてください。</p>
      )}
      {assets.data !== undefined &&
        assets.data.length > 0 &&
        visibleAssets.length === 0 && (
          <p>
            {isFiltering
              ? "絞り込みに一致する素材がありません。"
              : "表示できる素材がありません。「アーカイブ」を表示すると出る場合があります。"}
          </p>
        )}
    </section>
  );
}
