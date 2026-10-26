import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateThemeRequest,
  DraftPreview,
  ThemeDetail,
  ThemeSummary,
  VisualThemeDefinition,
} from "@kakeai/contracts";
import { apiRequest } from "../client";

export function useThemes(includeArchived = false) {
  return useQuery({
    queryKey: ["themes", { includeArchived }],
    queryFn: async () =>
      (
        await apiRequest<ThemeSummary[]>(
          `/themes${includeArchived ? "?includeArchived=true" : ""}`,
        )
      ).data,
  });
}

export function useTheme(themeId: string | undefined) {
  return useQuery({
    queryKey: ["theme", themeId],
    enabled: themeId !== undefined && themeId.length > 0,
    queryFn: async () =>
      (await apiRequest<ThemeDetail>(`/themes/${encodeURIComponent(themeId ?? "")}`)).data,
  });
}

export function useCreateTheme() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateThemeRequest) =>
      (await apiRequest<ThemeDetail>("/themes", { method: "POST", body: input })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["themes"] }),
  });
}

export function useUpdateThemeDraft(themeId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (definition: VisualThemeDefinition) => {
      if (themeId === undefined || themeId.length === 0) {
        throw new Error("themeId がありません");
      }
      return (
        await apiRequest<ThemeDetail>(`/themes/${encodeURIComponent(themeId)}/draft`, {
          method: "PUT",
          body: { definition },
        })
      ).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["themes"] });
      queryClient.invalidateQueries({ queryKey: ["theme", themeId] });
    },
  });
}

export function useDiscardThemeDraft(themeId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (themeId === undefined || themeId.length === 0) {
        throw new Error("themeId がありません");
      }
      return (
        await apiRequest<ThemeDetail>(`/themes/${encodeURIComponent(themeId)}/draft`, {
          method: "DELETE",
        })
      ).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["themes"] });
      queryClient.invalidateQueries({ queryKey: ["theme", themeId] });
    },
  });
}

export function usePublishThemeDraft(themeId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (themeId === undefined || themeId.length === 0) {
        throw new Error("themeId がありません");
      }
      return (
        await apiRequest<ThemeDetail>(`/themes/${encodeURIComponent(themeId)}/publish`, {
          method: "POST",
          body: {},
        })
      ).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["themes"] });
      queryClient.invalidateQueries({ queryKey: ["theme", themeId] });
    },
  });
}

export function useArchiveTheme() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (themeId: string) =>
      (
        await apiRequest<ThemeDetail>(`/themes/${encodeURIComponent(themeId)}/archive`, {
          method: "POST",
        })
      ).data,
    onSuccess: (_data, themeId) => {
      queryClient.invalidateQueries({ queryKey: ["themes"] });
      queryClient.invalidateQueries({ queryKey: ["theme", themeId] });
    },
  });
}

export function usePreviewThemeDraft() {
  return useMutation({
    mutationFn: async (definition: VisualThemeDefinition) =>
      (
        await apiRequest<DraftPreview>("/themes/preview", {
          method: "POST",
          body: { definition },
        })
      ).data,
  });
}
