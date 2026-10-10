import { readdir, rm } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { logger } from "../logger.ts";
import type { DataDirectories } from "../storage/paths.ts";

const WORKER_INTERRUPTED_MESSAGE = "アプリの中断により処理が停止しました。再実行してください。";

export async function recoverInterruptedJobs(prisma: PrismaClient): Promise<number> {
  return prisma.$transaction(async (transaction) => {
    const running = await transaction.job.findMany({
      where: { status: "running" },
      select: { id: true, kind: true, assetId: true },
    });
    if (running.length === 0) {
      return 0;
    }
    await transaction.job.updateMany({
      where: { id: { in: running.map((job) => job.id) } },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorCode: "WORKER_INTERRUPTED",
        errorMessage: WORKER_INTERRUPTED_MESSAGE,
      },
    });
    const assetIds = running
      .filter((job) => job.kind === "asset_ingest" && job.assetId !== null)
      .map((job) => job.assetId as string);
    if (assetIds.length > 0) {
      await transaction.asset.updateMany({
        where: { id: { in: assetIds }, status: "processing" },
        data: { status: "failed" },
      });
    }
    return running.length;
  });
}

export async function cleanTmpDirectory(directories: DataDirectories): Promise<number> {
  const entries = await readdir(directories.tmp).catch(() => [] as string[]);
  let removed = 0;
  for (const entry of entries) {
    const result = await rm(join(directories.tmp, entry), { recursive: true, force: true })
      .then(() => true)
      .catch(() => false);
    if (result) {
      removed += 1;
    }
  }
  return removed;
}

async function collectKnownStorageKeys(prisma: PrismaClient): Promise<Set<string>> {
  const [assets, renditions, artifacts] = await Promise.all([
    prisma.asset.findMany({ select: { storageKey: true } }),
    prisma.assetRendition.findMany({ select: { storageKey: true } }),
    prisma.artifact.findMany({ select: { storageKey: true } }),
  ]);
  const keys = new Set<string>();
  for (const row of [...assets, ...renditions, ...artifacts]) {
    keys.add(row.storageKey);
  }
  return keys;
}

async function walkFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => null);
    if (entries === null) {
      return;
    }
    for (const entry of entries) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  };
  await walk(root);
  return files;
}

export async function removeOrphanFiles(
  prisma: PrismaClient,
  directories: DataDirectories,
): Promise<number> {
  const known = await collectKnownStorageKeys(prisma);
  let removed = 0;
  for (const base of [directories.assets, directories.artifacts]) {
    for (const file of await walkFiles(base)) {
      const storageKey = relative(directories.root, file).split(sep).join("/");
      if (known.has(storageKey)) {
        continue;
      }
      const result = await rm(file, { force: true })
        .then(() => true)
        .catch(() => false);
      if (result) {
        removed += 1;
        logger.info("orphan_file_removed", { storageKey });
      }
    }
  }
  return removed;
}

export async function runStartupMaintenance(
  prisma: PrismaClient,
  directories: DataDirectories,
): Promise<void> {
  const interruptedJobs = await recoverInterruptedJobs(prisma);
  let tmpEntriesRemoved = 0;
  let orphanFilesRemoved = 0;
  try {
    tmpEntriesRemoved = await cleanTmpDirectory(directories);
    orphanFilesRemoved = await removeOrphanFiles(prisma, directories);
  } catch (error) {
    logger.warn("startup_file_cleanup_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  logger.info("startup_maintenance", {
    interruptedJobs,
    tmpEntriesRemoved,
    orphanFilesRemoved,
  });
}
