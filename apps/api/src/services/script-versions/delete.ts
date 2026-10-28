import type { PrismaClient } from "../../generated/prisma/client.ts";
import { logger } from "../../logger.ts";
import type { DataDirectories } from "../../storage/paths.ts";
import { ApiError } from "../../http/errors.ts";
import { validationError } from "../../http/validation.ts";
import { deleteJobsAndArtifacts, removeArtifactFiles } from "../job-cleanup.ts";
import { requireEdition } from "./common.ts";

/**
 * Deletes selected past ScriptVersions of one Edition. Every id is validated
 * before anything is written, so a rejected request deletes nothing. Version
 * numbers are never renumbered.
 */
export async function deleteScriptVersions(
  prisma: PrismaClient,
  directories: DataDirectories,
  editionId: string,
  scriptVersionIds: readonly string[],
): Promise<void> {
  const edition = await requireEdition(prisma, editionId);
  const ids = [...scriptVersionIds];
  if (ids.length === 0) {
    throw validationError([
      {
        path: ["scriptVersionIds"],
        code: "too_small",
        message: "削除する版を1件以上指定してください。",
      },
    ]);
  }
  if (ids.length > 100) {
    throw validationError([
      {
        path: ["scriptVersionIds"],
        code: "too_big",
        message: "一度に削除できる版は100件までです。",
      },
    ]);
  }
  if (new Set(ids).size !== ids.length) {
    throw validationError([
      {
        path: ["scriptVersionIds"],
        code: "invalid_value",
        message: "scriptVersionIds に重複したIDを含めないでください。",
      },
    ]);
  }

  const versions = await prisma.scriptVersion.findMany({
    where: { id: { in: ids } },
    select: { id: true, languageEditionId: true },
  });
  const versionById = new Map(versions.map((version) => [version.id, version]));
  const invalidIds = ids.filter((id) => {
    const version = versionById.get(id);
    return version === undefined || version.languageEditionId !== editionId;
  });
  if (invalidIds.length > 0) {
    throw validationError([
      {
        path: ["scriptVersionIds"],
        code: "invalid_value",
        message: `この言語版に属する版が見つかりません: ${invalidIds.join(", ")}`,
      },
    ]);
  }

  const artifactKeys = await prisma.$transaction(async (tx) => {
    // Read the current pointer and Jobs inside the transaction so a concurrent
    // save or worker claim cannot slip through the guards below.
    const currentEdition = await tx.languageEdition.findUnique({
      where: { id: editionId },
      select: { currentScriptVersionId: true },
    });
    if (
      currentEdition !== null &&
      currentEdition.currentScriptVersionId !== null &&
      ids.includes(currentEdition.currentScriptVersionId)
    ) {
      throw new ApiError(409, "CURRENT_SCRIPT_VERSION_DELETE", undefined, {
        editionId,
        currentScriptVersionId: currentEdition.currentScriptVersionId,
      });
    }

    const jobs = await tx.job.findMany({
      where: { scriptVersionId: { in: ids } },
      select: { id: true, status: true },
    });
    const runningJobIds = jobs
      .filter((job) => job.status === "running")
      .map((job) => job.id);
    if (runningJobIds.length > 0) {
      throw new ApiError(409, "SCRIPT_VERSION_JOB_RUNNING", undefined, {
        editionId,
        jobIds: runningJobIds,
      });
    }

    const removedArtifactKeys = await deleteJobsAndArtifacts(
      tx,
      jobs.map((job) => job.id),
    );
    await tx.scriptVersion.updateMany({
      where: { sourceScriptVersionId: { in: ids } },
      data: { sourceScriptVersionId: null },
    });
    await tx.scriptVersion.deleteMany({
      where: { languageEditionId: editionId, id: { in: ids } },
    });
    await tx.languageEdition.update({
      where: { id: editionId },
      data: { updatedAt: new Date() },
    });
    await tx.work.update({
      where: { id: edition.workId },
      data: { updatedAt: new Date() },
    });
    return removedArtifactKeys;
  });

  await removeArtifactFiles(directories, artifactKeys);
  if (artifactKeys.length > 0) {
    logger.info("script_version_artifacts_removed", {
      editionId,
      artifactCount: artifactKeys.length,
    });
  }
}
