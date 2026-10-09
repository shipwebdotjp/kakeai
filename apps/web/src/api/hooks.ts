import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { warningsMetaSchema } from "@kakeai/contracts";
import type {
  Asset,
  ContentDocument,
  ScriptVersion,
  Warning,
  Work,
  WorkSummary,
} from "@kakeai/contracts";
import { apiRequest, apiUpload, type Envelope } from "./client";

export function useWorks() {
  return useQuery({
    queryKey: ["works"],
    queryFn: async () => (await apiRequest<WorkSummary[]>("/works")).data,
  });
}

export function useWork(workId: string | undefined) {
  return useQuery({
    queryKey: ["work", workId],
    enabled: workId !== undefined && workId.length > 0,
    queryFn: async () => (await apiRequest<Work>(`/works/${encodeURIComponent(workId ?? "")}`)).data,
  });
}

export function useCreateWork() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (title: string) =>
      (await apiRequest<Work>("/works", { method: "POST", body: { title, originalLocale: "ja-JP" } }))
        .data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["works"] }),
  });
}

export function useUpdateWork(workId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (title: string) => {
      if (workId === undefined || workId.length === 0) {
        throw new Error("workId がありません");
      }
      return (
        await apiRequest<Work>(`/works/${encodeURIComponent(workId)}`, {
          method: "PATCH",
          body: { title },
        })
      ).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["works"] });
      queryClient.invalidateQueries({ queryKey: ["work", workId] });
    },
  });
}

export function useDeleteWork() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (workId: string) => {
      await apiRequest(`/works/${encodeURIComponent(workId)}`, { method: "DELETE" });
    },
    onSuccess: (_data, workId) => {
      queryClient.invalidateQueries({ queryKey: ["works"] });
      queryClient.removeQueries({ queryKey: ["work", workId] });
    },
  });
}

export function useAssets() {
  return useQuery({
    queryKey: ["assets"],
    queryFn: async () => (await apiRequest<Asset[]>("/assets")).data,
    refetchInterval: (query) => {
      const data = query.state.data;
      return Array.isArray(data) && data.some((asset) => asset.status === "processing")
        ? 1500
        : false;
    },
  });
}

export function useUploadAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => (await apiUpload<Asset>("/assets", file)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assets"] }),
  });
}

export function useDeleteAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (assetId: string) => {
      await apiRequest(`/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assets"] }),
  });
}

export function useCurrentScriptVersion(editionId: string | undefined) {
  return useQuery({
    queryKey: ["current-script-version", editionId],
    enabled: editionId !== undefined && editionId.length > 0,
    queryFn: async () =>
      (
        await apiRequest<ScriptVersion>(
          `/language-editions/${encodeURIComponent(editionId ?? "")}/current-script-version`,
        )
      ).data,
  });
}

export interface SaveScriptVersionResult {
  scriptVersion: ScriptVersion;
  warnings: Warning[];
}

export function useSaveScriptVersion(editionId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (content: ContentDocument): Promise<SaveScriptVersionResult> => {
      if (editionId === undefined || editionId.length === 0) {
        throw new Error("editionId がありません");
      }
      const response: Envelope<ScriptVersion> = await apiRequest<ScriptVersion>(
        `/language-editions/${encodeURIComponent(editionId)}/script-versions`,
        { method: "POST", body: { sourceScriptVersionId: null, content } },
      );
      const parsedMeta = warningsMetaSchema.safeParse(response.meta);
      const warnings = parsedMeta.success ? parsedMeta.data.warnings : [];
      return { scriptVersion: response.data, warnings };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["works"] });
      queryClient.invalidateQueries({ queryKey: ["current-script-version", editionId] });
    },
  });
}
