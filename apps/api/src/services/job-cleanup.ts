import type { Prisma } from "../generated/prisma/client.ts";
import { logger } from "../logger.ts";
import { removeStorageFile } from "../storage/asset-store.ts";
import type { DataDirectories } from "../storage/paths.ts";

/**
 * Deletes Jobs and their Artifacts inside the caller's transaction, and returns
 * the Artifact storage keys so the files can be removed after the commit.
 * Generated Assets stay in the library; only their generating Job reference is
 * cleared.
 */
export async function deleteJobsAndArtifacts(
  tx: Prisma.TransactionClient,
  jobIds: readonly string[],
): Promise<string[]> {
  if (jobIds.length === 0) {
    return [];
  }
  const ids = [...jobIds];
  const artifactRows = await tx.artifact.findMany({
    where: { jobId: { in: ids } },
    select: { storageKey: true },
  });
  await tx.artifact.deleteMany({ where: { jobId: { in: ids } } });
  await tx.asset.updateMany({
    where: { generatedByJobId: { in: ids } },
    data: { generatedByJobId: null },
  });
  await tx.job.deleteMany({ where: { id: { in: ids } } });
  return artifactRows.map((artifact) => artifact.storageKey);
}

/** Best-effort file cleanup after the database transaction commits. */
export async function removeArtifactFiles(
  directories: DataDirectories,
  storageKeys: readonly string[],
): Promise<void> {
  await Promise.allSettled(
    storageKeys.map((storageKey) =>
      removeStorageFile(directories, storageKey).catch((error: unknown) => {
        logger.warn("artifact_file_cleanup_failed", {
          storageKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }),
    ),
  );
}
