import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config.ts";
import { createPrismaClient } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { applySqlitePragmas } from "../db/pragmas.ts";
import { ensureDataDirectories, type DataDirectories } from "../storage/paths.ts";
import {
  cleanTmpDirectory,
  recoverInterruptedJobs,
  removeOrphanFiles,
} from "./lifecycle.ts";
import * as works from "./works.ts";

let dataDir: string;
let directories: DataDirectories;
let prisma: ReturnType<typeof createPrismaClient>;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-lifecycle-"));
  process.env.KAKEAI_DATA_DIR = dataDir;
  const config = loadConfig();
  directories = config.directories;
  await ensureDataDirectories(config.directories);
  await runMigrations();
  prisma = createPrismaClient(config.databaseUrl);
  await applySqlitePragmas(prisma);
}, 30000);

afterAll(async () => {
  await prisma.$disconnect();
  delete process.env.KAKEAI_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe("recoverInterruptedJobs", () => {
  it("fails running jobs with WORKER_INTERRUPTED and fails their assets", async () => {
    const work = await works.createWork(prisma, "中断テスト", "ja-JP");
    const edition = work.languageEditions[0]!;
    const renderJob = await prisma.job.create({
      data: {
        kind: "render",
        status: "running",
        workId: work.id,
        languageEditionId: edition.id,
        snapshotSchemaVersion: 1,
        inputSnapshotJson: "{}",
        startedAt: new Date(),
      },
    });
    const asset = await prisma.asset.create({
      data: {
        kind: "image",
        origin: "uploaded",
        status: "processing",
        storageKey: "assets/lifecycle-interrupted",
        originalFilename: "interrupted.png",
        mediaType: "image/png",
        byteSize: BigInt(10),
        sha256: "lifecycle-interrupted-sha",
      },
    });
    const ingestJob = await prisma.job.create({
      data: {
        kind: "asset_ingest",
        status: "running",
        assetId: asset.id,
        snapshotSchemaVersion: 1,
        inputSnapshotJson: "{}",
        startedAt: new Date(),
      },
    });

    const recovered = await recoverInterruptedJobs(prisma);
    expect(recovered).toBeGreaterThanOrEqual(2);

    const renderRow = await prisma.job.findUniqueOrThrow({ where: { id: renderJob.id } });
    expect(renderRow.status).toBe("failed");
    expect(renderRow.errorCode).toBe("WORKER_INTERRUPTED");
    expect(renderRow.finishedAt).not.toBeNull();

    const ingestRow = await prisma.job.findUniqueOrThrow({ where: { id: ingestJob.id } });
    expect(ingestRow.status).toBe("failed");
    expect(ingestRow.errorCode).toBe("WORKER_INTERRUPTED");

    const assetRow = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(assetRow.status).toBe("failed");
  });
});

describe("cleanTmpDirectory", () => {
  it("removes leftover files in tmp", async () => {
    await writeFile(join(directories.tmp, "render-project"), "leftover");
    await writeFile(join(directories.tmp, "asset-trash-1"), "leftover");

    const removed = await cleanTmpDirectory(directories);
    expect(removed).toBeGreaterThanOrEqual(1);

    await expect(stat(join(directories.tmp, "render-project"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(stat(join(directories.tmp, "asset-trash-1"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe("removeOrphanFiles", () => {
  it("removes unreferenced files and keeps referenced ones", async () => {
    const asset = await prisma.asset.create({
      data: {
        kind: "image",
        origin: "uploaded",
        status: "ready",
        storageKey: "assets/lifecycle-kept",
        originalFilename: "kept.png",
        mediaType: "image/png",
        byteSize: BigInt(4),
        sha256: "lifecycle-kept-sha",
      },
    });
    const job = await prisma.job.create({
      data: {
        kind: "asset_ingest",
        status: "succeeded",
        assetId: asset.id,
        snapshotSchemaVersion: 1,
        inputSnapshotJson: "{}",
      },
    });
    const artifact = await prisma.artifact.create({
      data: {
        jobId: job.id,
        role: "render",
        format: "mp4",
        storageKey: "artifacts/lifecycle-kept.mp4",
        sha256: "lifecycle-artifact-sha",
        byteSize: BigInt(4),
      },
    });

    const keptAssetPath = join(directories.root, asset.storageKey);
    const keptArtifactPath = join(directories.root, artifact.storageKey);
    const orphanAssetPath = join(directories.assets, "lifecycle-orphan");
    const orphanArtifactPath = join(directories.artifacts, "lifecycle-orphan.mp4");
    await writeFile(keptAssetPath, "kept");
    await writeFile(keptArtifactPath, "kept");
    await writeFile(orphanAssetPath, "orphan");
    await writeFile(orphanArtifactPath, "orphan");

    const removed = await removeOrphanFiles(prisma, directories);
    expect(removed).toBeGreaterThanOrEqual(2);

    await expect(stat(keptAssetPath)).resolves.toBeDefined();
    await expect(stat(keptArtifactPath)).resolves.toBeDefined();
    await expect(stat(orphanAssetPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(orphanArtifactPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
