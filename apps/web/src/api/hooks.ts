import { useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ASSET_LIST_MAX_LIMIT,
  voiceAdapterIdSchema,
  warningsMetaSchema,
} from "@kakeai/contracts";
import type {
  Asset,
  AssetListPage,
  BulkTtsJobEntry,
  BulkTtsJobExclusion,
  BulkTtsJobsResult,
  CharacterLibraryEntry,
  Composition,
  ContentDocument,
  CreateCharacterRequest,
  CreateFaceSetRequest,
  CreateVoiceProfileRequest,
  FaceSet,
  Job,
  ModelList,
  ScriptVersion,
  ScriptVersionPreview,
  ScriptVersionSummary,
  TtsJobResult,
  UpdateCharacterRequest,
  UpdateFaceSetRequest,
  UpdateVoiceProfileRequest,
  VoiceAdapterId,
  VoiceAdapterList,
  VoiceList,
  VoiceProfile,
  Warning,
  Work,
  WorkSummary,
  FontCatalog,
  ThemeDetail,
  ThemeSummary,
  CreateThemeRequest,
  VisualThemeDefinition,
  DraftPreview,
  Thumbnail,
  ThumbnailPreview,
  CreateThumbnailRequest,
  SaveThumbnailRequest,
  ThumbnailPreviewRequest,
} from "@kakeai/contracts";
import { type AdapterVoicesState } from "../lib/voiceAdapters";
import { ApiError, apiRequest, apiUpload, type Envelope } from "./client";

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

export function useCloneWork() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ workId, title }: { workId: string; title: string }) =>
      (
        await apiRequest<Work>(`/works/${encodeURIComponent(workId)}/clone`, {
          method: "POST",
          body: { title },
        })
      ).data,
    onSuccess: (newWork) => {
      queryClient.invalidateQueries({ queryKey: ["works"] });
      queryClient.setQueryData(["work", newWork.id], newWork);
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

const ASSET_FETCH_PAGE_SIZE = ASSET_LIST_MAX_LIMIT;
const ASSET_FETCH_MAX_PAGES = 100;

/**
 * Reads the whole library through the paged contract while keeping the UI's
 * existing `Asset[]` shape. Archived assets are included so the library's
 * archive toggle and cleanup still see them.
 */
async function fetchAllAssets(signal?: AbortSignal): Promise<Asset[]> {
  const assets: Asset[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < ASSET_FETCH_MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      limit: String(ASSET_FETCH_PAGE_SIZE),
      archived: "include",
    });
    if (cursor !== null) {
      params.set("cursor", cursor);
    }
    const result = (
      await apiRequest<AssetListPage>(`/assets?${params.toString()}`, { signal })
    ).data;
    assets.push(...result.assets);
    if (result.nextCursor === null) {
      return assets;
    }
    if (seenCursors.has(result.nextCursor)) {
      throw new Error("素材一覧のページングが循環しています。");
    }
    seenCursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  // A very large library must not turn every asset view into an error screen.
  // Show what was loaded and leave the rest to a narrower query.
  console.warn(
    `素材一覧が ${ASSET_FETCH_MAX_PAGES} ページを超えたため、読み込み済みの素材だけを表示します。`,
  );
  return assets;
}

