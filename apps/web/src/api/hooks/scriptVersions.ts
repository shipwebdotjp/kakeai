import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  warningsMetaSchema,
  type ContentDocument,
  type ScriptVersion,
  type ScriptVersionPreview,
  type ScriptVersionSummary,
  type Warning,
} from "@kakeai/contracts";
import { apiRequest, type Envelope } from "../client";
import { queryKeys } from "./queryKeys";

function warningsFromMeta(meta: unknown): Warning[] {
  const parsedMeta = warningsMetaSchema.safeParse(meta);
  return parsedMeta.success ? parsedMeta.data.warnings : [];
}

export function useCurrentScriptVersion(editionId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.currentScriptVersion(editionId),
    enabled: editionId !== undefined && editionId.length > 0,
    queryFn: async () =>
      (
        await apiRequest<ScriptVersion>(
          `/language-editions/${encodeURIComponent(editionId ?? "")}/current-script-version`,
        )
      ).data,
  });
}

export function useScriptVersions(editionId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.scriptVersions(editionId),
    enabled: editionId !== undefined && editionId.length > 0,
    queryFn: async () =>
      (
        await apiRequest<ScriptVersionSummary[]>(
          `/language-editions/${encodeURIComponent(editionId ?? "")}/script-versions`,
        )
      ).data,
  });
}

export function useScriptVersion(scriptVersionId: string | undefined) {
  return useQuery({
    queryKey: ["script-version", scriptVersionId],
    enabled: scriptVersionId !== undefined && scriptVersionId.length > 0,
    queryFn: async () =>
      (
        await apiRequest<ScriptVersion>(
          `/script-versions/${encodeURIComponent(scriptVersionId ?? "")}`,
        )
      ).data,
  });
}

export interface SaveScriptVersionResult {
  scriptVersion: ScriptVersion;
  warnings: Warning[];
}

export function useRestoreScriptVersion(workId: string | undefined, editionId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sourceScriptVersionId: string): Promise<SaveScriptVersionResult> => {
      if (editionId === undefined || editionId.length === 0) {
        throw new Error("editionId がありません");
      }
      const sourceVersion = (
        await apiRequest<ScriptVersion>(
          `/script-versions/${encodeURIComponent(sourceScriptVersionId)}`,
        )
      ).data;

      const response: Envelope<ScriptVersion> = await apiRequest<ScriptVersion>(
        `/language-editions/${encodeURIComponent(editionId)}/script-versions`,
        { method: "POST", body: { sourceScriptVersionId, content: sourceVersion.content } },
      );
      const warnings = warningsFromMeta(response.meta);
      return { scriptVersion: response.data, warnings };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.works() });
      if (workId !== undefined && workId.length > 0) {
        queryClient.invalidateQueries({ queryKey: queryKeys.work(workId) });
      }
      if (editionId !== undefined && editionId.length > 0) {
        queryClient.invalidateQueries({ queryKey: queryKeys.currentScriptVersion(editionId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.scriptVersions(editionId) });
      }
    },
  });
}

export function useDeleteScriptVersions(
  workId: string | undefined,
  editionId: string | undefined,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (scriptVersionIds: string[]) => {
      if (editionId === undefined || editionId.length === 0) {
        throw new Error("editionId がありません");
      }
      await apiRequest(
        `/language-editions/${encodeURIComponent(editionId)}/script-versions/bulk-delete`,
        { method: "POST", body: { scriptVersionIds } },
      );
    },
    onSuccess: (_data, scriptVersionIds) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.works() });
      if (workId !== undefined && workId.length > 0) {
        queryClient.invalidateQueries({ queryKey: queryKeys.work(workId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.workJobs(workId) });
      }
      if (editionId !== undefined && editionId.length > 0) {
        queryClient.invalidateQueries({ queryKey: queryKeys.currentScriptVersion(editionId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.scriptVersions(editionId) });
      }
      for (const scriptVersionId of scriptVersionIds) {
        queryClient.removeQueries({ queryKey: ["script-version", scriptVersionId] });
        queryClient.removeQueries({ queryKey: ["script-version-preview", scriptVersionId] });
      }
    },
  });
}

export function useScriptVersionPreview(scriptVersionId: string | undefined) {
  return useQuery({
    queryKey: ["script-version-preview", scriptVersionId],
    enabled: scriptVersionId !== undefined && scriptVersionId.length > 0,
    staleTime: 30_000,
    placeholderData: (previousData) => previousData,
    queryFn: async () =>
      (
        await apiRequest<ScriptVersionPreview>(
          `/script-versions/${encodeURIComponent(scriptVersionId ?? "")}/preview`,
        )
      ).data,
  });
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
      const warnings = warningsFromMeta(response.meta);
      return { scriptVersion: response.data, warnings };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.works() });
      queryClient.invalidateQueries({ queryKey: queryKeys.currentScriptVersion(editionId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.scriptVersions(editionId) });
    },
  });
}
