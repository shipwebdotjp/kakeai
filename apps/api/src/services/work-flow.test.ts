import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SNAPSHOT_SCHEMA_VERSION,
  createInitialContentDocument,
  createInsertScene,
  createPointScene,
} from "@kakeai/contracts";
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
    expect(current.author).toBe("human");
    expect(current.content.template).toEqual({ id: "explanation-scenes", version: 1 });
    expect(current.content.scenes.map((scene) => scene.kind)).toEqual([
      "intro",
      "point",
      "outro",
    ]);
    expect(current.content.scenes.map((scene) => scene.label)).toEqual([
      "導入",
      "要点 1",
      "結び",
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
    for (const [id, label] of [
      ["scene-point-9", "要点 2"],
      ["scene-point-10", "要点 3"],
    ] as const) {
      manyPoints.scenes.splice(manyPoints.scenes.length - 1, 0, createPointScene(id, label));
    }
    const savedMany = await scriptVersions.saveScriptVersion(prisma, edition.id, {
      sourceScriptVersionId: null,
      content: manyPoints,
    });
    expect(savedMany.scriptVersion.content.scenes.filter((scene) => scene.kind === "point")).toHaveLength(3);
  });

  it("saves a new immutable version and advances current", async () => {
    const work = await works.createWork(prisma, "保存テスト", "ja-JP");
    const edition = work.languageEditions[0]!;
    const content = createInitialContentDocument();
    const point = content.scenes[1]!;
    const headingCue = point.visualCues.find(
      (cue) => (cue.input as { role?: string }).role === "heading",
    )!;
    (headingCue.input as { text: string }).text = "見出し";

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

  it("records attribution and enforces request ids per edition", async () => {
    const work = await works.createWork(prisma, "帰属テスト", "ja-JP");
    const edition = work.languageEditions[0]!;
    const content = createInitialContentDocument();

    const human = await scriptVersions.saveScriptVersion(prisma, edition.id, {
      sourceScriptVersionId: null,
      content,
    });
    expect(human.scriptVersion).toMatchObject({
      author: "human",
      authorAgentId: null,
      agentRequestId: null,
      agentRequestHash: null,
    });

    const agent = await scriptVersions.saveScriptVersion(
      prisma,
      edition.id,
      { sourceScriptVersionId: null, content },
      {
        author: "agent",
        authorAgentId: "agent-1",
        agentRequestId: "edit-1",
        agentRequestHash: "hash-1",
      },
    );
    expect(agent.scriptVersion).toMatchObject({
      author: "agent",
      authorAgentId: "agent-1",
      agentRequestId: "edit-1",
      agentRequestHash: "hash-1",
    });

    const read = await scriptVersions.getScriptVersion(prisma, agent.scriptVersion.id);
    expect(read).toMatchObject({
      id: agent.scriptVersion.id,
      author: "agent",
      authorAgentId: "agent-1",
      agentRequestId: "edit-1",
      agentRequestHash: "hash-1",
    });
    const listed = await scriptVersions.listScriptVersions(prisma, edition.id);
    expect(listed.find((version) => version.id === agent.scriptVersion.id)).toMatchObject({
      author: "agent",
      agentRequestId: "edit-1",
    });

    const anonymous = await scriptVersions.saveScriptVersion(
      prisma,
      edition.id,
      { sourceScriptVersionId: null, content },
      { author: "agent", authorAgentId: "   ", agentRequestId: "edit-2" },
    );
    expect(anonymous.scriptVersion.authorAgentId).toBeNull();

    await expect(
      scriptVersions.saveScriptVersion(
        prisma,
        edition.id,
        { sourceScriptVersionId: null, content },
        {
          author: "agent",
          agentRequestId: "edit-1",
          agentRequestHash: "different-hash",
        },
      ),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("returns warnings but still saves overflowing text", async () => {
    const work = await works.createWork(prisma, "警告テスト", "ja-JP");
    const edition = work.languageEditions[0]!;
    const content = createInitialContentDocument();
    const point = content.scenes[1]!;
    const bodyCue = point.visualCues.find(
      (cue) => (cue.input as { role?: string }).role === "body",
    )!;
    const bodyText = "あ".repeat(200);
    (bodyCue.input as { text: string }).text = bodyText;

    const saved = await scriptVersions.saveScriptVersion(prisma, edition.id, {
      sourceScriptVersionId: null,
      content,
    });
    expect(saved.warnings).toHaveLength(1);
    expect(saved.scriptVersion.content.scenes[1]).toMatchObject({
      visualCues: expect.arrayContaining([
        expect.objectContaining({ input: expect.objectContaining({ text: bodyText, role: "body" }) }),
      ]),
    });
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
        layer: "background",
        order: 0,
        transition: {
          enter: { preset: "none", durationMs: 0 },
          exit: { preset: "none", durationMs: 0 },
        },
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

  it("clones a work, creates child work with parentWorkId, copies content, and enforces parent deletion restriction", async () => {
    const parentWork = await works.createWork(prisma, "親作品", "ja-JP");
    const parentEdition = parentWork.languageEditions[0]!;

    // Modify parent's current version so we can verify the content is copied
    const content = createInitialContentDocument();
    content.scenes[0]!.label = "カスタム導入";
    await scriptVersions.saveScriptVersion(prisma, parentEdition.id, {
      sourceScriptVersionId: null,
      content,
    });

    const clonedWork = await works.cloneWork(prisma, parentWork.id, "親作品のコピー");
    expect(clonedWork.title).toBe("親作品のコピー");
    expect(clonedWork.parentWorkId).toBe(parentWork.id);
    expect(clonedWork.languageEditions).toHaveLength(1);

    const clonedEdition = clonedWork.languageEditions[0]!;
    expect(clonedEdition.locale).toBe("ja-JP");
    const clonedCurrent = await scriptVersions.getCurrentScriptVersion(prisma, clonedEdition.id);
    expect(clonedCurrent.versionNumber).toBe(1);
    expect(clonedCurrent.content.scenes[0]!.label).toBe("カスタム導入");

    // Attempting to delete parentWork while cloned child exists should fail with WORK_HAS_CHILDREN
    await expect(works.deleteWork(prisma, directories, parentWork.id)).rejects.toMatchObject({
      code: "WORK_HAS_CHILDREN",
    });

    // Deleting cloned child work should succeed
    await works.deleteWork(prisma, directories, clonedWork.id);

    // Now deleting parent work should succeed
    await works.deleteWork(prisma, directories, parentWork.id);
  });

  it("restores a past version by saving a new version with sourceScriptVersionId", async () => {
    const work = await works.createWork(prisma, "復元テスト", "ja-JP");
    const edition = work.languageEditions[0]!;
    const v1 = await scriptVersions.getCurrentScriptVersion(prisma, edition.id);

    // Create v2 with a change
    const v2Content = createInitialContentDocument();
    v2Content.scenes[0]!.label = "v2導入";
    await scriptVersions.saveScriptVersion(prisma, edition.id, {
      sourceScriptVersionId: null,
      content: v2Content,
    });

    // Restore v1 by saving a new v3 version with v1's content and sourceScriptVersionId set to v1.id
    const v1Full = await scriptVersions.getScriptVersion(prisma, v1.id);
    const restored = await scriptVersions.saveScriptVersion(prisma, edition.id, {
      sourceScriptVersionId: v1.id,
      content: v1Full.content,
    });

    expect(restored.scriptVersion.versionNumber).toBe(3);
    expect(restored.scriptVersion.content.scenes[0]!.label).toBe("導入");

    const current = await scriptVersions.getCurrentScriptVersion(prisma, edition.id);
    expect(current.versionNumber).toBe(3);

    // Check that v1 and v2 still exist unchanged
    const history = await scriptVersions.listScriptVersions(prisma, edition.id);
    expect(history.map((h) => h.versionNumber)).toEqual([3, 2, 1]);
  });

  it("saves an insert scene and validates its duration against the video asset", async () => {
    const work = await works.createWork(prisma, "インサート", "ja-JP");
    const edition = work.languageEditions[0]!;
    const video = await prisma.asset.create({
      data: {
        id: "asset-insert-video",
        kind: "video",
        origin: "uploaded",
        status: "ready",
        storageKey: "assets/insert-video.mp4",
        originalFilename: "insert.mp4",
        mediaType: "video/mp4",
        byteSize: BigInt(10),
        sha256: "insert-video-sha",
        durationMs: 5000,
        widthPx: 1920,
        heightPx: 1080,
        hasAudio: true,
      },
    });

    const content = createInitialContentDocument();
    content.scenes.splice(
      1,
      0,
      createInsertScene("scene-insert-1", "動画 1", video.id, 5000, true),
    );
    const saved = await scriptVersions.saveScriptVersion(prisma, edition.id, {
      sourceScriptVersionId: null,
      content,
    });
    expect(saved.warnings).toEqual([]);
    expect(saved.scriptVersion.content.scenes.map((scene) => scene.kind)).toEqual([
      "intro",
      "insert",
      "point",
      "outro",
    ]);
  });

  it("rejects an insert scene whose duration differs from the video asset", async () => {
    const work = await works.createWork(prisma, "インサート尺", "ja-JP");
    const edition = work.languageEditions[0]!;
    const video = await prisma.asset.create({
      data: {
        id: "asset-insert-mismatch",
        kind: "video",
        origin: "uploaded",
        status: "ready",
        storageKey: "assets/insert-mismatch.mp4",
        originalFilename: "insert.mp4",
        mediaType: "video/mp4",
        byteSize: BigInt(10),
        sha256: "insert-mismatch-sha",
        durationMs: 5000,
        widthPx: 1920,
        heightPx: 1080,
        hasAudio: true,
      },
    });
    const content = createInitialContentDocument();
    content.scenes.splice(
      1,
      0,
      createInsertScene("scene-insert-1", "動画 1", video.id, 4000, true),
    );
    await expect(
      scriptVersions.saveScriptVersion(prisma, edition.id, {
        sourceScriptVersionId: null,
        content,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("warns when an embedded-audio insert scene uses a video without audio", async () => {
    const work = await works.createWork(prisma, "インサート無音", "ja-JP");
    const edition = work.languageEditions[0]!;
    const silent = await prisma.asset.create({
      data: {
        id: "asset-insert-silent",
        kind: "video",
        origin: "uploaded",
        status: "ready",
        storageKey: "assets/insert-silent.mp4",
        originalFilename: "silent.mp4",
        mediaType: "video/mp4",
        byteSize: BigInt(10),
        sha256: "insert-silent-sha",
        durationMs: 5000,
        widthPx: 1920,
        heightPx: 1080,
        hasAudio: false,
      },
    });
    const content = createInitialContentDocument();
    content.scenes.splice(
      1,
      0,
      createInsertScene("scene-insert-1", "動画 1", silent.id, 5000, true),
    );
    const saved = await scriptVersions.saveScriptVersion(prisma, edition.id, {
      sourceScriptVersionId: null,
      content,
    });
    expect(saved.warnings.map((warning) => warning.code)).toContain("insert_video_without_audio");
  });

  it("rejects an insert scene that references a non-video asset", async () => {
    const work = await works.createWork(prisma, "インサート種別", "ja-JP");
    const edition = work.languageEditions[0]!;
    const image = await prisma.asset.create({
      data: {
        id: "asset-insert-image",
        kind: "image",
        origin: "uploaded",
        status: "ready",
        storageKey: "assets/insert-image.png",
        originalFilename: "image.png",
        mediaType: "image/png",
        byteSize: BigInt(10),
        sha256: "insert-image-sha",
        durationMs: null,
        widthPx: 1920,
        heightPx: 1080,
        hasAudio: false,
      },
    });
    const content = createInitialContentDocument();
    content.scenes.splice(
      1,
      0,
      createInsertScene("scene-insert-1", "動画 1", image.id, 5000, true),
    );
    await expect(
      scriptVersions.saveScriptVersion(prisma, edition.id, {
        sourceScriptVersionId: null,
        content,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("saves an insert scene with a trimmed source and matching duration", async () => {
    const work = await works.createWork(prisma, "トリム", "ja-JP");
    const edition = work.languageEditions[0]!;
    const video = await prisma.asset.create({
      data: {
        id: "asset-insert-trim-video",
        kind: "video",
        origin: "uploaded",
        status: "ready",
        storageKey: "assets/insert-trim.mp4",
        originalFilename: "trim.mp4",
        mediaType: "video/mp4",
        byteSize: BigInt(10),
        sha256: "insert-trim-sha",
        durationMs: 5000,
        widthPx: 1920,
        heightPx: 1080,
        hasAudio: true,
      },
    });
    const content = createInitialContentDocument();
    const insert = createInsertScene("scene-insert-1", "動画 1", video.id, 3000, true);
    insert.visualCues[0]!.input = {
      assetId: video.id,
      fit: "cover",
      trimStartMs: 1000,
      trimEndMs: 4000,
    };
    content.scenes.splice(1, 0, insert);
    const saved = await scriptVersions.saveScriptVersion(prisma, edition.id, {
      sourceScriptVersionId: null,
      content,
    });
    expect(saved.warnings).toEqual([]);
  });

  it("saves a looping insert scene whose duration is at least the trimmed length", async () => {
    const work = await works.createWork(prisma, "ループ", "ja-JP");
    const edition = work.languageEditions[0]!;
    const video = await prisma.asset.create({
      data: {
        id: "asset-insert-loop-video",
        kind: "video",
        origin: "uploaded",
        status: "ready",
        storageKey: "assets/insert-loop.mp4",
        originalFilename: "loop.mp4",
        mediaType: "video/mp4",
        byteSize: BigInt(10),
        sha256: "insert-loop-sha",
        durationMs: 5000,
        widthPx: 1920,
        heightPx: 1080,
        hasAudio: true,
      },
    });
    const content = createInitialContentDocument();
    const insert = createInsertScene("scene-insert-1", "動画 1", video.id, 7000, true);
    insert.visualCues[0]!.input = {
      assetId: video.id,
      fit: "cover",
      trimStartMs: 0,
      trimEndMs: 2000,
      loop: true,
    };
    content.scenes.splice(1, 0, insert);
    await expect(
      scriptVersions.saveScriptVersion(prisma, edition.id, {
        sourceScriptVersionId: null,
        content,
      }),
    ).resolves.toBeDefined();
  });

  it("rejects a looping insert scene shorter than the trimmed length", async () => {
    const work = await works.createWork(prisma, "ループ短", "ja-JP");
    const edition = work.languageEditions[0]!;
    const content = createInitialContentDocument();
    const insert = createInsertScene(
      "scene-insert-1",
      "動画 1",
      "asset-insert-loop-video",
      1000,
      true,
    );
    insert.visualCues[0]!.input = {
      assetId: "asset-insert-loop-video",
      fit: "cover",
      trimStartMs: 0,
      trimEndMs: 2000,
      loop: true,
    };
    content.scenes.splice(1, 0, insert);
    await expect(
      scriptVersions.saveScriptVersion(prisma, edition.id, {
        sourceScriptVersionId: null,
        content,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a trim range outside the video duration", async () => {
    const work = await works.createWork(prisma, "トリム範囲外", "ja-JP");
    const edition = work.languageEditions[0]!;
    const content = createInitialContentDocument();
    const insert = createInsertScene(
      "scene-insert-1",
      "動画 1",
      "asset-insert-trim-video",
      3000,
      true,
    );
    insert.visualCues[0]!.input = {
      assetId: "asset-insert-trim-video",
      fit: "cover",
      trimStartMs: 4000,
      trimEndMs: 6000,
    };
    content.scenes.splice(1, 0, insert);
    await expect(
      scriptVersions.saveScriptVersion(prisma, edition.id, {
        sourceScriptVersionId: null,
        content,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
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
        snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
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
