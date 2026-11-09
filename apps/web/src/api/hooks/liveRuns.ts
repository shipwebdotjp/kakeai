import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateLiveRunRequest,
  Job,
  LiveExportProgramRequest,
  LiveRun,
  LiveRunList,
} from "@kakeai/contracts";
import { apiRequest } from "../client";
import { queryKeys } from "./queryKeys";

const LIVE_RUN_LIST_LIMIT = 500;

function runPath(runId: string, suffix = ""): string {
  if (runId.length === 0) {
    throw new Error("Run ID がありません。");
  }
  return `/live-runs/${encodeURIComponent(runId)}${suffix}`;
}

export function useLiveRuns() {
  return useQuery({
    queryKey: queryKeys.liveRuns(),
    queryFn: async () =>
      (
        await apiRequest<LiveRunList>(
          `/live-runs?limit=${LIVE_RUN_LIST_LIMIT}`,
        )
      ).data,
    refetchInterval: (query) => {
      const data = query.state.data;
      return Array.isArray(data?.items) &&
        data.items.some(
          (run) =>
            run.status === "preparing" ||
            run.status === "launching" ||
            run.status === "running",
        )
        ? 3000
        : false;
    },
  });
}

export function useLiveRun(runId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.liveRun(runId),
    enabled: runId !== undefined && runId.length > 0,
    queryFn: async () =>
      (await apiRequest<LiveRun>(runPath(runId ?? ""))).data,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "preparing" ||
        status === "launching" ||
        status === "running"
        ? 3000
        : false;
    },
  });
}

function invalidateRun(
  queryClient: ReturnType<typeof useQueryClient>,
  run: LiveRun,
): void {
  queryClient.setQueryData(queryKeys.liveRun(run.id), run);
  queryClient.invalidateQueries({ queryKey: queryKeys.liveRuns() });
}

export function useCreateLiveRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateLiveRunRequest) =>
      (
        await apiRequest<LiveRun>("/live-runs", {
          method: "POST",
          body: input,
        })
      ).data,
    onSuccess: (run) => invalidateRun(queryClient, run),
  });
}

export function useLaunchLiveRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) =>
      (
        await apiRequest<LiveRun>(runPath(runId, "/launch"), {
          method: "POST",
        })
      ).data,
    onSuccess: (run) => invalidateRun(queryClient, run),
  });
}

export function useStopLiveRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) =>
      (
        await apiRequest<LiveRun>(runPath(runId, "/stop"), {
          method: "POST",
        })
      ).data,
    onSuccess: (run) => invalidateRun(queryClient, run),
  });
}

export function useCreateLiveExportJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: LiveExportProgramRequest) =>
      (
        await apiRequest<Job>("/live-exports", {
          method: "POST",
          body: input,
        })
      ).data,
    onSuccess: (job) => {
      queryClient.setQueryData(queryKeys.job(job.id), job);
    },
  });
}
