import {
  CONTENT_SCHEMA_VERSION,
  createInitialContentDocument,
  resolveCharacterName,
  type ContentDocument,
  type ScriptVersionAuthor,
  type Work,
} from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { deserializeContent, serializeContent } from "../domain/content-json.ts";
import type { DataDirectories } from "../storage/paths.ts";
import { deleteJobsAndArtifacts, removeArtifactFiles } from "./job-cleanup.ts";
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
  sourceEditionId: string,
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
  const sourceEdition = work.languageEditions.find(
    (edition) => edition.id === sourceEditionId,
  );
  if (!sourceEdition) {
    throw resourceNotFound("language_edition", sourceEditionId);
  }
  if (!sourceEdition.currentScriptVersion) {
    throw new ApiError(500, "INTERNAL_ERROR", "現在の台本版が設定されていません。");
  }
  const sourceScript = sourceEdition.currentScriptVersion;
  const author = attribution?.author ?? "human";
  const authorAgentId =
    author === "agent" ? normalizeAgentId(attribution?.authorAgentId) : null;

  const newWorkId = await prisma.$transaction(async (tx) => {
    const newWork = await tx.work.create({
      data: {
        title,
        originalLocale: sourceEdition.locale,
        parentWorkId: workId,
      },
    });
    const newEdition = await tx.languageEdition.create({
      data: {
        workId: newWork.id,
        locale: sourceEdition.locale,
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
  const characters = source.characters.map((character) => ({
    ...character,
    name: resolveCharacterName(character, targetLocale),
  }));
  const nameByCharacterId = new Map(characters.map((character) => [character.id, character.name]));
  return {
    ...source,
    locale: targetLocale,
    characters,
    speakers: source.speakers.map((speaker) => {
      const resolved =
        speaker.characterId === null
          ? speaker.name
          : (nameByCharacterId.get(speaker.characterId) ?? speaker.name);
      return { ...speaker, name: resolved, voiceProfileId: null };
    }),
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
    const removedArtifactKeys = await deleteJobsAndArtifacts(
      tx,
      jobs.map((job) => job.id),
    );

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

  await removeArtifactFiles(directories, artifactKeys);
}

/**
 * Deletes one LanguageEdition and its scripts, Jobs, Artifacts and thumbnails.
 * Work.originalLocale is provenance and is never rewritten. The last Edition
 * of a Work cannot be deleted, and a running Job blocks the deletion.
 */
export async function deleteLanguageEdition(
  prisma: PrismaClient,
  directories: DataDirectories,
  editionId: string,
): Promise<void> {
  const edition = await prisma.languageEdition.findUnique({
    where: { id: editionId },
    select: { id: true, workId: true },
  });
  if (edition === null) {
    throw resourceNotFound("language_edition", editionId);
  }
  const artifactKeys = await prisma.$transaction(async (tx) => {
    // Count and Job state are re-read inside the transaction so concurrent
    // deletions cannot remove every Edition or race the worker's Job claim.
    const editionCount = await tx.languageEdition.count({
      where: { workId: edition.workId },
    });
    if (editionCount <= 1) {
      throw new ApiError(409, "LAST_LANGUAGE_EDITION", undefined, {
        workId: edition.workId,
        editionId,
      });
    }

    const versions = await tx.scriptVersion.findMany({
      where: { languageEditionId: editionId },
      select: { id: true },
    });
    const versionIds = versions.map((version) => version.id);
    const jobs = await tx.job.findMany({
      where: {
        OR: [
          { languageEditionId: editionId },
          { scriptVersionId: { in: versionIds } },
        ],
      },
      select: { id: true, status: true },
    });
    // Only a running Job blocks the deletion. Queued Jobs are deleted with the
    // Edition because the user explicitly removed their source scripts.
    const runningJobIds = jobs
      .filter((job) => job.status === "running")
      .map((job) => job.id);
    if (runningJobIds.length > 0) {
      throw new ApiError(409, "LANGUAGE_EDITION_JOB_RUNNING", undefined, {
        editionId,
        jobIds: runningJobIds,
      });
    }

    const removedArtifactKeys = await deleteJobsAndArtifacts(
      tx,
      jobs.map((job) => job.id),
    );
    await tx.languageEdition.update({
      where: { id: editionId },
      data: { currentScriptVersionId: null, primaryThumbnailId: null },
    });
    await tx.scriptVersion.updateMany({
      where: { sourceScriptVersionId: { in: versionIds } },
      data: { sourceScriptVersionId: null },
    });
    await tx.scriptVersion.deleteMany({
      where: { languageEditionId: editionId },
    });
    await tx.thumbnail.deleteMany({ where: { languageEditionId: editionId } });
    await tx.languageEdition.delete({ where: { id: editionId } });
    await tx.work.update({
      where: { id: edition.workId },
      data: { updatedAt: new Date() },
    });
    return removedArtifactKeys;
  });

  await removeArtifactFiles(directories, artifactKeys);
}