export function useAssets() {
  return useQuery({
    queryKey: ["assets"],
    queryFn: ({ signal }) => fetchAllAssets(signal),
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

export function useCreateLanguageEdition(workId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { locale: string; sourceEditionId: string }): Promise<Work> =>
      (
        await apiRequest<Work>(`/works/${encodeURIComponent(workId ?? "")}/language-editions`, {
          method: "POST",
          body: input,
        })
      ).data,
    onSuccess: (work) => {
      queryClient.invalidateQueries({ queryKey: ["works"] });
      queryClient.setQueryData(["work", work.id], work);
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

export type UpdateAssetPatch =
  | { tags: string[]; favorited?: boolean; archived?: boolean }
  | { tags?: string[]; favorited: boolean; archived?: boolean }
  | { tags?: string[]; favorited?: boolean; archived: boolean };

export type UpdateAssetInput = { assetId: string } & UpdateAssetPatch;

function applyAssetPatch(asset: Asset, patch: UpdateAssetPatch): Asset {
  const next = { ...asset };
  if (patch.tags !== undefined) {
    next.tags = [...patch.tags];
  }
  if (patch.favorited !== undefined) {
    next.favoritedAt = patch.favorited ? new Date().toISOString() : null;
  }
  if (patch.archived !== undefined) {
    next.archivedAt = patch.archived ? new Date().toISOString() : null;
  }
  return next;
}

export function useUpdateAsset() {
  const queryClient = useQueryClient();
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const mutation = useMutation({
    mutationFn: async ({ assetId, ...patch }: UpdateAssetInput) =>
      (
        await apiRequest<Asset>(`/assets/${encodeURIComponent(assetId)}`, {
          method: "PATCH",
          body: patch,
        })
      ).data,
    onMutate: async ({ assetId, ...patch }) => {
      await queryClient.cancelQueries({ queryKey: ["assets"] });
      setPendingIds((previous) => [...previous, assetId]);
      const previous = queryClient.getQueryData<Asset[]>(["assets"]);
      queryClient.setQueryData<Asset[]>(["assets"], (current) =>
        current?.map((asset) => (asset.id === assetId ? applyAssetPatch(asset, patch) : asset)),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(["assets"], context.previous);
      }
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<Asset[]>(["assets"], (current) =>
        current?.map((asset) => (asset.id === updated.id ? updated : asset)),
      );
    },
    onSettled: (_data, _error, variables) => {
      setPendingIds((previous) => previous.filter((id) => id !== variables.assetId));
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
  });
  return { ...mutation, pendingIds };
}

export interface CleanupAssetsResult {
  deleted: number;
  retained: number;
  failed: number;
}

const CLEANUP_CONCURRENCY = 5;

export function useCleanupAssets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<CleanupAssetsResult> => {
      const assets = (await fetchAllAssets()).filter(
        (asset) => asset.status !== "processing",
      );
      let deleted = 0;
      let retained = 0;
      let failed = 0;
      for (let index = 0; index < assets.length; index += CLEANUP_CONCURRENCY) {
        const chunk = assets.slice(index, index + CLEANUP_CONCURRENCY);
        const results = await Promise.allSettled(
          chunk.map((asset) =>
            apiRequest(`/assets/${encodeURIComponent(asset.id)}`, { method: "DELETE" }),
          ),
        );
        for (const result of results) {
          if (result.status === "fulfilled") {
            deleted += 1;
          } else if (result.reason instanceof ApiError && result.reason.code === "ASSET_IN_USE") {
            retained += 1;
          } else if (
            result.reason instanceof ApiError &&
            result.reason.code === "RESOURCE_NOT_FOUND"
          ) {
            deleted += 1;
          } else {
            failed += 1;
          }
        }
      }
      return { deleted, retained, failed };
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["assets"] }),
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

export function useScriptVersions(editionId: string | undefined) {
  return useQuery({
    queryKey: ["script-versions", editionId],
    enabled: editionId !== undefined && editionId.length > 0,
    queryFn: async () =>
      (
        await apiRequest<ScriptVersionSummary[]>(
          `/language-editions/${encodeURIComponent(editionId ?? "")}/script-versions`,
        )
      ).data,
  });
}

export function useScriptVersion(scriptVersionId: string | undefined) {
  return useQuery({
    queryKey: ["script-version", scriptVersionId],
    enabled: scriptVersionId !== undefined && scriptVersionId.length > 0,
    queryFn: async () =>
      (
        await apiRequest<ScriptVersion>(
          `/script-versions/${encodeURIComponent(scriptVersionId ?? "")}`,
        )
      ).data,
  });
}

export function useRestoreScriptVersion(workId: string | undefined, editionId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sourceScriptVersionId: string): Promise<SaveScriptVersionResult> => {
      if (editionId === undefined || editionId.length === 0) {
        throw new Error("editionId がありません");
      }
      const sourceVersion = (
        await apiRequest<ScriptVersion>(
          `/script-versions/${encodeURIComponent(sourceScriptVersionId)}`,
        )
      ).data;

      const response: Envelope<ScriptVersion> = await apiRequest<ScriptVersion>(
        `/language-editions/${encodeURIComponent(editionId)}/script-versions`,
        { method: "POST", body: { sourceScriptVersionId, content: sourceVersion.content } },
      );
      const parsedMeta = warningsMetaSchema.safeParse(response.meta);
      const warnings = parsedMeta.success ? parsedMeta.data.warnings : [];
      return { scriptVersion: response.data, warnings };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["works"] });
      if (workId !== undefined && workId.length > 0) {
        queryClient.invalidateQueries({ queryKey: ["work", workId] });
      }
      if (editionId !== undefined && editionId.length > 0) {
        queryClient.invalidateQueries({ queryKey: ["current-script-version", editionId] });
        queryClient.invalidateQueries({ queryKey: ["script-versions", editionId] });
      }
    },
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

export function useDeleteArtifact(workId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (artifactId: string) => {
      await apiRequest(`/artifacts/${encodeURIComponent(artifactId)}`, { method: "DELETE" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["work-jobs", workId] }),
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
    queryKey: ["adapter-voices", adapterId, normalizedModel],
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
      queryKey: ["adapter-voices", adapterId, ""],
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
const BULK_TTS_POLL_CONCURRENCY = 5;

const TTS_JOB_ERROR_MESSAGES: Record<string, string> = {
  TTS_ENGINE_UNAVAILABLE: "音声エンジンに接続できません。起動を確認してください。",
  TTS_INPUT_REJECTED: "音声エンジンが入力を拒否しました。読み上げテキストやスタイルを確認してください。",
  TTS_SYNTHESIS_FAILED: "音声の合成に失敗しました。",
  WORKER_INTERRUPTED: "音声生成が中断されました。再試行してください。",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class TtsJobFailedError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "TtsJobFailedError";
    this.code = code;
  }
}

async function pollTtsJob(jobId: string): Promise<TtsJobResult> {
  for (let attempt = 0; attempt < TTS_POLL_MAX_ATTEMPTS; attempt += 1) {
    await sleep(TTS_POLL_INTERVAL_MS);
    let job: Job;
    try {
      job = (await apiRequest<Job>(`/jobs/${encodeURIComponent(jobId)}`)).data;
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) {
        throw error;
      }
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
      throw new TtsJobFailedError(code, TTS_JOB_ERROR_MESSAGES[code] ?? "音声生成に失敗しました。");
    }
  }
  await apiRequest(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" }).catch(
    () => undefined,
  );
  throw new Error("音声生成がタイムアウトしました。");
}

export interface GenerateTtsInput {
  narrationSegmentId: string;
  voiceId: string;
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
              ...(input.voiceId.trim().length === 0 ? {} : { voiceId: input.voiceId }),
              speedScale: input.speedScale,
              ...(input.speechText === undefined || input.speechText.trim().length === 0
                ? {}
                : { speechText: input.speechText }),
            },
          },
        )
      ).data;
      return pollTtsJob(created.id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assets"] }),
  });
}

