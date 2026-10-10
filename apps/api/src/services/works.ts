import {
  CONTENT_SCHEMA_VERSION,
  createInitialContentDocument,
  type Work,
  type WorkSummary,
} from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { serializeContent } from "../domain/content-json.ts";
import { logger } from "../logger.ts";
import { removeStorageFile } from "../storage/asset-store.ts";
import type { DataDirectories } from "../storage/paths.ts";
import {
  toWork,
  toWorkSummary,
  type EditionWithCurrent,
  type RenderJobRefRow,
} from "../dto/mappers.ts";
import { ApiError } from "../http/errors.ts";
import { resourceNotFound } from "../http/validation.ts";

const editionInclude = {
  currentScriptVersion: { select: { id: true, versionNumber: true, createdAt: true } },
} as const;

async function latestRenderJobsByEdition(
  prisma: PrismaClient,
  editionIds: readonly string[],
): Promise<Map<string, RenderJobRefRow>> {
  const latestJobs = new Map<string, RenderJobRefRow>();
  if (editionIds.length === 0) {
    return latestJobs;
  }
  const jobs = await prisma.job.findMany({
    where: { kind: "render", languageEditionId: { in: [...editionIds] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, finishedAt: true, languageEditionId: true },
  });
  for (const job of jobs) {
    const editionId = job.languageEditionId;
    if (editionId !== null && !latestJobs.has(editionId)) {
      latestJobs.set(editionId, { id: job.id, status: job.status, finishedAt: job.finishedAt });
    }
  }
  return latestJobs;
}

export async function listWorks(prisma: PrismaClient): Promise<WorkSummary[]> {
  const works = await prisma.work.findMany({
    orderBy: { updatedAt: "desc" },
    include: { languageEditions: { include: editionInclude } },
  });
  const editionIds = works.flatMap((work) => work.languageEditions.map((edition) => edition.id));
  const latestJobs = await latestRenderJobsByEdition(prisma, editionIds);
  return works.map((work) =>
    toWorkSummary(work, work.languageEditions as EditionWithCurrent[], latestJobs),
  );
}

export async function getWork(prisma: PrismaClient, workId: string): Promise<Work> {
  const work = await prisma.work.findUnique({
    where: { id: workId },
    include: { languageEditions: { include: editionInclude } },
  });
  if (work === null) {
    throw resourceNotFound("work", workId);
  }
  const latestJobs = await latestRenderJobsByEdition(
    prisma,
    work.languageEditions.map((edition) => edition.id),
  );
  return toWork(work, work.languageEditions as EditionWithCurrent[], latestJobs);
}

export async function createWork(
  prisma: PrismaClient,
  title: string,
  originalLocale: string,
): Promise<Work> {
  const contentJson = serializeContent(createInitialContentDocument());
  const workId = await prisma.$transaction(async (tx) => {
    const work = await tx.work.create({ data: { title, originalLocale } });
    const edition = await tx.languageEdition.create({
      data: { workId: work.id, locale: originalLocale },
    });
    const script = await tx.scriptVersion.create({
      data: {
        languageEditionId: edition.id,
        versionNumber: 1,
        contentSchemaVersion: CONTENT_SCHEMA_VERSION,
        contentJson,
      },
    });
    await tx.languageEdition.update({
      where: { id: edition.id },
      data: { currentScriptVersionId: script.id },
    });
    return work.id;
  });
  return getWork(prisma, workId);
}

export async function updateWork(
  prisma: PrismaClient,
  workId: string,
  title: string,
): Promise<Work> {
  const existing = await prisma.work.findUnique({ where: { id: workId }, select: { id: true } });
  if (existing === null) {
    throw resourceNotFound("work", workId);
  }
  await prisma.work.update({ where: { id: workId }, data: { title } });
  return getWork(prisma, workId);
}

export async function deleteWork(
  prisma: PrismaClient,
  directories: DataDirectories,
  workId: string,
): Promise<void> {
  const work = await prisma.work.findUnique({ where: { id: workId }, select: { id: true } });
  if (work === null) {
    throw resourceNotFound("work", workId);
  }
  const children = await prisma.work.findMany({
    where: { parentWorkId: workId },
    select: { id: true },
  });
  if (children.length > 0) {
    throw new ApiError(409, "WORK_HAS_CHILDREN", undefined, {
      workId,
      childWorkIds: children.map((child) => child.id),
    });
  }

  const artifactKeys = await prisma.$transaction(async (tx) => {
    const editions = await tx.languageEdition.findMany({
      where: { workId },
      select: { id: true },
    });
    const editionIds = editions.map((edition) => edition.id);

    const versions = await tx.scriptVersion.findMany({
      where: { languageEditionId: { in: editionIds } },
      select: { id: true },
    });
    const versionIds = versions.map((version) => version.id);

    const jobs = await tx.job.findMany({
      where: {
        OR: [
          { workId },
          { languageEditionId: { in: editionIds } },
          { scriptVersionId: { in: versionIds } },
        ],
      },
      select: { id: true },
    });
    const jobIds = jobs.map((job) => job.id);
    let removedArtifactKeys: string[] = [];
    if (jobIds.length > 0) {
      const artifactRows = await tx.artifact.findMany({
        where: { jobId: { in: jobIds } },
        select: { storageKey: true },
      });
      removedArtifactKeys = artifactRows.map((artifact) => artifact.storageKey);
      await tx.artifact.deleteMany({ where: { jobId: { in: jobIds } } });
      await tx.asset.updateMany({
        where: { generatedByJobId: { in: jobIds } },
        data: { generatedByJobId: null },
      });
      await tx.job.deleteMany({ where: { id: { in: jobIds } } });
    }

    await tx.languageEdition.updateMany({
      where: { workId },
      data: { currentScriptVersionId: null },
    });
    await tx.scriptVersion.updateMany({
      where: { languageEditionId: { in: editionIds } },
      data: { sourceScriptVersionId: null },
    });
    await tx.scriptVersion.deleteMany({ where: { languageEditionId: { in: editionIds } } });
    await tx.languageEdition.deleteMany({ where: { workId } });
    await tx.work.delete({ where: { id: workId } });
    return removedArtifactKeys;
  });

  await Promise.allSettled(
    artifactKeys.map((storageKey) =>
      removeStorageFile(directories, storageKey).catch((error: unknown) => {
        logger.warn("artifact_file_cleanup_failed", {
          storageKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }),
    ),
  );
}
