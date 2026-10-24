import {
  CONTENT_SCHEMA_VERSION,
  createInitialContentDocument,
  type ContentDocument,
  type ScriptVersionAuthor,
  type Work,
} from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { deserializeContent, serializeContent } from "../domain/content-json.ts";
import { logger } from "../logger.ts";
import { removeStorageFile } from "../storage/asset-store.ts";
import type { DataDirectories } from "../storage/paths.ts";
import {
  toWork,
  type EditionWithCurrent,
  type RenderJobRefRow,
} from "../dto/mappers.ts";
import { normalizeAgentId } from "./attribution.ts";
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

export async function listWorks(prisma: PrismaClient): Promise<Work[]> {
  const works = await prisma.work.findMany({
    orderBy: { updatedAt: "desc" },
    include: { languageEditions: { include: editionInclude } },
  });
  const editionIds = works.flatMap((work) => work.languageEditions.map((edition) => edition.id));
  const latestJobs = await latestRenderJobsByEdition(prisma, editionIds);
  return works.map((work) =>
    toWork(work, work.languageEditions as EditionWithCurrent[], latestJobs),
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
  originalLocale: ContentDocument["locale"],
): Promise<Work> {
  const contentJson = serializeContent(createInitialContentDocument(originalLocale));
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
        author: "human",
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

export interface CloneWorkAttribution {
  author?: ScriptVersionAuthor;
  authorAgentId?: string | null;
}

export async function cloneWork(
  prisma: PrismaClient,
  workId: string,
  title: string,
  attribution?: CloneWorkAttribution,
): Promise<Work> {
  const work = await prisma.work.findUnique({
    where: { id: workId },
    include: {
      languageEditions: {
        include: {
          currentScriptVersion: true,
        },
      },
    },
  });
  if (work === null) {
    throw resourceNotFound("work", workId);
  }
  const primaryEdition =
    work.languageEditions.find((edition) => edition.locale === work.originalLocale) ??
    work.languageEditions[0];
  if (!primaryEdition) {
    throw resourceNotFound("work", workId);
  }
  if (!primaryEdition.currentScriptVersion) {
    throw new ApiError(500, "INTERNAL_ERROR", "現在の台本版が設定されていません。");
  }
  const sourceScript = primaryEdition.currentScriptVersion;
  const author = attribution?.author ?? "human";
  const authorAgentId =
    author === "agent" ? normalizeAgentId(attribution?.authorAgentId) : null;

  const newWorkId = await prisma.$transaction(async (tx) => {
    const newWork = await tx.work.create({
      data: {
        title,
        originalLocale: work.originalLocale,
        parentWorkId: workId,
      },
    });
    const newEdition = await tx.languageEdition.create({
      data: {
        workId: newWork.id,
        locale: primaryEdition.locale,
      },
    });
    const newScript = await tx.scriptVersion.create({
      data: {
        languageEditionId: newEdition.id,
        versionNumber: 1,
        contentSchemaVersion: sourceScript.contentSchemaVersion,
        contentJson: sourceScript.contentJson,
        sourceScriptVersionId: sourceScript.id,
        author,
        authorAgentId,
      },
    });
    await tx.languageEdition.update({
      where: { id: newEdition.id },
      data: { currentScriptVersionId: newScript.id },
    });
    return newWork.id;
  });

  return getWork(prisma, newWorkId);
}

export function buildLanguageEditionSeedDocument(
  source: ContentDocument,
  targetLocale: ContentDocument["locale"],
): ContentDocument {
  return {
    ...source,
    locale: targetLocale,
    speakers: source.speakers.map((speaker) => ({ ...speaker, voiceProfileId: null })),
    audioTakes: [],
    scenes: source.scenes.map((scene) => ({
      ...scene,
      lines: scene.lines.map((line) => ({ ...line, selectedAudioTakeId: null })),
    })),
  };
}

export async function createLanguageEdition(
  prisma: PrismaClient,
  workId: string,
  locale: ContentDocument["locale"],
  sourceEditionId: string,
): Promise<Work> {
  const work = await prisma.work.findUnique({
    where: { id: workId },
    include: { languageEditions: { select: { id: true, locale: true } } },
  });
  if (work === null) {
    throw resourceNotFound("work", workId);
  }
  const sourceEdition = await prisma.languageEdition.findUnique({
    where: { id: sourceEditionId },
    include: { currentScriptVersion: true },
  });
  if (sourceEdition === null || sourceEdition.workId !== workId) {
    throw resourceNotFound("language_edition", sourceEditionId);
  }
  if (sourceEdition.currentScriptVersion === null) {
    throw new ApiError(500, "INTERNAL_ERROR", "現在の台本版が設定されていません。");
  }
  if (work.languageEditions.some((edition) => edition.locale === locale)) {
    throw new ApiError(409, "LANGUAGE_EDITION_EXISTS", undefined, { workId, locale });
  }

  const sourceContent = deserializeContent(sourceEdition.currentScriptVersion.contentJson);
  const seeded = buildLanguageEditionSeedDocument(sourceContent, locale);
  const contentJson = serializeContent(seeded);
  const sourceScriptVersionId = sourceEdition.currentScriptVersion.id;

  try {
    await prisma.$transaction(async (tx) => {
      const edition = await tx.languageEdition.create({
        data: { workId, locale },
      });
      const script = await tx.scriptVersion.create({
        data: {
          languageEditionId: edition.id,
          versionNumber: 1,
          contentSchemaVersion: seeded.schemaVersion,
          contentJson,
          sourceScriptVersionId,
          author: "human",
        },
      });
      await tx.languageEdition.update({
        where: { id: edition.id },
        data: { currentScriptVersionId: script.id },
      });
    });
  } catch (error) {
    if (isPrismaCode(error, "P2002")) {
      throw new ApiError(409, "LANGUAGE_EDITION_EXISTS", undefined, { workId, locale });
    }
    throw error;
  }
  return getWork(prisma, workId);
}

function isPrismaCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === code
  );
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
    await tx.languageEdition.updateMany({
      where: { workId },
      data: { primaryThumbnailId: null },
    });
    await tx.thumbnail.deleteMany({ where: { languageEditionId: { in: editionIds } } });
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
