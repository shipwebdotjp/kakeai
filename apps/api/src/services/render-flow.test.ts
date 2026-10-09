import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  createInitialContentDocument,
  renderJobSnapshotSchema,
} from "@kakeai/contracts";
import type { AppConfig } from "../config.ts";
import { loadConfig } from "../config.ts";
import { createPrismaClient } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { applySqlitePragmas } from "../db/pragmas.ts";
import { ensureDataDirectories } from "../storage/paths.ts";
import { ApiError } from "../http/errors.ts";
import { createWorker } from "../worker/index.ts";
import { processAssetIngest } from "../worker/asset-ingest.ts";
import * as artifacts from "./artifacts.ts";
import * as assets from "./assets.ts";
import * as jobs from "./jobs.ts";
import * as renderJobs from "./render-jobs.ts";
import * as scriptVersions from "./script-versions.ts";
import * as works from "./works.ts";

const execFileAsync = promisify(execFile);

let dataDir: string;
let fixturesDir: string;
let config: AppConfig;
let prisma: ReturnType<typeof createPrismaClient>;
let worker: ReturnType<typeof createWorker>;
let ffmpegReady = false;
const renderEnabled = process.env.KAKEAI_RENDER_TEST === "1";

async function generateFixtures(): Promise<void> {
  await execFileAsync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30", "-frames:v", "1", join(fixturesDir, "image.png")]);
  await execFileAsync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "pcm_s16le", join(fixturesDir, "audio.wav")]);
  await execFileAsync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=640x480:rate=30", "-frames:v", "1", join(fixturesDir, "image2.png")]);
}

async function upload(originalFilename: string, sourcePath: string) {
  const tempPath = join(config.directories.tmp, `test-${randomUUID()}`);
  await copyFile(sourcePath, tempPath);
  const buffer = await readFile(sourcePath);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  return assets.ingestUpload(prisma, config.directories, config.limits, {
    tempPath,
    originalFilename,
    sha256,
    byteSize: buffer.length,
  });
}

async function drainWorker(): Promise<void> {
  while (await worker.runOnce()) {
    continue;
  }
}

async function drainIngest(): Promise<void> {
  for (;;) {
    const candidate = await prisma.job.findFirst({
      where: { kind: "asset_ingest", status: "queued" },
      orderBy: { createdAt: "asc" },
    });
    if (candidate === null) {
      return;
    }
    const claimed = await prisma.job.updateMany({
      where: { id: candidate.id, status: "queued" },
      data: { status: "running", startedAt: new Date() },
    });
    if (claimed.count !== 1) {
      continue;
    }
    await processAssetIngest(prisma, config, candidate);
  }
}

async function readyImage(): Promise<{ id: string; sha256: string }> {
  const outcome = await upload("image.png", join(fixturesDir, "image.png"));
  await drainIngest();
  const ready = await assets.getAsset(prisma, outcome.asset.id);
  expect(ready.status).toBe("ready");
  return { id: ready.id, sha256: ready.sha256 };
}

async function versionWithBackground(imageId: string) {
  const work = await works.createWork(prisma, "レンダー作品", "ja-JP");
  const edition = work.languageEditions[0]!;
  const content = createInitialContentDocument();
  const intro = content.scenes[0]!;
  if (intro.kind !== "intro") {
    throw new Error("expected an intro scene");
  }
  intro.visualCues.push({
    id: "vc-intro-bg",
    template: { id: "media.full-bleed", version: 1 },
    range: { kind: "scene" },
    input: { assetId: imageId, fit: "cover" },
  });
  const saved = await scriptVersions.saveScriptVersion(prisma, edition.id, {
    sourceScriptVersionId: null,
    content,
  });
  return { work, edition, saved };
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-render-"));
  process.env.KAKEAI_DATA_DIR = dataDir;
  config = loadConfig();
  await ensureDataDirectories(config.directories);
  await runMigrations();
  prisma = createPrismaClient(config.databaseUrl);
  await applySqlitePragmas(prisma);
  worker = createWorker({ prisma, config });

  fixturesDir = await mkdtemp(join(tmpdir(), "kakeai-render-fixtures-"));
  try {
    await generateFixtures();
    ffmpegReady = true;
  } catch {
    ffmpegReady = false;
  }
}, 60000);

