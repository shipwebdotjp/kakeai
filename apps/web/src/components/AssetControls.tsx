import type { ReactNode } from "react";
import type { AssetKindName } from "@kakeai/contracts";
import { KIND_LABEL } from "../lib/assets";
import { ASSET_SORT_LABEL, type AssetSort } from "../lib/useAssetBrowser";
import { textFieldClass } from "../ui";

export type AssetView = "grid" | "list";

const selectClass = `${textFieldClass} pr-6`;

const ALL_KINDS = Object.keys(KIND_LABEL) as AssetKindName[];

export function AssetKindSelect({
  value,
  allowedKinds = ALL_KINDS,
  onChange,
}: {
  value: AssetKindName | "all";
  allowedKinds?: readonly AssetKindName[];
  onChange: (value: AssetKindName | "all") => void;
}) {
  return (
    <select
      className={selectClass}
      value={value}
      aria-label="種類で絞り込み"
      onChange={(event) => onChange(event.target.value as AssetKindName | "all")}
    >
      <option value="all">すべての種類</option>
      {allowedKinds.map((kind) => (
        <option key={kind} value={kind}>
          {KIND_LABEL[kind]}
        </option>
      ))}
    </select>
  );
}

export function AssetSortSelect({
  value,
  onChange,
}: {
  value: AssetSort;
  onChange: (value: AssetSort) => void;
}) {
  return (
    <select
      className={selectClass}
      value={value}
      aria-label="並び替え"
      onChange={(event) => onChange(event.target.value as AssetSort)}
    >
      {(Object.keys(ASSET_SORT_LABEL) as AssetSort[]).map((option) => (
        <option key={option} value={option}>
          {ASSET_SORT_LABEL[option]}
        </option>
      ))}
    </select>
  );
}

export function AssetViewToggle({
  view,
  onChange,
}: {
  view: AssetView;
  onChange: (view: AssetView) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded border border-border" role="group" aria-label="表示形式">
      {(["grid", "list"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={view === option}
          onClick={() => onChange(option)}
          className={`px-2 py-1 text-xs ${
            view === option
              ? "bg-brand-500 text-white"
              : "bg-surface hover:bg-surface-muted"
          }`}
        >
          {option === "grid" ? "カード" : "リスト"}
        </button>
      ))}
    </div>
  );
}

export function AssetToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-2 py-0.5 text-xs ${
        active
          ? "border-brand-500 bg-brand-500 text-white"
          : "border-border bg-surface hover:bg-surface-muted"
      }`}
    >
      {children}
    </button>
  );
}

export function AssetFilterControls({
  kind,
  kindOptions,
  onKindChange,
  sort,
  onSortChange,
  favoritesOnly,
  onToggleFavorites,
  showArchived,
  onToggleArchived,
  view,
  onViewChange,
}: {
  kind?: AssetKindName | "all";
  kindOptions?: readonly AssetKindName[];
  onKindChange?: (value: AssetKindName | "all") => void;
  sort: AssetSort;
  onSortChange: (value: AssetSort) => void;
  favoritesOnly: boolean;
  onToggleFavorites: () => void;
  showArchived: boolean;
  onToggleArchived: () => void;
  view?: AssetView;
  onViewChange?: (view: AssetView) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {kind !== undefined && onKindChange !== undefined && (
        <AssetKindSelect value={kind} allowedKinds={kindOptions} onChange={onKindChange} />
      )}
      <AssetSortSelect value={sort} onChange={onSortChange} />
      <AssetToggleButton active={favoritesOnly} onClick={onToggleFavorites}>
        ★ お気に入り
      </AssetToggleButton>
      <AssetToggleButton active={showArchived} onClick={onToggleArchived}>
        アーカイブ
      </AssetToggleButton>
      {view !== undefined && onViewChange !== undefined && (
        <AssetViewToggle view={view} onChange={onViewChange} />
      )}
    </div>
  );
}
