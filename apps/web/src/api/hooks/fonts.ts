import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FontCatalog } from "@kakeai/contracts";
import { apiRequest } from "../client";

export function useFontCatalog() {
  return useQuery({
    queryKey: ["font-catalog"],
    staleTime: 60_000,
    queryFn: async () => (await apiRequest<FontCatalog>("/fonts")).data,
  });
}

export function useRefreshFontCatalog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await apiRequest<FontCatalog>("/fonts/refresh", { method: "POST", body: {} })).data,
    onSuccess: (catalog) => {
      queryClient.setQueryData(["font-catalog"], catalog);
    },
  });
}
