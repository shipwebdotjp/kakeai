import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateThumbnailRequest,
  SaveThumbnailRequest,
  Thumbnail,
  ThumbnailPreview,
  ThumbnailPreviewRequest,
} from "@kakeai/contracts";
import { apiRequest } from "../client";
import { queryKeys } from "./queryKeys";

export function useThumbnails(editionId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.thumbnails(editionId),
    enabled: editionId !== undefined && editionId.length > 0,
    queryFn: async () =>
      (
        await apiRequest<Thumbnail[]>(
          `/language-editions/${encodeURIComponent(editionId ?? "")}/thumbnails`,
        )
      ).data,
  });
}

export function useCreateThumbnail(editionId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateThumbnailRequest) => {
      if (editionId === undefined || editionId.length === 0) {
        throw new Error("editionId がありません");
      }
      return (
        await apiRequest<Thumbnail>(
          `/language-editions/${encodeURIComponent(editionId)}/thumbnails`,
          { method: "POST", body: input },
        )
      ).data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.thumbnails(editionId) }),
  });
}

export function useSaveThumbnail(editionId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: SaveThumbnailRequest }) => {
      if (editionId === undefined || editionId.length === 0) {
        throw new Error("editionId がありません");
      }
      return (
        await apiRequest<Thumbnail>(`/thumbnails/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: input,
        })
      ).data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.thumbnails(editionId) }),
  });
}

export function useDeleteThumbnail(editionId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (editionId === undefined || editionId.length === 0) {
        throw new Error("editionId がありません");
      }
      await apiRequest(`/thumbnails/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.thumbnails(editionId) }),
  });
}

export function useSetPrimaryThumbnail(editionId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (thumbnailId: string | null) => {
      if (editionId === undefined || editionId.length === 0) {
        throw new Error("editionId がありません");
      }
      return (
        await apiRequest<Thumbnail | null>(
          `/language-editions/${encodeURIComponent(editionId)}/primary-thumbnail`,
          { method: "PUT", body: { thumbnailId } },
        )
      ).data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.thumbnails(editionId) }),
  });
}

export function useThumbnailPreview(editionId: string | undefined) {
  return useMutation({
    mutationFn: async (input: ThumbnailPreviewRequest): Promise<ThumbnailPreview> => {
      if (editionId === undefined || editionId.length === 0) {
        throw new Error("editionId がありません");
      }
      return (
        await apiRequest<ThumbnailPreview>(
          `/language-editions/${encodeURIComponent(editionId)}/thumbnail-preview`,
          { method: "POST", body: input },
        )
      ).data;
    },
  });
}
