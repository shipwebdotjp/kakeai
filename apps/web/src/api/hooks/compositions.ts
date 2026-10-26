import { useQuery } from "@tanstack/react-query";
import type { Composition } from "@kakeai/contracts";
import { apiRequest } from "../client";

export function useCompositions() {
  return useQuery({
    queryKey: ["compositions"],
    queryFn: async () => (await apiRequest<Composition[]>("/compositions")).data,
  });
}
