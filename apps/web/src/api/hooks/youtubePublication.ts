import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateYouTubeSettingsTemplateRequest,
  UpdateYouTubeSettingsTemplateRequest,
  UpdateYouTubeVideoSettingsRequest,
  YouTubeChaptersResult,
  YouTubeSettingsTemplate,
  YouTubeSettingsTemplateSummary,
  YouTubeVideoSettingsView,
} from "@kakeai/contracts";
import { apiRequest } from "../client";
import { queryKeys } from "./queryKeys";

export function useYouTubeVideoSettings(editionId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.youtubeVideoSettings(editionId),
    queryFn: async () => {
      if (editionId === undefined || editionId === "") {
        return null;
      }
      return (
        await apiRequest<YouTubeVideoSettingsView>(
          `/language-editions/${encodeURIComponent(editionId)}/youtube-settings`,
        )
      ).data;
    },
    enabled: editionId !== undefined && editionId !== "",
  });
}

export function useSaveYouTubeVideoSettings(editionId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings: UpdateYouTubeVideoSettingsRequest) => {
      if (editionId === undefined || editionId === "") {
        throw new Error("言語版IDが指定されていません。");
      }
      return (
        await apiRequest<YouTubeVideoSettingsView>(
          `/language-editions/${encodeURIComponent(editionId)}/youtube-settings`,
          {
            method: "PUT",
            body: settings,
          },
        )
      ).data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.youtubeVideoSettings(editionId), data);
    },
  });
}

export function useYouTubeChapters(scriptVersionId: string | undefined) {
  return useQuery({
    queryKey: ["youtube-chapters", scriptVersionId],
    queryFn: async () => {
      if (scriptVersionId === undefined || scriptVersionId === "") {
        return null;
      }
      return (
        await apiRequest<YouTubeChaptersResult>(
          `/script-versions/${encodeURIComponent(scriptVersionId)}/youtube-chapters`,
        )
      ).data;
    },
    enabled: scriptVersionId !== undefined && scriptVersionId !== "",
  });
}

export function useYouTubeSettingsTemplates() {
  return useQuery({
    queryKey: queryKeys.youtubeSettingsTemplates(),
    queryFn: async () =>
      (await apiRequest<YouTubeSettingsTemplateSummary[]>("/youtube-settings-templates")).data,
  });
}

export function useYouTubeSettingsTemplate(templateId: string | undefined) {
  return useQuery({
    queryKey: ["youtube-settings-template", templateId],
    queryFn: async () => {
      if (templateId === undefined || templateId === "") {
        return null;
      }
      return (
        await apiRequest<YouTubeSettingsTemplate>(
          `/youtube-settings-templates/${encodeURIComponent(templateId)}`,
        )
      ).data;
    },
    enabled: templateId !== undefined && templateId !== "",
  });
}

export function useCreateYouTubeSettingsTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateYouTubeSettingsTemplateRequest) =>
      (
        await apiRequest<YouTubeSettingsTemplate>("/youtube-settings-templates", {
          method: "POST",
          body: input,
        })
      ).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.youtubeSettingsTemplates(),
      });
    },
  });
}

export function useUpdateYouTubeSettingsTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      templateId,
      input,
    }: {
      templateId: string;
      input: UpdateYouTubeSettingsTemplateRequest;
    }) =>
      (
        await apiRequest<YouTubeSettingsTemplate>(
          `/youtube-settings-templates/${encodeURIComponent(templateId)}`,
          {
            method: "PUT",
            body: input,
          },
        )
      ).data,
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.youtubeSettingsTemplates(),
      });
      void queryClient.invalidateQueries({
        queryKey: ["youtube-settings-template", variables.templateId],
      });
    },
  });
}

export function useDeleteYouTubeSettingsTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (templateId: string) => {
      await apiRequest<void>(
        `/youtube-settings-templates/${encodeURIComponent(templateId)}`,
        {
          method: "DELETE",
        },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.youtubeSettingsTemplates(),
      });
    },
  });
}
