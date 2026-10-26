import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ASSET_LIST_MAX_LIMIT, type Asset, type AssetListPage } from "@kakeai/contracts";
import { ApiError, apiRequest, apiUpload } from "../client";
import { queryKeys } from "./queryKeys";

const ASSET_FETCH_PAGE_SIZE = ASSET_LIST_MAX_LIMIT;
const ASSET_FETCH_MAX_PAGES = 100;

/**
 * Reads the whole library through the paged contract while keeping the UI's
 * existing `Asset[]` shape. Archived assets are included so the library's
 * archive toggle and cleanup still see them.
 */
async function fetchAllAssets(signal?: AbortSignal): Promise<Asset[]> {
  const assets: Asset[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < ASSET_FETCH_MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      limit: String(ASSET_FETCH_PAGE_SIZE),
      archived: "include",
    });
    if (cursor !== null) {
      params.set("cursor", cursor);
    }
    const result = (
      await apiRequest<AssetListPage>(`/assets?${params.toString()}`, { signal })
    ).data;
    assets.push(...result.assets);
    if (result.nextCursor === null) {
      return assets;
    }
    if (seenCursors.has(result.nextCursor)) {
      throw new Error("素材一覧のページングが循環しています。");
    }
    seenCursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  // A very large library must not turn every asset view into an error screen.
  // Show what was loaded and leave the rest to a narrower query.
  console.warn(
    `素材一覧が ${ASSET_FETCH_MAX_PAGES} ページを超えたため、読み込み済みの素材だけを表示します。`,
  );
  return assets;
}

export function useAssets(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: queryKeys.assets(),
    enabled,
    queryFn: ({ signal }) => fetchAllAssets(signal),
    refetchInterval: (query) => {
      const data = query.state.data;
      return Array.isArray(data) && data.some((asset) => asset.status === "processing")
        ? 1500
        : false;
    },
  });
}

export interface UploadAssetsResult {
  uploaded: Asset[];
  failed: { file: File; error: unknown }[];
}

export function useUploadAssets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (files: File[]): Promise<UploadAssetsResult> => {
      const uploaded: Asset[] = [];
      const failed: { file: File; error: unknown }[] = [];
      for (const file of files) {
        try {
          uploaded.push((await apiUpload<Asset>("/assets", file)).data);
        } catch (error) {
          failed.push({ file, error });
        }
      }
      return { uploaded, failed };
    },
    onSuccess: (result) => {
      if (result.uploaded.length > 0) {
        queryClient.invalidateQueries({ queryKey: queryKeys.assets() });
      }
    },
  });
}

export function useDeleteAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (assetId: string) => {
      await apiRequest(`/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.assets() }),
  });
}

export type UpdateAssetPatch =
  | { tags: string[]; favorited?: boolean; archived?: boolean }
  | { tags?: string[]; favorited: boolean; archived?: boolean }
  | { tags?: string[]; favorited?: boolean; archived: boolean };

export type UpdateAssetInput = { assetId: string } & UpdateAssetPatch;

function applyAssetPatch(asset: Asset, patch: UpdateAssetPatch): Asset {
  const next = { ...asset };
  if (patch.tags !== undefined) {
    next.tags = [...patch.tags];
  }
  if (patch.favorited !== undefined) {
    next.favoritedAt = patch.favorited ? new Date().toISOString() : null;
  }
  if (patch.archived !== undefined) {
    next.archivedAt = patch.archived ? new Date().toISOString() : null;
  }
  return next;
}

export function useUpdateAsset() {
  const queryClient = useQueryClient();
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const mutation = useMutation({
    mutationFn: async ({ assetId, ...patch }: UpdateAssetInput) =>
      (
        await apiRequest<Asset>(`/assets/${encodeURIComponent(assetId)}`, {
          method: "PATCH",
          body: patch,
        })
      ).data,
    onMutate: async ({ assetId, ...patch }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.assets() });
      setPendingIds((previous) => [...previous, assetId]);
      const previous = queryClient.getQueryData<Asset[]>(queryKeys.assets());
      queryClient.setQueryData<Asset[]>(queryKeys.assets(), (current) =>
        current?.map((asset) => (asset.id === assetId ? applyAssetPatch(asset, patch) : asset)),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(queryKeys.assets(), context.previous);
      }
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<Asset[]>(queryKeys.assets(), (current) =>
        current?.map((asset) => (asset.id === updated.id ? updated : asset)),
      );
    },
    onSettled: (_data, _error, variables) => {
      setPendingIds((previous) => previous.filter((id) => id !== variables.assetId));
      queryClient.invalidateQueries({ queryKey: queryKeys.assets() });
    },
  });
  return { ...mutation, pendingIds };
}

export interface CleanupAssetsResult {
  deleted: number;
  retained: number;
  failed: number;
}

const CLEANUP_CONCURRENCY = 5;

export function useCleanupAssets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<CleanupAssetsResult> => {
      const assets = (await fetchAllAssets()).filter(
        (asset) => asset.status !== "processing",
      );
      let deleted = 0;
      let retained = 0;
      let failed = 0;
      for (let index = 0; index < assets.length; index += CLEANUP_CONCURRENCY) {
        const chunk = assets.slice(index, index + CLEANUP_CONCURRENCY);
        const results = await Promise.allSettled(
          chunk.map((asset) =>
            apiRequest(`/assets/${encodeURIComponent(asset.id)}`, { method: "DELETE" }),
          ),
        );
        for (const result of results) {
          if (result.status === "fulfilled") {
            deleted += 1;
          } else if (result.reason instanceof ApiError && result.reason.code === "ASSET_IN_USE") {
            retained += 1;
          } else if (
            result.reason instanceof ApiError &&
            result.reason.code === "RESOURCE_NOT_FOUND"
          ) {
            deleted += 1;
          } else {
            failed += 1;
          }
        }
      }
      return { deleted, retained, failed };
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.assets() }),
  });
}
