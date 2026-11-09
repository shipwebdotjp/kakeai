import type {
  LiveExportFailure,
  LiveExportJobSnapshot,
  LiveExportResult,
  TtsAdapter,
  VoiceAdapterId,
} from "@kakeai/contracts";
import { parseLiveExportJobSnapshot } from "@kakeai/contracts";
import type { Job, PrismaClient } from "../generated/prisma/client.ts";
import { logger } from "../logger.ts";
import type { Rasterizer } from "../media/rasterize.ts";
import { LiveExportError } from "../live/errors.ts";
import type { RenderMp4 } from "../live/prepare-live-materials.ts";

export interface LiveExportJobDependencies {
  adapterFor?: (id: VoiceAdapterId) => TtsAdapter;
  rasterizer?: Rasterizer;
  renderMp4?: RenderMp4;
  isCancelled?: (jobId: string) => Promise<boolean>;
}

export function parseSnapshot(job: Job): LiveExportJobSnapshot {
  try {
    return parseLiveExportJobSnapshot(JSON.parse(job.inputSnapshotJson));
  } catch {
    throw new LiveExportError(
      "LIVE_EXPORT_INPUT_INVALID",
      "input",
      "ライブ書き出しの入力を解釈できません。",
    );
  }
}

export async function isJobCancelled(prisma: PrismaClient, jobId: string): Promise<boolean> {
  const row = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
  return row?.status === "cancelled";
}

export async function updateProgress(
  prisma: PrismaClient,
  jobId: string,
  progressPercent: number,
): Promise<void> {
  await prisma.job
    .updateMany({
      where: { id: jobId, status: "running", progressPercent: { lt: progressPercent } },
      data: { progressPercent },
    })
    .catch(() => undefined);
}

export function failureOf(error: unknown): LiveExportFailure {
  if (error instanceof LiveExportError) {
    return error.failure;
  }
  return {
    stage: "unknown",
    id: null,
    message: error instanceof Error ? error.message : String(error),
  };
}

export function errorCodeOf(error: unknown): string {
  return error instanceof LiveExportError ? error.errorCode : "LIVE_EXPORT_FAILED";
}

export async function failJob(
  prisma: PrismaClient,
  job: Job,
  error: unknown,
  warnings: string[],
): Promise<void> {
  const failure = failureOf(error);
  const result: LiveExportResult = {
    packagePath: null,
    packageId: null,
    manifestSha256: null,
    fileCount: null,
    preparedCueCount: null,
    warnings,
    failures: [failure],
  };
  await prisma.job
    .updateMany({
      where: { id: job.id, status: "running" },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorCode: errorCodeOf(error),
        errorMessage: failure.message,
        resultJson: JSON.stringify(result),
      },
    })
    .catch(() => undefined);
  logger.warn("live_export_failed", {
    jobId: job.id,
    stage: failure.stage,
    id: failure.id,
    error: failure.message,
  });
}

export async function succeedJob(
  prisma: PrismaClient,
  job: Job,
  snapshot: LiveExportJobSnapshot,
  result: LiveExportResult,
): Promise<boolean> {
  const updated = await prisma.job.updateMany({
    where: { id: job.id, status: "running" },
    data: {
      status: "succeeded",
      progressPercent: 100,
      finishedAt: new Date(),
      resultJson: JSON.stringify(result),
    },
  });
  if (updated.count === 0) {
    logger.warn("live_export_cancelled_after_commit", {
      jobId: job.id,
      packagePath: snapshot.outDir,
    });
    return false;
  }
  logger.info("live_export_succeeded", {
    jobId: job.id,
    packagePath: snapshot.outDir,
    fileCount: result.fileCount,
  });
  return true;
}
