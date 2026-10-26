import { useMutation, useQueryClient } from "@tanstack/react-query";
import { jobErrorCodeSchema } from "@kakeai/contracts";
import type {
  BulkTtsJobEntry,
  BulkTtsJobExclusion,
  BulkTtsJobsResult,
  Job,
  TtsJobResult,
} from "@kakeai/contracts";
import { ApiError, apiRequest } from "../client";
import { queryKeys } from "./queryKeys";

const TTS_POLL_INTERVAL_MS = 1000;
const TTS_POLL_MAX_ATTEMPTS = 120;
const BULK_TTS_POLL_CONCURRENCY = 5;

type JobErrorCode = (typeof jobErrorCodeSchema.options)[number];

const TTS_JOB_ERROR_MESSAGES: Partial<Record<JobErrorCode, string>> = {
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

function classifyTtsFailure(error: unknown): { code: string; message: string } {
  if (error instanceof TtsJobFailedError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof ApiError) {
    const code = String(error.code);
    return { code, message: TTS_JOB_ERROR_MESSAGES[code as JobErrorCode] ?? error.message };
  }
  if (error instanceof Error) {
    return { code: "TTS_SYNTHESIS_FAILED", message: error.message };
  }
  return { code: "TTS_SYNTHESIS_FAILED", message: "音声生成に失敗しました。" };
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.assets() }),
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
          failed.push({
            narrationSegmentId: entry.narrationSegmentId,
            ...classifyTtsFailure(error),
          });
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.assets() }),
  });
}