export interface BulkTtsFailure {
  narrationSegmentId: string;
  code: string;
  message: string;
}

export interface BulkTtsRunCallbacks {
  onProgress?: (done: number, total: number) => void;
  onJobSucceeded?: (result: TtsJobResult) => void;
}

export interface BulkTtsSummary {
  excluded: BulkTtsJobExclusion[];
  failed: BulkTtsFailure[];
  succeeded: number;
}

export function useBulkGenerateTtsTakes(scriptVersionId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (callbacks: BulkTtsRunCallbacks = {}): Promise<BulkTtsSummary> => {
      if (scriptVersionId === undefined || scriptVersionId.length === 0) {
        throw new Error("scriptVersionId がありません");
      }
      const result = (
        await apiRequest<BulkTtsJobsResult>(
          `/script-versions/${encodeURIComponent(scriptVersionId)}/tts-jobs`,
          { method: "POST", body: {} },
        )
      ).data;
      const total = result.jobs.length;
      let done = 0;
      callbacks.onProgress?.(done, total);
      const failed: BulkTtsFailure[] = [];
      const runEntry = async (entry: BulkTtsJobEntry) => {
        try {
          const ttsResult = await pollTtsJob(entry.job.id);
          callbacks.onJobSucceeded?.(ttsResult);
        } catch (error) {
          const code =
            error instanceof TtsJobFailedError
              ? error.code
              : error instanceof ApiError
                ? String(error.code)
                : "TTS_SYNTHESIS_FAILED";
          const message =
            error instanceof TtsJobFailedError
              ? error.message
              : error instanceof ApiError
                ? (TTS_JOB_ERROR_MESSAGES[String(error.code)] ?? error.message)
                : error instanceof Error
                  ? error.message
                  : "音声生成に失敗しました。";
          failed.push({ narrationSegmentId: entry.narrationSegmentId, code, message });
        } finally {
          done += 1;
          callbacks.onProgress?.(done, total);
        }
      };
      for (let index = 0; index < result.jobs.length; index += BULK_TTS_POLL_CONCURRENCY) {
        await Promise.all(
          result.jobs.slice(index, index + BULK_TTS_POLL_CONCURRENCY).map(runEntry),
        );
      }
      return { excluded: result.excluded, failed, succeeded: total - failed.length };
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

export function useCompositions() {
  return useQuery({
    queryKey: ["compositions"],
    queryFn: async () => (await apiRequest<Composition[]>("/compositions")).data,
  });
}

export function useThemes(includeArchived = false) {
  return useQuery({
    queryKey: ["themes", { includeArchived }],
    queryFn: async () =>
      (
        await apiRequest<ThemeSummary[]>(
          `/themes${includeArchived ? "?includeArchived=true" : ""}`,
        )
      ).data,
  });
}

export function useTheme(themeId: string | undefined) {
  return useQuery({
    queryKey: ["theme", themeId],
    enabled: themeId !== undefined && themeId.length > 0,
    queryFn: async () =>
      (await apiRequest<ThemeDetail>(`/themes/${encodeURIComponent(themeId ?? "")}`)).data,
  });
}

export function useCreateTheme() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateThemeRequest) =>
      (await apiRequest<ThemeDetail>("/themes", { method: "POST", body: input })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["themes"] }),
  });
}

