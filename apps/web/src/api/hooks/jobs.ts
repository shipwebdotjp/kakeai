import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Job } from "@kakeai/contracts";
import { apiRequest } from "../client";
import { queryKeys } from "./queryKeys";

export function useCreateRenderJob(scriptVersionId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<Job> => {
      if (scriptVersionId === undefined || scriptVersionId.length === 0) {
        throw new Error("scriptVersionId がありません");
      }
      return (
        await apiRequest<Job>(`/script-versions/${encodeURIComponent(scriptVersionId)}/render-jobs`, {
          method: "POST",
          body: {},
        })
      ).data;
    },
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.works() });
      if (job.workId !== null) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workJobs(job.workId) });
      }
    },
  });
}

export function useWorkJobs(workId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.workJobs(workId),
    enabled: workId !== undefined && workId.length > 0,
    queryFn: async () =>
      (await apiRequest<Job[]>(`/works/${encodeURIComponent(workId ?? "")}/jobs`)).data,
    refetchInterval: (query) => {
      const data = query.state.data;
      return Array.isArray(data) &&
        data.some((job) => job.status === "queued" || job.status === "running")
        ? 2000
        : false;
    },
  });
}

export function useCancelJob(workId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) =>
      (await apiRequest<Job>(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" }))
        .data,
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.works() });
      const targetWorkId = job.workId ?? workId;
      if (targetWorkId !== undefined && targetWorkId !== null) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workJobs(targetWorkId) });
      }
    },
  });
}

export function useDeleteArtifact(workId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (artifactId: string) => {
      if (workId === undefined || workId.length === 0) {
        throw new Error("workId がありません");
      }
      await apiRequest(`/artifacts/${encodeURIComponent(artifactId)}`, { method: "DELETE" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.workJobs(workId) }),
  });
}
