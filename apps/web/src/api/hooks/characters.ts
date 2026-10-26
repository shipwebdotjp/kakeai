import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CharacterLibraryEntry,
  CreateCharacterRequest,
  UpdateCharacterRequest,
} from "@kakeai/contracts";
import { apiRequest } from "../client";

export function useCharacters() {
  return useQuery({
    queryKey: ["characters"],
    queryFn: async () => (await apiRequest<CharacterLibraryEntry[]>("/characters")).data,
  });
}

export function useCreateCharacter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCharacterRequest) =>
      (await apiRequest<CharacterLibraryEntry>("/characters", { method: "POST", body: input })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["characters"] }),
  });
}

export function useUpdateCharacter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateCharacterRequest }) =>
      (
        await apiRequest<CharacterLibraryEntry>(`/characters/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: input,
        })
      ).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["characters"] }),
  });
}

export function useDeleteCharacter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest(`/characters/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["characters"] }),
  });
}
