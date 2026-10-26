import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateFaceSetRequest,
  FaceSet,
  FaceSetRevision,
  FaceSetUsages,
  UpdateFaceSetRequest,
} from "@kakeai/contracts";
import { apiRequest } from "../client";

export function useFaceSets() {
  return useQuery({
    queryKey: ["face-sets"],
    queryFn: async () => (await apiRequest<FaceSet[]>("/face-sets")).data,
  });
}

export function useFaceSetUsages(faceSetId: string | undefined) {
  return useQuery({
    queryKey: ["face-set-usages", faceSetId],
    enabled: faceSetId !== undefined,
    queryFn: async () =>
      (
        await apiRequest<FaceSetUsages>(
          `/face-sets/${encodeURIComponent(faceSetId ?? "")}/usages`,
        )
      ).data,
  });
}

/**
 * Loads every revision of the given Face Sets. Work-local appearances pin a
 * version, so expression options must not come from the latest revision.
 */
export function useFaceSetRevisions(faceSetIds: readonly string[]) {
  const key = [...new Set(faceSetIds)].sort().join("|");
  const ids = key.length === 0 ? [] : key.split("|");
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["face-set-revisions", id],
      queryFn: async () =>
        (await apiRequest<FaceSetRevision[]>(`/face-sets/${encodeURIComponent(id)}/revisions`))
          .data,
    })),
  });
  const byKey = new Map<string, FaceSetRevision>();
  for (const result of results) {
    for (const revision of result.data ?? []) {
      byKey.set(`${revision.faceSetId}@${revision.version}`, revision);
    }
  }
  return {
    revisions: [...byKey.values()],
    byKey,
    isReady: ids.length === 0 || results.every((result) => result.isSuccess),
    isError: results.some((result) => result.isError),
  };
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["face-sets"] });
      queryClient.invalidateQueries({ queryKey: ["face-set-revisions"] });
    },
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
