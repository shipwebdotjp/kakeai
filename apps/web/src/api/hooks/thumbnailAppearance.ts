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

export function useThumbnailAppearance(
  workId: string | undefined,
  editionId: string | undefined,
) {
  return useQuery({
    queryKey: ["thumbnail-appearance", workId, editionId],
    enabled:
      workId !== undefined &&
      workId.length > 0 &&
      editionId !== undefined &&
      editionId.length > 0,
    queryFn: async () =>
      (
        await apiRequest<ThumbnailAppearanceView>(
          `/works/${encodeURIComponent(workId ?? "")}/thumbnail-appearance?languageEditionId=${encodeURIComponent(editionId ?? "")}`,
        )
      ).data,
  });
}

export function useSaveThumbnailAppearance(
  workId: string | undefined,
  editionId: string | undefined,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (appearance: ThumbnailAppearance | null) => {
      if (
        workId === undefined ||
        workId.length === 0 ||
        editionId === undefined ||
        editionId.length === 0
      ) {
        throw new Error("workId / editionId がありません");
      }
      return (
        await apiRequest<ThumbnailAppearanceView>(
          `/works/${encodeURIComponent(workId)}/thumbnail-appearance?languageEditionId=${encodeURIComponent(editionId)}`,
          { method: "PUT", body: { appearance } },
        )
      ).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["thumbnail-appearance"] });
      // The Work appearance is live, so every Edition's candidates change.
      queryClient.invalidateQueries({ queryKey: ["thumbnails"] });
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
