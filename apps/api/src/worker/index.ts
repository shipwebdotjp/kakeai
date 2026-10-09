import type { WorkerStatus } from "@kakeai/contracts";
import type { AppConfig } from "../config.ts";
import type { Job, PrismaClient } from "../generated/prisma/client.ts";
import { logger } from "../logger.ts";
import { processAssetIngest } from "./asset-ingest.ts";
import { RenderJobError, processRenderJob } from "./render.ts";

export interface Worker {
  status: () => WorkerStatus;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  runOnce: () => Promise<boolean>;
}

export interface WorkerDependencies {
  prisma: PrismaClient;
  config: AppConfig;
  pollIntervalMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 750;

export function createWorker(dependencies: WorkerDependencies): Worker {
  const { prisma, config } = dependencies;
  const pollIntervalMs = dependencies.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let status: WorkerStatus = "notReady";
  let timer: NodeJS.Timeout | undefined;
  let processing = false;

  async function claimNextJob(): Promise<Job | null> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = await prisma.job.findFirst({
        where: { kind: { in: ["asset_ingest", "render"] }, status: "queued" },
        orderBy: { createdAt: "asc" },
      });
      if (candidate === null) {
        return null;
      }
      const claimed = await prisma.job.updateMany({
        where: { id: candidate.id, status: "queued" },
        data: { status: "running", startedAt: new Date() },
      });
      if (claimed.count === 1) {
        return candidate;
      }
    }
    return null;
  }

  async function markFailed(job: Job, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    let errorCode: string;
    if (error instanceof RenderJobError) {
      errorCode = error.code;
    } else if (job.kind === "render") {
      errorCode = "RENDER_FAILED";
    } else {
      errorCode = "ASSET_INGEST_FAILED";
    }
    logger.warn("job_failed", { jobId: job.id, kind: job.kind, error: message });
    await prisma
      .$transaction(async (transaction) => {
        await transaction.job.update({
          where: { id: job.id },
          data: {
            status: "failed",
            finishedAt: new Date(),
            errorCode,
            errorMessage: message,
          },
        });
        if (job.kind === "asset_ingest" && job.assetId !== null) {
          await transaction.asset.updateMany({
            where: { id: job.assetId },
            data: { status: "failed" },
          });
        }
      })
      .catch((failure) => {
        logger.error("job_mark_failed_error", {
          jobId: job.id,
          error: failure instanceof Error ? failure.message : String(failure),
        });
      });
  }

  async function runOnce(): Promise<boolean> {
    const job = await claimNextJob();
    if (job === null) {
      return false;
    }
    try {
      if (job.kind === "render") {
        await processRenderJob(prisma, config, job);
      } else if (job.kind === "asset_ingest") {
        await processAssetIngest(prisma, config, job);
      } else {
        throw new Error(`未対応のJob種別です: ${job.kind}`);
      }
    } catch (error) {
      await markFailed(job, error);
    }
    return true;
  }

  async function drain(): Promise<void> {
    if (processing) {
      return;
    }
    processing = true;
    try {
      while (await runOnce()) {
        continue;
      }
    } catch (error) {
      logger.error("worker_loop_error", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      processing = false;
    }
  }

  return {
    status: () => status,
    async start() {
      status = "ready";
      timer = setInterval(() => {
        void drain();
      }, pollIntervalMs);
      timer.unref?.();
      void drain();
    },
    async stop() {
      status = "notReady";
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
    runOnce,
  };
}
