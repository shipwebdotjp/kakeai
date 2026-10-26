import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Work, WorkSummary } from "@kakeai/contracts";
import { apiRequest } from "../client";
import { queryKeys } from "./queryKeys";

export function useWorks() {
  return useQuery({
    queryKey: queryKeys.works(),
    queryFn: async () => (await apiRequest<WorkSummary[]>("/works")).data,
  });
}

export function useWork(workId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.work(workId),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.works() }),
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
      queryClient.invalidateQueries({ queryKey: queryKeys.works() });
      queryClient.invalidateQueries({ queryKey: queryKeys.work(workId) });
    },
  });
}

export function useCloneWork() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ workId, title }: { workId: string; title: string }) =>
      (
        await apiRequest<Work>(`/works/${encodeURIComponent(workId)}/clone`, {
          method: "POST",
          body: { title },
        })
      ).data,
    onSuccess: (newWork) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.works() });
      queryClient.setQueryData(queryKeys.work(newWork.id), newWork);
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
      queryClient.invalidateQueries({ queryKey: queryKeys.works() });
      queryClient.removeQueries({ queryKey: queryKeys.work(workId) });
    },
  });
}

export function useCreateLanguageEdition(workId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { locale: string; sourceEditionId: string }): Promise<Work> => {
      if (workId === undefined || workId.length === 0) {
        throw new Error("workId がありません");
      }
      return (
        await apiRequest<Work>(`/works/${encodeURIComponent(workId)}/language-editions`, {
          method: "POST",
          body: input,
        })
      ).data;
    },
    onSuccess: (work) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.works() });
      queryClient.setQueryData(queryKeys.work(work.id), work);
    },
  });
}
