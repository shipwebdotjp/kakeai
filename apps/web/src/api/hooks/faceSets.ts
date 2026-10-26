import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateFaceSetRequest,
  FaceSet,
  UpdateFaceSetRequest,
} from "@kakeai/contracts";
import { apiRequest } from "../client";

export function useFaceSets() {
  return useQuery({
    queryKey: ["face-sets"],
    queryFn: async () => (await apiRequest<FaceSet[]>("/face-sets")).data,
  });
}

export function useCreateFaceSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateFaceSetRequest) =>
      (await apiRequest<FaceSet>("/face-sets", { method: "POST", body: input })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["face-sets"] }),
  });
}

export function useUpdateFaceSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateFaceSetRequest }) =>
      (
        await apiRequest<FaceSet>(`/face-sets/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: input,
        })
      ).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["face-sets"] }),
  });
}

export function useDeleteFaceSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest(`/face-sets/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["face-sets"] }),
  });
}
