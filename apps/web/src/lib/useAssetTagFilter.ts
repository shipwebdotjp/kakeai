import { useCallback, useEffect, useMemo, useState } from "react";
import type { Asset } from "@kakeai/contracts";

export function useAssetTagFilter(assets: readonly Asset[] | undefined) {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const allTags = useMemo(
    () =>
      [...new Set((assets ?? []).flatMap((asset) => asset.tags))].sort((a, b) =>
        a.localeCompare(b, "ja"),
      ),
    [assets],
  );

  useEffect(() => {
    setSelectedTags((previous) => {
      const next = previous.filter((tag) => allTags.includes(tag));
      return next.length === previous.length ? previous : next;
    });
  }, [allTags]);

  const matches = useMemo(
    () =>
      (assets ?? []).filter(
        (asset) => selectedTags.length === 0 || asset.tags.some((tag) => selectedTags.includes(tag)),
      ),
    [assets, selectedTags],
  );

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((previous) =>
      previous.includes(tag) ? previous.filter((value) => value !== tag) : [...previous, tag],
    );
  }, []);

  const clearTags = useCallback(() => setSelectedTags([]), []);

  return { allTags, matches, selectedTags, toggleTag, clearTags };
}
