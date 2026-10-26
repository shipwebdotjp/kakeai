import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  voiceAdapterIdSchema,
  type CreateVoiceProfileRequest,
  type ModelList,
  type UpdateVoiceProfileRequest,
  type VoiceAdapterId,
  type VoiceAdapterList,
  type VoiceList,
  type VoiceProfile,
} from "@kakeai/contracts";
import type { AdapterVoicesState } from "../../lib/voiceAdapters";
import { apiRequest } from "../client";
import { queryKeys } from "./queryKeys";

export function useVoiceProfiles() {
  return useQuery({
    queryKey: ["voice-profiles"],
    queryFn: async () => (await apiRequest<VoiceProfile[]>("/voice-profiles")).data,
  });
}

export function useCreateVoiceProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateVoiceProfileRequest) =>
      (await apiRequest<VoiceProfile>("/voice-profiles", { method: "POST", body: input })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["voice-profiles"] }),
  });
}

export function useUpdateVoiceProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateVoiceProfileRequest }) =>
      (
        await apiRequest<VoiceProfile>(`/voice-profiles/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: input,
        })
      ).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["voice-profiles"] }),
  });
}

export function useDeleteVoiceProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest(`/voice-profiles/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["voice-profiles"] }),
  });
}

export function useVoiceAdapters() {
  return useQuery({
    queryKey: ["voice-adapters"],
    staleTime: 60_000,
    queryFn: async () => (await apiRequest<VoiceAdapterList>("/voice-adapters")).data,
  });
}

export function useAdapterVoices(adapterId: VoiceAdapterId | undefined, model?: string) {
  const normalizedModel = model === undefined || model.trim().length === 0 ? "" : model.trim();
  return useQuery({
    queryKey: queryKeys.adapterVoices(adapterId, normalizedModel),
    enabled: adapterId !== undefined,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const params = new URLSearchParams({ adapterId: adapterId ?? "" });
      if (normalizedModel.length > 0) {
        params.set("model", normalizedModel);
      }
      return (await apiRequest<VoiceList>(`/voice-profiles/voices?${params.toString()}`)).data;
    },
  });
}

export function useVoiceModels(adapterId: VoiceAdapterId | undefined) {
  return useQuery({
    queryKey: ["adapter-models", adapterId],
    enabled: adapterId !== undefined,
    retry: false,
    staleTime: 60_000,
    queryFn: async () =>
      (
        await apiRequest<ModelList>(
          `/voice-profiles/models?adapterId=${encodeURIComponent(adapterId ?? "")}`,
        )
      ).data,
  });
}

export function useAdapterVoicesMap(): Record<VoiceAdapterId, AdapterVoicesState> {
  const results = useQueries({
    queries: voiceAdapterIdSchema.options.map((adapterId) => ({
      queryKey: queryKeys.adapterVoices(adapterId, ""),
      retry: false,
      staleTime: 60_000,
      queryFn: async () =>
        (
          await apiRequest<VoiceList>(
            `/voice-profiles/voices?adapterId=${encodeURIComponent(adapterId)}`,
          )
        ).data,
    })),
  });
  const map = {} as Record<VoiceAdapterId, AdapterVoicesState>;
  voiceAdapterIdSchema.options.forEach((adapterId, index) => {
    const result = results[index];
    map[adapterId] = {
      voices: result?.data?.voices,
      loading: result?.isLoading ?? false,
      failed: result?.isError ?? false,
    };
  });
  return map;
}
