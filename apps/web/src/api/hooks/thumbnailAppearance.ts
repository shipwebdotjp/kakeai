import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateThumbnailAppearancePresetRequest,
  ThumbnailAppearance,
  ThumbnailAppearancePreset,
  ThumbnailAppearancePresetSummary,
  ThumbnailAppearanceView,
  UpdateThumbnailAppearancePresetRequest,
} from "@kakeai/contracts";
import { apiRequest } from "../client";
import { queryKeys } from "./queryKeys";

export function useThumbnailAppearance(editionId: string | undefined) {
  return useQuery({
    queryKey: ["thumbnail-appearance", editionId],
    enabled: editionId !== undefined && editionId.length > 0,
    queryFn: async () =>
      (
        await apiRequest<ThumbnailAppearanceView>(
          `/language-editions/${encodeURIComponent(editionId ?? "")}/thumbnail-appearance`,
        )
      ).data,
  });
}

export function useSaveThumbnailAppearance(editionId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (appearance: ThumbnailAppearance | null) => {
      if (editionId === undefined || editionId.length === 0) {
        throw new Error("editionId がありません");
      }
      return (
        await apiRequest<ThumbnailAppearanceView>(
          `/language-editions/${encodeURIComponent(editionId)}/thumbnail-appearance`,
          { method: "PUT", body: { appearance } },
        )
      ).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["thumbnail-appearance", editionId] });
      queryClient.invalidateQueries({ queryKey: queryKeys.thumbnails(editionId) });
    },
  });
}

export function useThumbnailAppearancePresets() {
  return useQuery({
    queryKey: ["thumbnail-appearance-presets"],
    queryFn: async () =>
      (await apiRequest<ThumbnailAppearancePresetSummary[]>("/thumbnail-appearance-presets"))
        .data,
  });
}

export function useThumbnailAppearancePreset(presetId: string | undefined) {
  return useQuery({
    queryKey: ["thumbnail-appearance-preset", presetId],
    enabled: presetId !== undefined && presetId.length > 0,
    queryFn: async () =>
      (
        await apiRequest<ThumbnailAppearancePreset>(
          `/thumbnail-appearance-presets/${encodeURIComponent(presetId ?? "")}`,
        )
      ).data,
  });
}

export function useCreateThumbnailAppearancePreset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateThumbnailAppearancePresetRequest) =>
      (
        await apiRequest<ThumbnailAppearancePreset>("/thumbnail-appearance-presets", {
          method: "POST",
          body: input,
        })
      ).data,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["thumbnail-appearance-presets"] }),
  });
}

export function useUpdateThumbnailAppearancePreset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: UpdateThumbnailAppearancePresetRequest;
    }) =>
      (
        await apiRequest<ThumbnailAppearancePreset>(
          `/thumbnail-appearance-presets/${encodeURIComponent(id)}`,
          { method: "PUT", body: input },
        )
      ).data,
    onSuccess: (preset) => {
      queryClient.invalidateQueries({ queryKey: ["thumbnail-appearance-presets"] });
      queryClient.invalidateQueries({
        queryKey: ["thumbnail-appearance-preset", preset.id],
      });
    },
  });
}

export function useDeleteThumbnailAppearancePreset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest(`/thumbnail-appearance-presets/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["thumbnail-appearance-presets"] });
      queryClient.invalidateQueries({ queryKey: ["thumbnail-appearance-preset", id] });
    },
  });
}
