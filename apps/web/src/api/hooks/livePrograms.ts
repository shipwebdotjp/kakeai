import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateLiveProgramRequest,
  FinalizeLiveProgramVersionRequest,
  ImportLiveMaterialRequest,
  LiveMaterialImportResult,
  LiveMaterialList,
  LiveProgramDetail,
  LiveProgramList,
  LiveProgramVersionDetail,
  LiveProgramVersionList,
  RestoreLiveProgramVersionDraftRequest,
  SaveLiveProgramDraftRequest,
} from "@kakeai/contracts";
import { apiRequest } from "../client";
import { queryKeys } from "./queryKeys";

const LIVE_PROGRAM_LIST_LIMIT = 500;
const LIVE_MATERIAL_LIST_LIMIT = 500;

function programPath(programId: string, suffix = ""): string {
  if (programId.length === 0) {
    throw new Error("プログラムIDが指定されていません。");
  }
  return `/live-programs/${encodeURIComponent(programId)}${suffix}`;
}

export function useLivePrograms() {
  return useQuery({
    queryKey: queryKeys.livePrograms(),
    queryFn: async () =>
      (
        await apiRequest<LiveProgramList>(
          `/live-programs?limit=${LIVE_PROGRAM_LIST_LIMIT}`,
        )
      ).data,
  });
}

export function useLiveProgram(programId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.liveProgram(programId),
    enabled: programId !== undefined && programId.length > 0,
    queryFn: async () =>
      (
        await apiRequest<LiveProgramDetail>(programPath(programId ?? ""))
      ).data,
  });
}

export function useCreateLiveProgram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateLiveProgramRequest) =>
      (await apiRequest<LiveProgramDetail>("/live-programs", {
        method: "POST",
        body: input,
      })).data,
    onSuccess: (program) => {
      queryClient.setQueryData(queryKeys.liveProgram(program.id), program);
      queryClient.invalidateQueries({ queryKey: queryKeys.livePrograms() });
    },
  });
}

export function useSaveLiveProgramDraft(programId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveLiveProgramDraftRequest) =>
      (
        await apiRequest<LiveProgramDetail>(
          programPath(programId, "/draft"),
          { method: "PUT", body: input },
        )
      ).data,
    onSuccess: (program) => {
      queryClient.setQueryData(queryKeys.liveProgram(program.id), program);
      queryClient.invalidateQueries({ queryKey: queryKeys.livePrograms() });
    },
  });
}

export function useFinalizeLiveProgramVersion(programId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: FinalizeLiveProgramVersionRequest) =>
      (
        await apiRequest<LiveProgramVersionDetail>(
          programPath(programId, "/versions"),
          { method: "POST", body: input },
        )
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.liveProgram(programId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.liveProgramVersions(programId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.livePrograms() });
    },
  });
}

export function useLiveProgramVersions(programId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.liveProgramVersions(programId),
    enabled: programId !== undefined && programId.length > 0,
    queryFn: async () =>
      (
        await apiRequest<LiveProgramVersionList>(
          programPath(programId ?? "", "/versions"),
        )
      ).data,
  });
}

export function useLiveProgramVersion(
  programId: string | undefined,
  versionId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.liveProgramVersion(programId, versionId),
    enabled:
      programId !== undefined &&
      programId.length > 0 &&
      versionId !== undefined &&
      versionId.length > 0,
    queryFn: async () =>
      (
        await apiRequest<LiveProgramVersionDetail>(
          programPath(
            programId ?? "",
            `/versions/${encodeURIComponent(versionId ?? "")}`,
          ),
        )
      ).data,
  });
}

export function useRestoreLiveProgramVersionDraft(programId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      versionId,
      request,
    }: {
      versionId: string;
      request: RestoreLiveProgramVersionDraftRequest;
    }) =>
      (
        await apiRequest<LiveProgramDetail>(
          programPath(
            programId,
            `/versions/${encodeURIComponent(versionId)}/draft`,
          ),
          { method: "POST", body: request },
        )
      ).data,
    onSuccess: (program) => {
      queryClient.setQueryData(queryKeys.liveProgram(program.id), program);
      queryClient.invalidateQueries({ queryKey: queryKeys.livePrograms() });
    },
  });
}

export function useLiveMaterials(programId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.liveMaterials(programId),
    enabled: programId !== undefined && programId.length > 0,
    queryFn: async () =>
      (
        await apiRequest<LiveMaterialList>(
          programPath(
            programId ?? "",
            `/materials?limit=${LIVE_MATERIAL_LIST_LIMIT}`,
          ),
        )
      ).data,
  });
}

export function useImportLiveMaterial(programId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ImportLiveMaterialRequest) =>
      (
        await apiRequest<LiveMaterialImportResult>(
          programPath(programId, "/materials/import"),
          { method: "POST", body: input },
        )
      ).data,
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.liveProgram(result.program.id), result.program);
      queryClient.invalidateQueries({ queryKey: queryKeys.liveMaterials(programId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.livePrograms() });
    },
  });
}
