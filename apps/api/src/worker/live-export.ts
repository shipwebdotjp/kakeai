import { createHash } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  LIVE_PACKAGE_SCHEMA_VERSION,
  livePackageManifestSchema,
  livePackageShowSchema,
  liveCharacterSheetSchema,
  parseLiveExportJobSnapshot,
  type LiveExportFailure,
  type LiveExportJobSnapshot,
  type LiveExportResult,
  type LiveManifestVoice,
  type LivePackageManifest,
  type LivePackageShow,
  type TtsAdapter,
  type VoiceAdapterId,
} from "@kakeai/contracts";
import { hashFile } from "../storage/asset-store.ts";
import type { AppConfig } from "../config.ts";
import type { Job, PrismaClient } from "../generated/prisma/client.ts";
import { logger } from "../logger.ts";
import type { Rasterizer } from "../media/rasterize.ts";
import { canonicalJson } from "../live/canonical-json.ts";
import { LiveExportError } from "../live/errors.ts";
import { loadSnapshotAssets } from "../live/load-assets.ts";
import { assertUsableOutputDir } from "../live/output-dir.ts";
import { PackageWriter } from "../live/package-writer.ts";
import { prepareAudio } from "../live/prepare-audio.ts";
import { prepareCharacters } from "../live/prepare-characters.ts";
import { prepareMaterials, type RenderMp4 } from "../live/prepare-materials.ts";
import { prepareVoices, voiceForSpeaker } from "../live/prepare-voices.ts";
import { resolveLiveProfile } from "../live/profile-resolution.ts";
import { buildThemeCss } from "../live/theme-css.ts";
import { verifyPackage } from "../live/verify-package.ts";

export interface LiveExportJobDependencies {
  adapterFor?: (id: VoiceAdapterId) => TtsAdapter;
  rasterizer?: Rasterizer;
  renderMp4?: RenderMp4;
  isCancelled?: (jobId: string) => Promise<boolean>;
}

function parseSnapshot(job: Job): LiveExportJobSnapshot {
  try {
    return parseLiveExportJobSnapshot(JSON.parse(job.inputSnapshotJson));
  } catch {
    throw new LiveExportError(
      "LIVE_EXPORT_INPUT_INVALID",
      "input",
      "ライブ書き出しの入力を解釈できません。",
    );
  }
}

async function isJobCancelled(prisma: PrismaClient, jobId: string): Promise<boolean> {
  const row = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
  return row?.status === "cancelled";
}

async function updateProgress(
  prisma: PrismaClient,
  jobId: string,
  progressPercent: number,
): Promise<void> {
  await prisma.job
    .updateMany({
      where: { id: jobId, status: "running", progressPercent: { lt: progressPercent } },
      data: { progressPercent },
    })
    .catch(() => undefined);
}

function packageIdFor(snapshot: LiveExportJobSnapshot): string {
  const digest = createHash("sha256")
    .update(
      canonicalJson({
        exporterVersion: snapshot.exporterVersion,
        profileSha256: snapshot.profileSha256,
        source: {
          workId: snapshot.workId,
          languageEditionId: snapshot.languageEditionId,
          scriptVersionId: snapshot.scriptVersionId,
          theme: snapshot.content.visualTheme,
        },
      }),
      "utf8",
    )
    .digest("hex");
  return `livepkg-${digest.slice(0, 24)}`;
}

function failureOf(error: unknown): LiveExportFailure {
  if (error instanceof LiveExportError) {
    return error.failure;
  }
  return {
    stage: "unknown",
    id: null,
    message: error instanceof Error ? error.message : String(error),
  };
}

function errorCodeOf(error: unknown): string {
  return error instanceof LiveExportError ? error.errorCode : "LIVE_EXPORT_FAILED";
}

async function failJob(
  prisma: PrismaClient,
  job: Job,
  error: unknown,
  warnings: string[],
): Promise<void> {
  const failure = failureOf(error);
  const result: LiveExportResult = {
    packagePath: null,
    packageId: null,
    manifestSha256: null,
    fileCount: null,
    preparedCueCount: null,
    warnings,
    failures: [failure],
  };
  await prisma.job
    .updateMany({
      where: { id: job.id, status: "running" },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorCode: errorCodeOf(error),
        errorMessage: failure.message,
        resultJson: JSON.stringify(result),
      },
    })
    .catch(() => undefined);
  logger.warn("live_export_failed", {
    jobId: job.id,
    stage: failure.stage,
    id: failure.id,
    error: failure.message,
  });
}

