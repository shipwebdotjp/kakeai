import { useCallback, useEffect, useMemo, useState } from "react";
import type { Asset, AssetKindName } from "@kakeai/contracts";

export type AssetSort = "recent" | "name" | "favorite";

export const ASSET_SORT_LABEL: Record<AssetSort, string> = {
  recent: "追加が新しい順",
  name: "名前順",
  favorite: "お気に入り優先",
};

export interface AssetBrowserOptions {
  kinds?: readonly AssetKindName[];
  readyOnly?: boolean;
}

function compareAssets(left: Asset, right: Asset, sort: AssetSort): number {
  if (sort === "name") {
    return left.originalFilename.localeCompare(right.originalFilename, "ja");
  }
  if (sort === "favorite") {
    const leftFavorite = left.favoritedAt ?? "";
    const rightFavorite = right.favoritedAt ?? "";
    if (leftFavorite !== rightFavorite) {
      return leftFavorite < rightFavorite ? 1 : -1;
    }
  }
  return right.createdAt.localeCompare(left.createdAt);
}

export function useAssetBrowser(
  assets: readonly Asset[] | undefined,
  options: AssetBrowserOptions = {},
) {
  const { kinds, readyOnly = false } = options;
  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [kind, setKind] = useState<AssetKindName | "all">("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [sort, setSort] = useState<AssetSort>("recent");

  const kindsKey = kinds === undefined ? "" : [...kinds].sort().join(",");

  const scoped = useMemo(() => {
    let list = assets ?? [];
    if (readyOnly) {
      list = list.filter((asset) => asset.status === "ready");
    }
    if (kindsKey.length > 0) {
      const allowed = new Set(kindsKey.split(","));
      list = list.filter((asset) => allowed.has(asset.kind));
    }
    return list;
  }, [assets, kindsKey, readyOnly]);

  const allTags = useMemo(
    () =>
      [...new Set(scoped.flatMap((asset) => asset.tags))].sort((a, b) => a.localeCompare(b, "ja")),
    [scoped],
  );

  useEffect(() => {
    setSelectedTags((previous) => {
      const next = previous.filter((tag) => allTags.includes(tag));
      return next.length === previous.length ? previous : next;
    });
  }, [allTags]);

  useEffect(() => {
    if (kindsKey.length === 0) {
      return;
    }
    const allowed = new Set(kindsKey.split(","));
    setKind((current) => (current !== "all" && !allowed.has(current) ? "all" : current));
  }, [kindsKey]);

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const filtered = scoped.filter((asset) => {
      if (!showArchived && asset.archivedAt !== null) {
        return false;
      }
      if (kind !== "all" && asset.kind !== kind) {
        return false;
      }
      if (favoritesOnly && asset.favoritedAt === null) {
        return false;
      }
      if (keyword.length > 0 && !asset.originalFilename.toLowerCase().includes(keyword)) {
        return false;
      }
      if (selectedTags.length > 0 && !asset.tags.some((tag) => selectedTags.includes(tag))) {
        return false;
      }
      return true;
    });
    return [...filtered].sort((left, right) => compareAssets(left, right, sort));
  }, [scoped, showArchived, kind, favoritesOnly, query, selectedTags, sort]);

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((previous) =>
      previous.includes(tag) ? previous.filter((value) => value !== tag) : [...previous, tag],
    );
  }, []);

  const clearTags = useCallback(() => setSelectedTags([]), []);

  const reset = useCallback(() => {
    setQuery("");
    setSelectedTags([]);
    setKind("all");
    setFavoritesOnly(false);
    setShowArchived(false);
    setSort("recent");
  }, []);

  const isFiltering =
    query.trim().length > 0 ||
    selectedTags.length > 0 ||
    kind !== "all" ||
    favoritesOnly;

  return {
    visible,
    scopedCount: scoped.length,
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
  };
}
