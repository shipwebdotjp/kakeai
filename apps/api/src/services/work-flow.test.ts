import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInitialContentDocument, createPointScene } from "@kakeai/contracts";
import { loadConfig } from "../config.ts";
import { createPrismaClient } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { applySqlitePragmas } from "../db/pragmas.ts";
import { ensureDataDirectories, type DataDirectories } from "../storage/paths.ts";
import * as scriptVersions from "./script-versions.ts";
import * as works from "./works.ts";

let dataDir: string;
let directories: DataDirectories;
let prisma: ReturnType<typeof createPrismaClient>;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-work-"));
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

describe("work and script version flow", () => {
  it("creates a work with an initial v1 script version", async () => {
    const work = await works.createWork(prisma, "テスト作品", "ja-JP");
    expect(work.languageEditions).toHaveLength(1);
    const edition = work.languageEditions[0]!;
    const current = await scriptVersions.getCurrentScriptVersion(prisma, edition.id);
    expect(current.versionNumber).toBe(1);
    expect(current.content.template).toEqual({ id: "explanation-scenes", version: 1 });
    expect(current.content.scenes.map((scene) => scene.kind)).toEqual([
      "intro",
      "point",
      "point",
      "point",
      "outro",
    ]);
  });

  it("saves documents with zero or many point scenes", async () => {
    const work = await works.createWork(prisma, "可変シーン", "ja-JP");
    const edition = work.languageEditions[0]!;

    const zeroPoints = createInitialContentDocument();
    zeroPoints.scenes = zeroPoints.scenes.filter((scene) => scene.kind !== "point");
    const savedZero = await scriptVersions.saveScriptVersion(prisma, edition.id, {
      sourceScriptVersionId: null,
      content: zeroPoints,
    });
    expect(savedZero.scriptVersion.content.scenes.map((scene) => scene.kind)).toEqual([
      "intro",
      "outro",
    ]);

    const manyPoints = createInitialContentDocument();
    for (const id of ["scene-point-9", "scene-point-10"]) {
      manyPoints.scenes.splice(manyPoints.scenes.length - 1, 0, createPointScene(id));
    }
    const savedMany = await scriptVersions.saveScriptVersion(prisma, edition.id, {
      sourceScriptVersionId: null,
      content: manyPoints,
    });
    expect(savedMany.scriptVersion.content.scenes.filter((scene) => scene.kind === "point")).toHaveLength(5);
  });

  it("saves a new immutable version and advances current", async () => {
    const work = await works.createWork(prisma, "保存テスト", "ja-JP");
    const edition = work.languageEditions[0]!;
    const content = createInitialContentDocument();
    const point = content.scenes[1]!;
    if (point.kind !== "point") {
      throw new Error("expected a point scene");
    }
    point.slots.heading = "見出し";

    const saved = await scriptVersions.saveScriptVersion(prisma, edition.id, {
      sourceScriptVersionId: null,
      content,
    });
    expect(saved.scriptVersion.versionNumber).toBe(2);
    expect(saved.warnings).toEqual([]);

    const current = await scriptVersions.getCurrentScriptVersion(prisma, edition.id);
    expect(current.versionNumber).toBe(2);
    const list = await scriptVersions.listScriptVersions(prisma, edition.id);
    expect(list.map((version) => version.versionNumber)).toEqual([2, 1]);
  });

  it("returns warnings but still saves overflowing text", async () => {
    const work = await works.createWork(prisma, "警告テスト", "ja-JP");
    const edition = work.languageEditions[0]!;
    const content = createInitialContentDocument();
    const point = content.scenes[1]!;
    if (point.kind !== "point") {
      throw new Error("expected a point scene");
    }
    point.slots.body = "あ".repeat(200);

    const saved = await scriptVersions.saveScriptVersion(prisma, edition.id, {
      sourceScriptVersionId: null,
      content,
    });
    expect(saved.warnings).toHaveLength(1);
    expect(saved.scriptVersion.content.scenes[1]).toMatchObject({ slots: { body: point.slots.body } });
  });

  it("rejects a document that references a missing asset", async () => {
    const work = await works.createWork(prisma, "素材テスト", "ja-JP");
    const edition = work.languageEditions[0]!;
    const content = createInitialContentDocument();
    content.scenes[0]!.visualCues = [
      {
        id: "vc-missing",
        template: { id: "media.full-bleed", version: 1 },
        range: { kind: "scene" },
        input: { assetId: "asset-missing", fit: "cover" },
      },
    ];
    await expect(
      scriptVersions.saveScriptVersion(prisma, edition.id, {
        sourceScriptVersionId: null,
        content,
      }),
    ).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });
  });

  it("deletes a work and removes its artifact files", async () => {
    const work = await works.createWork(prisma, "削除テスト", "ja-JP");
    const edition = work.languageEditions[0]!;
    const current = await scriptVersions.getCurrentScriptVersion(prisma, edition.id);
    const job = await prisma.job.create({
      data: {
        kind: "render",
        status: "succeeded",
        workId: work.id,
        languageEditionId: edition.id,
        scriptVersionId: current.id,
        snapshotSchemaVersion: 1,
        inputSnapshotJson: "{}",
        progressPercent: 100,
        finishedAt: new Date(),
      },
    });
    const storageKey = `artifacts/${job.id}-deadbeef.mp4`;
    const artifactPath = join(dataDir, storageKey);
    await writeFile(artifactPath, "fake-mp4");
    const artifact = await prisma.artifact.create({
      data: {
        jobId: job.id,
        role: "render",
        format: "mp4",
        storageKey,
        sha256: "deadbeef",
        byteSize: BigInt(8),
      },
    });

    await works.deleteWork(prisma, directories, work.id);

    await expect(works.getWork(prisma, work.id)).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
    });
    await expect(stat(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(prisma.artifact.findUnique({ where: { id: artifact.id } })).resolves.toBeNull();
  });
});