export async function processLiveExportJob(
  prisma: PrismaClient,
  config: AppConfig,
  job: Job,
  dependencies: LiveExportJobDependencies = {},
): Promise<void> {
  let snapshot: LiveExportJobSnapshot;
  try {
    snapshot = parseSnapshot(job);
  } catch (error) {
    await failJob(prisma, job, error, []);
    return;
  }
  const isCancelled = dependencies.isCancelled ?? ((jobId: string) => isJobCancelled(prisma, jobId));
  let tempDir: string | undefined;
  let committed = false;
  const warnings: string[] = [];
  let preparedCueCount: number | null = null;
  let manifestSha256: string | null = null;
  let packageId: string | null = null;

  try {
    await assertUsableOutputDir(snapshot.outDir);
    tempDir = join(
      dirname(snapshot.outDir),
      `.${basename(snapshot.outDir)}.live-export-${job.id}.tmp`,
    );
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    await mkdir(tempDir, { recursive: false });
    const writer = new PackageWriter(tempDir);

    await updateProgress(prisma, job.id, 10);
    const assetById = await loadSnapshotAssets(prisma, config, snapshot.assets);
    const voiceProfiles = new Map(snapshot.voiceProfiles.map((profile) => [profile.id, profile]));
    const resolved = resolveLiveProfile(
      snapshot.content,
      snapshot.profile,
      assetById,
      voiceProfiles,
    );

    if (await isCancelled(job.id)) {
      throw new LiveExportError("LIVE_EXPORT_FAILED", "output", "書き出しがキャンセルされました。");
    }
    const voices = await prepareVoices(resolved, voiceProfiles, assetById, writer, config, {
      ...(dependencies.adapterFor === undefined ? {} : { adapterFor: dependencies.adapterFor }),
      isCancelled: () => isCancelled(job.id),
    });
    await updateProgress(prisma, job.id, 25);

    const characters = await prepareCharacters(
      snapshot.content,
      snapshot.profile,
      snapshot.faceSets,
      assetById,
      resolved,
      voices,
      writer,
    );
    try {
      liveCharacterSheetSchema.parse(characters.sheet);
    } catch (error) {
      throw new LiveExportError(
        "LIVE_EXPORT_FAILED",
        "manifest",
        `characters.json が不正です: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await writer.writeJson("characters.json", characters.sheet, {
      mediaType: "application/json",
      kind: "characters",
      hasAudio: false,
    });
    await updateProgress(prisma, job.id, 35);

    const cues = await prepareAudio(
      resolved.cues,
      voices,
      assetById,
      writer,
      config,
      {
        ...(dependencies.adapterFor === undefined ? {} : { adapterFor: dependencies.adapterFor }),
        isCancelled: () => isCancelled(job.id),
      },
    );
    preparedCueCount = cues.length;
    await updateProgress(prisma, job.id, 65);

    const materials = await prepareMaterials(
      snapshot.profile,
      snapshot.content,
      snapshot.theme,
      assetById,
      writer,
      config,
      {
        ...(dependencies.rasterizer === undefined ? {} : { rasterizer: dependencies.rasterizer }),
        ...(dependencies.renderMp4 === undefined ? {} : { renderMp4: dependencies.renderMp4 }),
        isCancelled: () => isCancelled(job.id),
      },
    );
    warnings.push(...materials.warnings);
    if (snapshot.fontDiagnostics !== undefined) {
      if (snapshot.fontDiagnostics.missingFonts.length > 0) {
        warnings.push(
          `フォントが見つかりません: ${snapshot.fontDiagnostics.missingFonts.join(", ")}`,
        );
      }
      warnings.push(...(snapshot.fontDiagnostics.diagnostics ?? []));
    }
    await updateProgress(prisma, job.id, 85);

    await writer.writeText("theme.css", buildThemeCss(snapshot.theme, snapshot.content.locale), {
      mediaType: "text/css",
      kind: "theme",
      hasAudio: false,
    });

    if (snapshot.fixture !== undefined) {
      await writer.writeJson("fixtures/comments.json", snapshot.fixture, {
        mediaType: "application/json",
        kind: "fixture",
        hasAudio: false,
      });
    }

    const speakers = resolved.speakers.map((speaker) => ({
      id: speaker.id,
      name: speaker.name,
      side: speaker.side,
      characterId: speaker.characterId,
      voice: voiceForSpeaker(speaker, voices),
    }));
    let show: LivePackageShow = {
      schemaVersion: 1,
      show: snapshot.profile.show,
      commentSource: snapshot.profile.commentSource,
      segments: snapshot.profile.segments,
      cues,
      materials: materials.materials,
      speakers,
      commentPolicy: snapshot.profile.commentPolicy,
      safety: snapshot.profile.safety,
      playout: snapshot.profile.playout,
      ...(snapshot.fixture === undefined
        ? {}
        : { test: { fixture: "fixtures/comments.json" } }),
    };
    try {
      show = livePackageShowSchema.parse(show);
    } catch (error) {
      throw new LiveExportError(
        "LIVE_EXPORT_FAILED",
        "manifest",
        `show.json が不正です: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await writer.writeJson("show.json", show, {
      mediaType: "application/json",
      kind: "show",
      hasAudio: false,
    });
    await updateProgress(prisma, job.id, 90);

    packageId = packageIdFor(snapshot);
    const manifestVoices: LiveManifestVoice[] = voices.manifestVoices;
    let manifest: LivePackageManifest;
    try {
      manifest = livePackageManifestSchema.parse({
        packageSchemaVersion: LIVE_PACKAGE_SCHEMA_VERSION,
        exporterVersion: snapshot.exporterVersion,
        packageId,
        createdAt: new Date().toISOString(),
        source: {
          workId: snapshot.workId,
          languageEditionId: snapshot.languageEditionId,
          scriptVersionId: snapshot.scriptVersionId,
          theme: snapshot.content.visualTheme,
          profileSha256: snapshot.profileSha256,
        },
        files: writer.fileList(),
        fonts: snapshot.fonts,
        voices: manifestVoices,
      });
    } catch (error) {
      throw new LiveExportError(
        "LIVE_EXPORT_FAILED",
        "manifest",
        `manifest.json を組み立てられません: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await writer.writeManifest(manifest);
    manifestSha256 = (await hashFile(join(tempDir, "manifest.json"))).sha256;
    await updateProgress(prisma, job.id, 95);

    const verified = await verifyPackage(tempDir, manifest);
    await updateProgress(prisma, job.id, 98);

    if (await isCancelled(job.id)) {
      throw new LiveExportError("LIVE_EXPORT_FAILED", "output", "書き出しがキャンセルされました。");
    }
    await assertUsableOutputDir(snapshot.outDir);
    await rename(tempDir, snapshot.outDir);
    committed = true;

    const result: LiveExportResult = {
      packagePath: snapshot.outDir,
      packageId,
      manifestSha256,
      fileCount: verified.fileCount,
      preparedCueCount,
      warnings,
      failures: [],
    };
    const updated = await prisma.job.updateMany({
      where: { id: job.id, status: "running" },
      data: {
        status: "succeeded",
        progressPercent: 100,
        finishedAt: new Date(),
        resultJson: JSON.stringify(result),
      },
    });
    if (updated.count === 0) {
      // The package was committed, but the Job was cancelled just before the
      // status write. Keep the package; deleting a committed directory could
      // remove data another process has since added. The operation log reports
      // the cancellation and the orphaned package path.
      logger.warn("live_export_cancelled_after_commit", {
        jobId: job.id,
        packagePath: snapshot.outDir,
      });
      return;
    }
    logger.info("live_export_succeeded", {
      jobId: job.id,
      packagePath: snapshot.outDir,
      fileCount: verified.fileCount,
    });
  } catch (error) {
    if (tempDir !== undefined && !committed) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
    if (await isCancelled(job.id)) {
      logger.info("live_export_cancelled", { jobId: job.id });
      return;
    }
    await failJob(prisma, job, error, warnings);
  }
}
