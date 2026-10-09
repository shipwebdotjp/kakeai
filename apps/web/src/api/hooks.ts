import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { voiceAdapterIdSchema, warningsMetaSchema } from "@kakeai/contracts";
import type {
  Asset,
  CharacterLibraryEntry,
  ContentDocument,
  CreateCharacterRequest,
  CreateVoiceProfileRequest,
  Job,
  ScriptVersion,
  ScriptVersionPreview,
  TtsJobResult,
  UpdateCharacterRequest,
  UpdateVoiceProfileRequest,
  VoiceAdapterId,
  VoiceList,
  VoiceProfile,
  Warning,
  Work,
  WorkSummary,
} from "@kakeai/contracts";
import { type AdapterVoicesState } from "../lib/voiceAdapters";
import { apiRequest, apiUpload, type Envelope } from "./client";

export function useWorks() {
  return useQuery({
    queryKey: ["works"],
    queryFn: async () => (await apiRequest<WorkSummary[]>("/works")).data,
  });
}

export function useWork(workId: string | undefined) {
  return useQuery({
    queryKey: ["work", workId],
    enabled: workId !== undefined && workId.length > 0,
    queryFn: async () => (await apiRequest<Work>(`/works/${encodeURIComponent(workId ?? "")}`)).data,
  });
}

export function useCreateWork() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (title: string) =>
      (await apiRequest<Work>("/works", { method: "POST", body: { title, originalLocale: "ja-JP" } }))
        .data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["works"] }),
  });
}

export function useUpdateWork(workId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (title: string) => {
      if (workId === undefined || workId.length === 0) {
        throw new Error("workId がありません");
      }
      return (
        await apiRequest<Work>(`/works/${encodeURIComponent(workId)}`, {
          method: "PATCH",
          body: { title },
        })
      ).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["works"] });
      queryClient.invalidateQueries({ queryKey: ["work", workId] });
    },
  });
}

export function useDeleteWork() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (workId: string) => {
      await apiRequest(`/works/${encodeURIComponent(workId)}`, { method: "DELETE" });
    },
    onSuccess: (_data, workId) => {
      queryClient.invalidateQueries({ queryKey: ["works"] });
      queryClient.removeQueries({ queryKey: ["work", workId] });
    },
  });
}

export function useAssets() {
  return useQuery({
    queryKey: ["assets"],
    queryFn: async () => (await apiRequest<Asset[]>("/assets")).data,
    refetchInterval: (query) => {
      const data = query.state.data;
      return Array.isArray(data) && data.some((asset) => asset.status === "processing")
        ? 1500
        : false;
    },
  });
}

export interface UploadAssetsResult {
  uploaded: Asset[];
  failed: { file: File; error: unknown }[];
}

export function useUploadAssets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (files: File[]): Promise<UploadAssetsResult> => {
      const uploaded: Asset[] = [];
      const failed: { file: File; error: unknown }[] = [];
      for (const file of files) {
        try {
          uploaded.push((await apiUpload<Asset>("/assets", file)).data);
        } catch (error) {
          failed.push({ file, error });
        }
      }
      return { uploaded, failed };
    },
    onSuccess: (result) => {
      if (result.uploaded.length > 0) {
        queryClient.invalidateQueries({ queryKey: ["assets"] });
      }
    },
  });
}

