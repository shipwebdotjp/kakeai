import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Composition, ListCompositionsQuery } from "@kakeai/contracts";
import { apiRequest } from "../client";

function compositionQueryString(filter: ListCompositionsQuery): string {
  const params = new URLSearchParams();
  if (filter.workId !== undefined) {
    params.set("workId", filter.workId);
  }
  if (filter.scope !== undefined) {
    params.set("scope", filter.scope);
  }
  if (filter.archived !== undefined) {
    params.set("archived", filter.archived);
  }
  const query = params.toString();
  return query.length === 0 ? "" : `?${query}`;
}

export function useCompositions(filter: ListCompositionsQuery = {}) {
  return useQuery({
    queryKey: ["compositions", filter],
    queryFn: async () =>
      (
        await apiRequest<Composition[]>(
          `/compositions${compositionQueryString(filter)}`,
        )
      ).data,
  });
}

export function useUpdateCompositionArchive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      compositionId,
      archived,
    }: {
      compositionId: string;
      archived: boolean;
    }) =>
      (
        await apiRequest<Composition>(
          `/compositions/${encodeURIComponent(compositionId)}`,
          { method: "PATCH", body: { archived } },
        )
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compositions"] });
    },
  });
}
