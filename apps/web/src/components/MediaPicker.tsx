import { useState } from "react";
import type { AssetKindName } from "@kakeai/contracts";
import { useAssets } from "../api/hooks";
import { AssetThumbnail, assetLabel } from "../lib/assets";
import { buttonNeutralClass, metaTextClass } from "../ui";
import { MediaLibraryModal } from "./MediaLibraryModal";

interface MediaPickerProps {
  label: string;
  kinds: readonly AssetKindName[];
  selectedAssetId: string | null;
  onSelect: (assetId: string | null) => void;
  variant?: "select" | "add";
}

export function MediaPicker({
  label,
  kinds,
  selectedAssetId,
  onSelect,
  variant = "select",
}: MediaPickerProps) {
  const assets = useAssets();
  const [open, setOpen] = useState(false);
  const hasSelection = selectedAssetId !== null;
  const selected = hasSelection
    ? (assets.data ?? []).find((asset) => asset.id === selectedAssetId)
    : undefined;

  return (
    <div className="my-2">
      {variant === "add" ? (
        <button type="button" className={buttonNeutralClass} onClick={() => setOpen(true)}>
          {label}
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          <button type="button" className={buttonNeutralClass} onClick={() => setOpen(true)}>
            {hasSelection ? "変更" : "選択"}
          </button>
          {!hasSelection ? (
            <span className={metaTextClass}>未指定</span>
          ) : (
            <>
              {assets.isLoading ? (
                <span className={metaTextClass}>読み込み中…</span>
              ) : selected === undefined ? (
                <span className={metaTextClass}>選択中の素材を確認できません</span>
              ) : (
                <>
                  <AssetThumbnail asset={selected} />
                  <span className="truncate text-xs">{assetLabel(selected)}</span>
                </>
              )}
              <button type="button" className={buttonNeutralClass} onClick={() => onSelect(null)}>
                解除
              </button>
            </>
          )}
        </div>
      )}
      <MediaLibraryModal
        open={open}
        onClose={() => setOpen(false)}
        kinds={kinds}
        selectedAssetId={selectedAssetId}
        onSelect={onSelect}
      />
    </div>
  );
}
