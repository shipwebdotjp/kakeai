import { rm } from "node:fs/promises";
import { contentDocumentSchema, renderJobSnapshotSchema } from "@kakeai/contracts";
import type { Prisma } from "../../generated/prisma/client.ts";
import { ApiError } from "../../http/errors.ts";
import { logger } from "../../logger.ts";
import { resolveStoragePath } from "../../storage/asset-store.ts";
import type { DataDirectories } from "../../storage/paths.ts";
import { collectCompositionVersionIds } from "./validate";

const REFERENCE_QUERY_BATCH = 50;

function batch<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function referencedCompositionsError(workId: string): ApiError {
  return new ApiError(
    409,
    "WORK_HAS_REFERENCED_COMPOSITIONS",
    undefined,
    { workId },
  );
}

function parseReferencedJson(
  json: string,
  workId: string,
  label: string,
): unknown {
  try {
    return JSON.parse(json);
  } catch {
    logger.warn("work_cleanup_unparsable_reference", { workId, label });
    throw referencedCompositionsError(workId);
  }
}

/**
 * Collects CompositionVersion IDs referenced by ScriptVersions and render Job
 * snapshots that do not belong to `workId`. Work deletion may only remove the
 * owning Work's Compositions, so any hit here would leave a dangling reference.
 *
 * Candidate rows are pre-filtered by the owned version IDs in batches. A row
 * that matches the prefilter but cannot be parsed fails closed: deleting with
 * an unknown reference could break another Work.
 */
async function collectOtherWorkCompositionRefs(
  tx: Prisma.TransactionClient,
  workId: string,
  ownedVersionIds: ReadonlySet<string>,
): Promise<Set<string>> {
  const ids = new Set<string>();
  const batches = batch([...ownedVersionIds], REFERENCE_QUERY_BATCH);

  for (const versionIds of batches) {
    const scripts = await tx.scriptVersion.findMany({
      where: {
        languageEdition: { workId: { not: workId } },
        OR: versionIds.map((versionId) => ({
          contentJson: { contains: versionId },
        })),
      },
      select: { contentJson: true },
    });
    for (const script of scripts) {
      const raw = parseReferencedJson(script.contentJson, workId, "script");
      const parsed = contentDocumentSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn("work_cleanup_invalid_script", { workId });
        throw referencedCompositionsError(workId);
      }
      for (const versionId of collectCompositionVersionIds(parsed.data)) {
        ids.add(versionId);
      }
    }

    const jobs = await tx.job.findMany({
      where: {
        kind: "render",
        workId: { not: workId },
        OR: versionIds.map((versionId) => ({
          inputSnapshotJson: { contains: versionId },
        })),
      },
      select: { inputSnapshotJson: true },
    });
    for (const job of jobs) {
      const raw = parseReferencedJson(
        job.inputSnapshotJson,
        workId,
        "render_job",
      );
      const parsed = renderJobSnapshotSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn("work_cleanup_invalid_render_job", { workId });
        throw referencedCompositionsError(workId);
      }
      for (const version of parsed.data.compositionVersions) {
        ids.add(version.id);
      }
      for (const versionId of collectCompositionVersionIds(
        parsed.data.content,
      )) {
        ids.add(versionId);
      }
    }
  }

  return ids;
}

/**
 * Deletes Compositions owned by a Work inside the caller's transaction and
 * returns their draft/version storage keys. Shared and unclassified
 * Compositions are left untouched. Throws 409 when another Work still
 * references one of the owned CompositionVersions.
 */
export async function deleteWorkOwnedCompositions(
  tx: Prisma.TransactionClient,
  workId: string,
): Promise<string[]> {
  const owned = await tx.composition.findMany({
    where: { scope: "work", workId },
    select: {
      id: true,
      draft: { select: { storageKey: true } },
      versions: { select: { id: true, storageKey: true } },
    },
  });
  if (owned.length === 0) {
    return [];
  }

  const ownedVersionIds = new Set(
    owned.flatMap((composition) => composition.versions.map((version) => version.id)),
  );
  if (ownedVersionIds.size > 0) {
    const otherRefs = await collectOtherWorkCompositionRefs(
      tx,
      workId,
      ownedVersionIds,
    );
    const conflicts = new Set(
      [...ownedVersionIds].filter((versionId) => otherRefs.has(versionId)),
    );
    if (conflicts.size > 0) {
      const compositionIds = owned
        .filter((composition) =>
          composition.versions.some((version) => conflicts.has(version.id)),
        )
        .map((composition) => composition.id);
      throw new ApiError(409, "WORK_HAS_REFERENCED_COMPOSITIONS", undefined, {
        workId,
        compositionIds,
      });
    }
  }

  const storageKeys = owned.flatMap((composition) => [
    ...(composition.draft === null ? [] : [composition.draft.storageKey]),
    ...composition.versions.map((version) => version.storageKey),
  ]);
  const compositionIds = owned.map((composition) => composition.id);

  await tx.compositionDraft.deleteMany({
    where: { compositionId: { in: compositionIds } },
  });
  await tx.compositionVersion.deleteMany({
    where: { compositionId: { in: compositionIds } },
  });
  await tx.composition.deleteMany({ where: { id: { in: compositionIds } } });

  return storageKeys;
}

/** Best-effort removal of draft and bundle directories after the commit. */
export async function removeCompositionStorageDirs(
  directories: DataDirectories,
  storageKeys: readonly string[],
): Promise<void> {
  const keys = storageKeys.filter((storageKey) => storageKey.trim().length > 0);
  const results = await Promise.allSettled(
    keys.map(async (storageKey) =>
      rm(resolveStoragePath(directories, storageKey), {
        recursive: true,
        force: true,
      }),
    ),
  );
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      logger.warn("composition_storage_cleanup_failed", {
        storageKey: keys[index],
        error:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      });
    }
  }
}