export function useUpdateThemeDraft(themeId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (definition: VisualThemeDefinition) => {
      if (themeId === undefined || themeId.length === 0) {
        throw new Error("themeId がありません");
      }
      return (
        await apiRequest<ThemeDetail>(`/themes/${encodeURIComponent(themeId)}/draft`, {
          method: "PUT",
          body: { definition },
        })
      ).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["themes"] });
      queryClient.invalidateQueries({ queryKey: ["theme", themeId] });
    },
  });
}

export function useDiscardThemeDraft(themeId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (themeId === undefined || themeId.length === 0) {
        throw new Error("themeId がありません");
      }
      return (
        await apiRequest<ThemeDetail>(`/themes/${encodeURIComponent(themeId)}/draft`, {
          method: "DELETE",
        })
      ).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["themes"] });
      queryClient.invalidateQueries({ queryKey: ["theme", themeId] });
    },
  });
}

export function usePublishThemeDraft(themeId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (themeId === undefined || themeId.length === 0) {
        throw new Error("themeId がありません");
      }
      return (
        await apiRequest<ThemeDetail>(`/themes/${encodeURIComponent(themeId)}/publish`, {
          method: "POST",
          body: {},
        })
      ).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["themes"] });
      queryClient.invalidateQueries({ queryKey: ["theme", themeId] });
    },
  });
}

export function useArchiveTheme() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (themeId: string) =>
      (
        await apiRequest<ThemeDetail>(`/themes/${encodeURIComponent(themeId)}/archive`, {
          method: "POST",
        })
      ).data,
    onSuccess: (_data, themeId) => {
      queryClient.invalidateQueries({ queryKey: ["themes"] });
      queryClient.invalidateQueries({ queryKey: ["theme", themeId] });
    },
  });
}

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

export function usePreviewThemeDraft() {
  return useMutation({
    mutationFn: async (definition: VisualThemeDefinition) =>
      (
        await apiRequest<DraftPreview>("/themes/preview", {
          method: "POST",
          body: { definition },
        })
      ).data,
  });
}

export function useThumbnails(editionId: string | undefined) {
  return useQuery({
    queryKey: ["thumbnails", editionId],
    enabled: editionId !== undefined && editionId.length > 0,
    queryFn: async () =>
      (
        await apiRequest<Thumbnail[]>(
          `/language-editions/${encodeURIComponent(editionId ?? "")}/thumbnails`,
        )
      ).data,
  });
}

export function useCreateThumbnail(editionId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateThumbnailRequest) => {
      if (editionId === undefined || editionId.length === 0) {
        throw new Error("editionId がありません");
      }
      return (
        await apiRequest<Thumbnail>(
          `/language-editions/${encodeURIComponent(editionId)}/thumbnails`,
          { method: "POST", body: input },
        )
      ).data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["thumbnails", editionId] }),
  });
}

export function useSaveThumbnail(editionId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: SaveThumbnailRequest }) =>
      (
        await apiRequest<Thumbnail>(`/thumbnails/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: input,
        })
      ).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["thumbnails", editionId] }),
  });
}

export function useDeleteThumbnail(editionId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest(`/thumbnails/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["thumbnails", editionId] }),
  });
}

export function useSetPrimaryThumbnail(editionId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (thumbnailId: string | null) => {
      if (editionId === undefined || editionId.length === 0) {
        throw new Error("editionId がありません");
      }
      return (
        await apiRequest<Thumbnail | null>(
          `/language-editions/${encodeURIComponent(editionId)}/primary-thumbnail`,
          { method: "PUT", body: { thumbnailId } },
        )
      ).data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["thumbnails", editionId] }),
  });
}

export function useThumbnailPreview(editionId: string | undefined) {
  return useMutation({
    mutationFn: async (input: ThumbnailPreviewRequest): Promise<ThumbnailPreview> => {
      if (editionId === undefined || editionId.length === 0) {
        throw new Error("editionId がありません");
      }
      return (
        await apiRequest<ThumbnailPreview>(
          `/language-editions/${encodeURIComponent(editionId)}/thumbnail-preview`,
          { method: "POST", body: input },
        )
      ).data;
    },
  });
}
