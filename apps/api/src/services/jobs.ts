import type { PrismaClient } from "../generated/prisma/client.ts";
import { toJob } from "../dto/mappers.ts";
import type { Job as JobDto } from "@kakeai/contracts";
import { ApiError } from "../http/errors.ts";
import { resourceNotFound } from "../http/validation.ts";

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

export async function listWorkJobs(prisma: PrismaClient, workId: string): Promise<JobDto[]> {
  const work = await prisma.work.findUnique({ where: { id: workId }, select: { id: true } });
  if (work === null) {
    throw resourceNotFound("work", workId);
  }
  const rows = await prisma.job.findMany({
    where: { workId, kind: "render" },
    include: { artifacts: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toJob);
}

export async function cancelJob(prisma: PrismaClient, jobId: string): Promise<JobDto> {
  const cancelled = await prisma.$transaction(async (transaction) => {
    const row = await transaction.job.findUnique({ where: { id: jobId } });
    if (row === null) {
      throw resourceNotFound("job", jobId);
    }
    if (row.status !== "queued") {
      throw new ApiError(409, "JOB_NOT_CANCELLABLE", undefined, {
        jobId,
        status: row.status,
      });
    }
    const claimed = await transaction.job.updateMany({
      where: { id: jobId, status: "queued" },
      data: { status: "cancelled", finishedAt: new Date() },
    });
    if (claimed.count === 0) {
      const latest = await transaction.job.findUnique({ where: { id: jobId } });
      throw new ApiError(409, "JOB_NOT_CANCELLABLE", undefined, {
        jobId,
        status: latest?.status ?? "unknown",
      });
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
  return toJob(cancelled);
}