afterAll(async () => {
  await prisma.$disconnect();
  delete process.env.KAKEAI_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
  await rm(fixturesDir, { recursive: true, force: true });
});

describe("render job creation", () => {
  it("freezes an input snapshot and queues the job", async () => {
    if (!ffmpegReady) {
      return;
    }
    const image = await readyImage();
    const { work, saved } = await versionWithBackground(image.id);

    const job = await renderJobs.createRenderJob(prisma, saved.scriptVersion.id);

    expect(job.kind).toBe("render");
    expect(job.status).toBe("queued");
    expect(job.workId).toBe(work.id);
    expect(job.scriptVersionId).toBe(saved.scriptVersion.id);
    expect(job.artifacts).toEqual([]);

    const row = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    const snapshot = renderJobSnapshotSchema.parse(JSON.parse(row.inputSnapshotJson));
    expect(snapshot.scriptVersionId).toBe(saved.scriptVersion.id);
    expect(snapshot.template).toEqual({ id: "explanation-scenes", version: 1 });
    expect(snapshot.output).toEqual({ width: 1920, height: 1080, fps: 30, format: "mp4" });
    expect(snapshot.assets.map((asset) => asset.assetId)).toEqual([image.id]);

    await jobs.cancelJob(prisma, job.id);
  });

  it("returns 404 for an unknown script version", async () => {
    try {
      await renderJobs.createRenderJob(prisma, "scr_missing");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("RESOURCE_NOT_FOUND");
    }
  });

  it("rejects processing and unavailable assets", async () => {
    if (!ffmpegReady) {
      return;
    }
    const image = await readyImage();
    const { saved } = await versionWithBackground(image.id);

    await prisma.asset.update({ where: { id: image.id }, data: { status: "processing" } });
    await expect(renderJobs.createRenderJob(prisma, saved.scriptVersion.id)).rejects.toMatchObject({
      code: "ASSET_PROCESSING",
    });

    await prisma.asset.update({ where: { id: image.id }, data: { status: "failed" } });
    await expect(renderJobs.createRenderJob(prisma, saved.scriptVersion.id)).rejects.toMatchObject({
      code: "ASSET_UNAVAILABLE",
    });

    await prisma.asset.update({ where: { id: image.id }, data: { status: "ready" } });
  });

  it("rejects fixed scenes whose audio total exceeds the duration", async () => {
    if (!ffmpegReady) {
      return;
    }
    const audio = await upload("audio.wav", join(fixturesDir, "audio.wav"));
    await drainIngest();
    const readyAudio = await assets.getAsset(prisma, audio.asset.id);
    expect(readyAudio.status).toBe("ready");
    if (readyAudio.durationMs === null) {
      throw new Error("expected audio duration");
    }
    const work = await works.createWork(prisma, "尺テスト", "ja-JP");
    const edition = work.languageEditions[0]!;
    const content = createInitialContentDocument();
    const point = content.scenes[1]!;
    if (point.kind !== "point") {
      throw new Error("expected a point scene");
    }
    point.timing = { mode: "fixed", durationMs: 1000 };
    content.audioTakes.push({
      id: "take-overflow",
      narrationSegmentId: "line-overflow",
      source: "manual",
      assetId: readyAudio.id,
      durationMs: readyAudio.durationMs,
    });
    point.lines.push({
      id: "line-overflow",
      speakerId: null,
      captionText: "長い音声",
      speechText: "ながいおんせい",
      selectedAudioTakeId: "take-overflow",
    });
    const saved = await scriptVersions.saveScriptVersion(prisma, edition.id, {
      sourceScriptVersionId: null,
      content,
    });
    await expect(
      renderJobs.createRenderJob(prisma, saved.scriptVersion.id),
    ).rejects.toMatchObject({ code: "RENDER_INPUT_INVALID" });
  });
});

