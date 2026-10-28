import type { PrismaClient } from "../generated/prisma/client.ts";
import { toJob } from "../dto/mappers.ts";
import type { Job as JobDto, JobKind } from "@kakeai/contracts";
import { ApiError } from "../http/errors.ts";
import { resourceNotFound } from "../http/validation.ts";
import { logger } from "../logger.ts";
import { abortActiveRender } from "./render-cancellation.ts";

export async function getJob(prisma: PrismaClient, jobId: string): Promise<JobDto> {
  const row = await prisma.job.findUnique({
    where: { id: jobId },
    include: { artifacts: true },
  });
  if (row === null) {
    throw resourceNotFound("job", jobId);
  }
  return toJob(row);
}

export async function listWorkJobs(
  prisma: PrismaClient,
  workId: string,
  kind: JobKind = "render",
): Promise<JobDto[]> {
  const work = await prisma.work.findUnique({ where: { id: workId }, select: { id: true } });
  if (work === null) {
    throw resourceNotFound("work", workId);
  }
  const rows = await prisma.job.findMany({
    where: { workId, kind },
    include: { artifacts: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toJob);
}

export async function cancelJob(prisma: PrismaClient, jobId: string): Promise<JobDto> {
  let abortRender = false;
  const cancelled = await prisma.$transaction(async (transaction) => {
    const row = await transaction.job.findUnique({ where: { id: jobId } });
    if (row === null) {
      throw resourceNotFound("job", jobId);
    }
    const cancellableRunningRender = row.kind === "render" && row.status === "running";
    if (row.status !== "queued" && !cancellableRunningRender) {
      throw new ApiError(409, "JOB_NOT_CANCELLABLE", undefined, {
        jobId,
        status: row.status,
      });
    }
    const previousStatus = row.status;
    const claimed = await transaction.job.updateMany({
      where: { id: jobId, status: previousStatus },
      data: { status: "cancelled", finishedAt: new Date() },
    });
    if (claimed.count === 0) {
      const latest = await transaction.job.findUnique({ where: { id: jobId } });
      throw new ApiError(409, "JOB_NOT_CANCELLABLE", undefined, {
        jobId,
        status: latest?.status ?? "unknown",
      });
    }
    if (previousStatus === "running") {
      // Stop the render engine only after the status is committed as cancelled,
      // so a late success write can never overwrite it.
      abortRender = true;
    }
    if (row.kind === "asset_ingest" && row.assetId !== null) {
      await transaction.asset.updateMany({
        where: { id: row.assetId },
        data: { status: "failed" },
      });
    }
    return transaction.job.findUniqueOrThrow({
      where: { id: jobId },
      include: { artifacts: true },
    });
  });
  if (abortRender) {
    // The DB status already prevents a late success. A missing live controller
    // means the worker had not registered yet or already finished.
    if (!abortActiveRender(jobId)) {
      logger.warn("render_cancel_without_active_worker", { jobId });
    }
  }
  return toJob(cancelled);
}
