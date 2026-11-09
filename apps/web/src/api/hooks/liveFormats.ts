import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateLiveFormatRequest,
  DuplicateLiveFormatRequest,
  LiveFormatDetail,
  LiveFormatList,
  UpdateLiveFormatRequest,
} from "@kakeai/contracts";
import { apiRequest } from "../client";
import { queryKeys } from "./queryKeys";

const LIVE_FORMAT_LIST_LIMIT = 500;

export function useLiveFormats() {
  return useQuery({
    queryKey: queryKeys.liveFormats(),
    queryFn: async () =>
      (
        await apiRequest<LiveFormatList>(
          `/live-formats?limit=${LIVE_FORMAT_LIST_LIMIT}`,
        )
      ).data,
  });
}

export function useLiveFormat(formatId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.liveFormat(formatId),
    enabled: formatId !== undefined && formatId.length > 0,
    queryFn: async () =>
      (
        await apiRequest<LiveFormatDetail>(
          `/live-formats/${encodeURIComponent(formatId ?? "")}`,
        )
      ).data,
  });
}

export function useCreateLiveFormat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateLiveFormatRequest) =>
      (await apiRequest<LiveFormatDetail>("/live-formats", {
        method: "POST",
        body: input,
      })).data,
    onSuccess: (format) => {
      queryClient.setQueryData(queryKeys.liveFormat(format.id), format);
      queryClient.invalidateQueries({ queryKey: queryKeys.liveFormats() });
    },
  });
}

export function useUpdateLiveFormat(formatId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateLiveFormatRequest) => {
      if (formatId === undefined || formatId.length === 0) {
        throw new Error("formatId がありません");
      }
      return (
        await apiRequest<LiveFormatDetail>(
          `/live-formats/${encodeURIComponent(formatId)}`,
          { method: "PATCH", body: input },
        )
      ).data;
    },
    onSuccess: (format) => {
      queryClient.setQueryData(queryKeys.liveFormat(format.id), format);
      queryClient.invalidateQueries({ queryKey: queryKeys.liveFormats() });
    },
  });
}

export function useDuplicateLiveFormat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      formatId,
      name,
    }: {
      formatId: string;
      name?: string;
    }) => {
      if (formatId.length === 0) {
        throw new Error("formatId がありません");
      }
      const body: DuplicateLiveFormatRequest = name === undefined ? {} : { name };
      return (
        await apiRequest<LiveFormatDetail>(
          `/live-formats/${encodeURIComponent(formatId)}/duplicate`,
          { method: "POST", body },
        )
      ).data;
    },
    onSuccess: (format) => {
      queryClient.setQueryData(queryKeys.liveFormat(format.id), format);
      queryClient.invalidateQueries({ queryKey: queryKeys.liveFormats() });
    },
  });
}