describe("render job polling and cancel", () => {
  it("lists work jobs newest first and fetches by id", async () => {
    if (!ffmpegReady) {
      return;
    }
    const image = await readyImage();
    const { work, saved } = await versionWithBackground(image.id);
    const first = await renderJobs.createRenderJob(prisma, saved.scriptVersion.id);
    const second = await renderJobs.createRenderJob(prisma, saved.scriptVersion.id);

    const history = await jobs.listWorkJobs(prisma, work.id);
    expect(history.map((job) => job.id)).toEqual([second.id, first.id]);

    const fetched = await jobs.getJob(prisma, first.id);
    expect(fetched.scriptVersionId).toBe(saved.scriptVersion.id);

    await jobs.cancelJob(prisma, first.id);
    await jobs.cancelJob(prisma, second.id);
  });

  it("cancels queued jobs and rejects the rest", async () => {
    if (!ffmpegReady) {
      return;
    }
    const image = await readyImage();
    const { saved } = await versionWithBackground(image.id);
    const job = await renderJobs.createRenderJob(prisma, saved.scriptVersion.id);

    const cancelled = await jobs.cancelJob(prisma, job.id);
    expect(cancelled.status).toBe("cancelled");

    await expect(jobs.cancelJob(prisma, job.id)).rejects.toMatchObject({
      code: "JOB_NOT_CANCELLABLE",
    });
    await expect(jobs.getJob(prisma, "job_missing")).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
    });
    await expect(jobs.listWorkJobs(prisma, "wrk_missing")).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
    });
  });

  it("marks the asset failed when cancelling ingest", async () => {
    if (!ffmpegReady) {
      return;
    }
    const outcome = await upload("image2.png", join(fixturesDir, "image2.png"));
    expect(outcome.asset.status).toBe("processing");
    const ingestJobs = await prisma.job.findMany({
      where: { assetId: outcome.asset.id, kind: "asset_ingest" },
    });
    expect(ingestJobs).toHaveLength(1);

    const cancelled = await jobs.cancelJob(prisma, ingestJobs[0]!.id);
    expect(cancelled.status).toBe("cancelled");
    const asset = await assets.getAsset(prisma, outcome.asset.id);
    expect(asset.status).toBe("failed");
  });
});

describe("render worker", () => {
  it("renders the snapshot to an mp4 artifact", async () => {
    if (!ffmpegReady || !renderEnabled) {
      return;
    }
    const image = await readyImage();
    const { saved } = await versionWithBackground(image.id);
    const job = await renderJobs.createRenderJob(prisma, saved.scriptVersion.id);

    await drainWorker();

    const finished = await jobs.getJob(prisma, job.id);
    expect(finished.status).toBe("succeeded");
    expect(finished.progressPercent).toBe(100);
    expect(finished.artifacts).toHaveLength(1);
    const artifact = finished.artifacts[0]!;
    expect(artifact.role).toBe("render");
    expect(artifact.format).toBe("mp4");
    expect(artifact.durationMs).toBeGreaterThan(0);

    const location = await artifacts.resolveArtifactContent(
      prisma,
      config.directories,
      artifact.id,
    );
    expect(location.mediaType).toBe("video/mp4");
    const info = await stat(location.path);
    expect(info.size).toBe(artifact.byteSize);

    const metadata = await artifacts.getArtifact(prisma, artifact.id);
    expect(metadata.contentUrl).toBe(`/api/v1/artifacts/${artifact.id}/content`);

    await artifacts.deleteArtifact(prisma, config.directories, artifact.id);
    await expect(artifacts.getArtifact(prisma, artifact.id)).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
    });
  }, 300000);
});