export function useDeleteAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (assetId: string) => {
      await apiRequest(`/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assets"] }),
  });
}

export function useCurrentScriptVersion(editionId: string | undefined) {
  return useQuery({
    queryKey: ["current-script-version", editionId],
    enabled: editionId !== undefined && editionId.length > 0,
    queryFn: async () =>
      (
        await apiRequest<ScriptVersion>(
          `/language-editions/${encodeURIComponent(editionId ?? "")}/current-script-version`,
        )
      ).data,
  });
}

export function useScriptVersionPreview(scriptVersionId: string | undefined) {
  return useQuery({
    queryKey: ["script-version-preview", scriptVersionId],
    enabled: scriptVersionId !== undefined && scriptVersionId.length > 0,
    staleTime: 30_000,
    placeholderData: (previousData) => previousData,
    queryFn: async () =>
      (
        await apiRequest<ScriptVersionPreview>(
          `/script-versions/${encodeURIComponent(scriptVersionId ?? "")}/preview`,
        )
      ).data,
  });
}

export interface SaveScriptVersionResult {
  scriptVersion: ScriptVersion;
  warnings: Warning[];
}

export function useSaveScriptVersion(editionId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (content: ContentDocument): Promise<SaveScriptVersionResult> => {
      if (editionId === undefined || editionId.length === 0) {
        throw new Error("editionId がありません");
      }
      const response: Envelope<ScriptVersion> = await apiRequest<ScriptVersion>(
        `/language-editions/${encodeURIComponent(editionId)}/script-versions`,
        { method: "POST", body: { sourceScriptVersionId: null, content } },
      );
      const parsedMeta = warningsMetaSchema.safeParse(response.meta);
      const warnings = parsedMeta.success ? parsedMeta.data.warnings : [];
      return { scriptVersion: response.data, warnings };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["works"] });
      queryClient.invalidateQueries({ queryKey: ["current-script-version", editionId] });
    },
  });
}

export function useCreateRenderJob(scriptVersionId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<Job> => {
      if (scriptVersionId === undefined || scriptVersionId.length === 0) {
        throw new Error("scriptVersionId がありません");
      }
      return (
        await apiRequest<Job>(`/script-versions/${encodeURIComponent(scriptVersionId)}/render-jobs`, {
          method: "POST",
          body: {},
        })
      ).data;
    },
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: ["works"] });
      if (job.workId !== null) {
        queryClient.invalidateQueries({ queryKey: ["work-jobs", job.workId] });
      }
    },
  });
}

export function useWorkJobs(workId: string | undefined) {
  return useQuery({
    queryKey: ["work-jobs", workId],
    enabled: workId !== undefined && workId.length > 0,
    queryFn: async () =>
      (await apiRequest<Job[]>(`/works/${encodeURIComponent(workId ?? "")}/jobs`)).data,
    refetchInterval: (query) => {
      const data = query.state.data;
      return Array.isArray(data) &&
        data.some((job) => job.status === "queued" || job.status === "running")
        ? 2000
        : false;
    },
  });
}

export function useCancelJob(workId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) =>
      (await apiRequest<Job>(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" }))
        .data,
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: ["works"] });
      const targetWorkId = job.workId ?? workId;
      if (targetWorkId !== undefined && targetWorkId !== null) {
        queryClient.invalidateQueries({ queryKey: ["work-jobs", targetWorkId] });
      }
    },
  });
}

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

export function useAdapterVoices(adapterId: VoiceAdapterId | undefined) {
  return useQuery({
    queryKey: ["adapter-voices", adapterId],
    enabled: adapterId !== undefined,
    retry: false,
    staleTime: 60_000,
    queryFn: async () =>
      (
        await apiRequest<VoiceList>(
          `/voice-profiles/voices?adapterId=${encodeURIComponent(adapterId ?? "")}`,
        )
      ).data,
  });
}

export function useAdapterVoicesMap(): Record<VoiceAdapterId, AdapterVoicesState> {
  const results = useQueries({
    queries: voiceAdapterIdSchema.options.map((adapterId) => ({
      queryKey: ["adapter-voices", adapterId],
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

const TTS_POLL_INTERVAL_MS = 1000;
const TTS_POLL_MAX_ATTEMPTS = 120;

const TTS_JOB_ERROR_MESSAGES: Record<string, string> = {
  TTS_ENGINE_UNAVAILABLE: "音声エンジンに接続できません。起動を確認してください。",
  TTS_INPUT_REJECTED: "音声エンジンが入力を拒否しました。読み上げテキストやスタイルを確認してください。",
  TTS_SYNTHESIS_FAILED: "音声の合成に失敗しました。",
  WORKER_INTERRUPTED: "音声生成が中断されました。再試行してください。",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface GenerateTtsInput {
  narrationSegmentId: string;
  styleId: number;
  speedScale: number;
  speechText?: string;
}

export function useGenerateTtsTake(scriptVersionId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: GenerateTtsInput): Promise<TtsJobResult> => {
      if (scriptVersionId === undefined || scriptVersionId.length === 0) {
        throw new Error("scriptVersionId がありません");
      }
      const created = (
        await apiRequest<Job>(
          `/script-versions/${encodeURIComponent(scriptVersionId)}/narration-segments/${encodeURIComponent(
            input.narrationSegmentId,
          )}/tts-jobs`,
          {
            method: "POST",
            body: {
              styleId: input.styleId,
              speedScale: input.speedScale,
              ...(input.speechText === undefined || input.speechText.trim().length === 0
                ? {}
                : { speechText: input.speechText }),
            },
          },
        )
      ).data;
      for (let attempt = 0; attempt < TTS_POLL_MAX_ATTEMPTS; attempt += 1) {
        await sleep(TTS_POLL_INTERVAL_MS);
        let job: Job;
        try {
          job = (await apiRequest<Job>(`/jobs/${encodeURIComponent(created.id)}`)).data;
        } catch {
          continue;
        }
        if (job.status === "succeeded") {
          if (job.ttsResult === null) {
            throw new Error("音声生成に失敗しました。");
          }
          return job.ttsResult;
        }
        if (job.status === "failed" || job.status === "cancelled") {
          const code = job.error?.code ?? "TTS_SYNTHESIS_FAILED";
          throw new Error(TTS_JOB_ERROR_MESSAGES[code] ?? "音声生成に失敗しました。");
        }
      }
      await apiRequest(`/jobs/${encodeURIComponent(created.id)}/cancel`, { method: "POST" }).catch(
        () => undefined,
      );
      throw new Error("音声生成がタイムアウトしました。");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assets"] }),
  });
}

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
