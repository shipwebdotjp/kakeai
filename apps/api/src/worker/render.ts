import { mkdir, rm, stat, symlink, writeFile, cp } from "node:fs/promises";
import { join } from "node:path";
import { createRenderJob, executeRenderJob } from "@hyperframes/producer";
import {
  compileDocument,
  collectStillFrameRequests,
  deriveVideoPlaybackPlans,
  resolveVisualSkin,
  type CompiledComposition,
  type ResolvedAssetKind,
} from "@kakeai/video";
import { computeDirectoryHashAndFiles } from "../storage/composition-store.ts";
import {
  NEUTRAL_VISUAL_SKIN_REF,
  parseRenderJobSnapshot,
  resolveVisualThemeSkin,
  type RenderJobSnapshot,
} from "@kakeai/contracts";
import type { AppConfig } from "../config.ts";
import type { Job, PrismaClient } from "../generated/prisma/client.ts";
import { bigIntToSafeNumber } from "../dto/mappers.ts";
import { logger } from "../logger.ts";
import { probeMedia } from "../media/probe.ts";
import {
  extractStillFramePng,
  resolveStillFramePtsMs,
  stillFrameCacheFileName,
} from "../media/still-frame.ts";
import {
  commitFile,
  hashFile,
  resolveStoragePath,
} from "../storage/asset-store.ts";
import type { DataDirectories } from "../storage/paths.ts";

export type RenderErrorCode = "ASSET_UNAVAILABLE" | "RENDER_FAILED";

export class RenderJobError extends Error {
  readonly code: RenderErrorCode;

  constructor(code: RenderErrorCode, message: string) {
    super(message);
    this.name = "RenderJobError";
    this.code = code;
  }
}

function extensionForMediaType(mediaType: string): string {
  const table: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/bmp": "bmp",
    "image/avif": "avif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "video/x-matroska": "mkv",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/aac": "aac",
    "audio/ogg": "ogg",
    "audio/webm": "webm",
    "audio/flac": "flac",
    "audio/x-flac": "flac",
  };
  const extension = table[mediaType];
  if (extension === undefined) {
    throw new RenderJobError("RENDER_FAILED", "レンダー入力を解決できません。");
  }
  return extension;
}

function parseSnapshot(job: Job): RenderJobSnapshot {
  try {
    return parseRenderJobSnapshot(JSON.parse(job.inputSnapshotJson));
  } catch {
    throw new RenderJobError("RENDER_FAILED", "レンダー入力を解釈できません。");
  }
}

interface ResolvedSnapshotAsset {
  assetId: string;
  kind: string;
  filePath: string;
  fileName: string;
  durationMs: number | null;
  sha256: string;
}

async function resolveSnapshotAssets(
  prisma: PrismaClient,
  directories: DataDirectories,
  snapshot: RenderJobSnapshot,
): Promise<ResolvedSnapshotAsset[]> {
  const ids = [...new Set(snapshot.assets.map((asset) => asset.assetId))];
  const rows =
    ids.length === 0
      ? []
      : await prisma.asset.findMany({
          where: { id: { in: ids } },
          include: { renditions: true },
        });
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const resolved: ResolvedSnapshotAsset[] = [];
  for (const asset of snapshot.assets) {
    const row = rowById.get(asset.assetId);
    const rendition =
      asset.renditionId === null
        ? undefined
        : row?.renditions.find((entry) => entry.id === asset.renditionId);
    const source = rendition ?? row;
    if (row === undefined || source === undefined || source.sha256 !== asset.sha256) {
      throw new RenderJobError(
        "ASSET_UNAVAILABLE",
        "素材ファイルを利用できないため、レンダーできませんでした。",
      );
    }
    if (row.kind !== "image" && row.kind !== "video" && row.kind !== "audio") {
      throw new RenderJobError(
        "ASSET_UNAVAILABLE",
        "素材ファイルを利用できないため、レンダーできませんでした。",
      );
    }
    const filePath = resolveStoragePath(
      directories,
      rendition?.storageKey ?? row.storageKey,
    );
    const expectedByteSize = bigIntToSafeNumber(
      rendition !== undefined ? rendition.byteSize : row.byteSize,
    );
    const info = await stat(filePath).catch(() => null);
    if (info === null || !info.isFile() || info.size !== expectedByteSize) {
      throw new RenderJobError(
        "ASSET_UNAVAILABLE",
        "素材ファイルを利用できないため、レンダーできませんでした。",
      );
    }
    if (resolved.some((entry) => entry.assetId === asset.assetId)) {
      continue;
    }
    resolved.push({
      assetId: asset.assetId,
      kind: row.kind,
      filePath,
      fileName: `${asset.assetId}.${extensionForMediaType(asset.mediaType)}`,
      durationMs: asset.durationMs,
      sha256: asset.sha256,
    });
  }
  return resolved;
}

export async function processRenderJob(
  prisma: PrismaClient,
  config: AppConfig,
  job: Job,
): Promise<void> {
  const snapshot = parseSnapshot(job);
  const projectDir = join(config.directories.tmp, `render-${job.id}`);
  const assetsDir = join(projectDir, "assets");
  try {
    const assets = await resolveSnapshotAssets(prisma, config.directories, snapshot);
    await mkdir(assetsDir, { recursive: true });
    for (const asset of assets) {
      await symlink(asset.filePath, join(assetsDir, asset.fileName)).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }
      });
    }

    const snapshotCompositions = snapshot.compositionVersions ?? [];
    const compositionResolverMap = new Map<string, { id: string; runtimeCompositionId: string; entrypoint: string; bundleHash: string; storageKey: string; manifest: any }>();

    for (const compRef of snapshotCompositions) {
      const bundleSourcePath = resolveStoragePath(config.directories, compRef.storageKey);
      const info = await stat(bundleSourcePath).catch(() => null);
      if (!info || !info.isDirectory()) {
        throw new RenderJobError("ASSET_UNAVAILABLE", `Composition bundle directory missing: ${compRef.id}`);
      }
      const { bundleHash } = await computeDirectoryHashAndFiles(bundleSourcePath);
      if (bundleHash !== compRef.bundleHash) {
        throw new RenderJobError("ASSET_UNAVAILABLE", `Composition bundle hash mismatch for ${compRef.id}`);
      }

      const targetSubdir = join(projectDir, compRef.storageKey);
      await mkdir(targetSubdir, { recursive: true });
      await cp(bundleSourcePath, targetSubdir, { recursive: true });

      compositionResolverMap.set(compRef.id, {
        id: compRef.id,
        runtimeCompositionId: compRef.manifest.runtimeCompositionId,
        entrypoint: compRef.manifest.entrypoint,
        bundleHash: compRef.bundleHash,
        storageKey: compRef.storageKey,
        manifest: compRef.manifest,
      });
    }

    const fileById = new Map(assets.map((asset) => [asset.assetId, asset.fileName]));
    const assetById = new Map(assets.map((asset) => [asset.assetId, asset]));
    const skinRef =
      snapshot.skin ??
      (snapshot.themeDefinition === undefined
        ? NEUTRAL_VISUAL_SKIN_REF
        : resolveVisualThemeSkin(snapshot.themeDefinition));
    let compiled: CompiledComposition;
    try {
      const playbackPlans = deriveVideoPlaybackPlans(snapshot.content, {
        resolveAssetDurationMs: (assetId) => assetById.get(assetId)?.durationMs ?? null,
      });
      const stillFileNameByKey = new Map<string, string>();
      const extractedFileNames = new Set<string>();
      for (const request of collectStillFrameRequests(playbackPlans.plans)) {
        const asset = assetById.get(request.assetId);
        if (asset === undefined) {
          throw new RenderJobError(
            "ASSET_UNAVAILABLE",
            "保持フレームの素材を解決できないため、レンダーできませんでした。",
          );
        }
        let ptsMs: number;
        try {
          ptsMs = await resolveStillFramePtsMs(
            { filePath: asset.filePath, sha256: asset.sha256 },
            request.sourceMs,
          );
        } catch {
          throw new RenderJobError(
            "ASSET_UNAVAILABLE",
            `保持フレームを抽出できませんでした: ${request.assetId}@${request.sourceMs}ms`,
          );
        }
        const fileName = stillFrameCacheFileName(asset.sha256, ptsMs);
        if (!extractedFileNames.has(fileName)) {
          extractedFileNames.add(fileName);
          await extractStillFramePng(
            { filePath: asset.filePath, sha256: asset.sha256 },
            ptsMs,
            join(assetsDir, fileName),
          );
        }
        stillFileNameByKey.set(`${request.assetId}|${request.sourceMs}`, fileName);
      }
      compiled = compileDocument({
        document: snapshot.content,
        resolvedTheme: snapshot.themeDefinition,
        resolvedSkin: resolveVisualSkin(skinRef),
        videoPlaybackPlans: playbackPlans.byPath,
        stillResolver: (assetId, sourceMs) => {
          const fileName = stillFileNameByKey.get(`${assetId}|${sourceMs}`);
          if (fileName === undefined) {
            throw new RenderJobError("RENDER_FAILED", "保持フレームを解決できません。");
          }
          return `assets/${fileName}`;
        },
        assetResolver: (assetId) => {
          const fileName = fileById.get(assetId);
          const asset = assetById.get(assetId);
          if (
            fileName === undefined ||
            asset === undefined ||
            (asset.kind !== "image" && asset.kind !== "video" && asset.kind !== "audio")
          ) {
            throw new RenderJobError("RENDER_FAILED", "レンダー入力を解決できません。");
          }
          const kind = asset.kind as ResolvedAssetKind;
          return {
            url: `assets/${fileName}`,
            kind,
            durationMs: kind === "image" ? null : asset.durationMs,
          };
        },
        compositionResolver: (versionId) => {
          const found = compositionResolverMap.get(versionId);
          if (!found) {
            throw new RenderJobError("RENDER_FAILED", `Composition version missing from job snapshot: ${versionId}`);
          }
          return {
            id: found.id,
            runtimeCompositionId: found.runtimeCompositionId,
            entrypoint: `${found.storageKey}/${found.entrypoint}`,
            bundleHash: found.bundleHash,
            storageKey: found.storageKey,
            manifest: found.manifest,
          };
        },
        faceSetResolver: (faceSetId, version) => {
          const found = (snapshot.faceSets ?? []).find(
            (faceSet) =>
              faceSet.id === faceSetId &&
              (faceSet.version === undefined || faceSet.version === version),
          );
          if (!found) {
            throw new RenderJobError(
              "RENDER_FAILED",
              `Face set missing from job snapshot: ${faceSetId} v${version}`,
            );
          }
          return found;
        },
      });
    } catch (error) {
      if (error instanceof RenderJobError) {
        throw error;
      }
      throw new RenderJobError("RENDER_FAILED", "Compositionを生成できません。");
    }
    await writeFile(join(projectDir, "index.html"), compiled.html);

    const renderJob = createRenderJob({
      fps: snapshot.output.fps,
      format: snapshot.output.format,
      quality: "standard",
    });
    const outputTempPath = join(projectDir, "output.mp4");
    let lastReportedPercent = 0;
    try {
      await executeRenderJob(renderJob, projectDir, outputTempPath, (renderState) => {
        const percent = Math.max(0, Math.min(100, Math.round(renderState.progress)));
        if (percent > lastReportedPercent) {
          lastReportedPercent = percent;
          void prisma.job
            .updateMany({
              where: { id: job.id, progressPercent: { lt: percent } },
              data: { progressPercent: percent },
            })
            .catch((error: unknown) => {
              logger.warn("render_progress_update_failed", {
                jobId: job.id,
                error: error instanceof Error ? error.message : String(error),
              });
            });
        }
      });
    } catch (error) {
      if (error instanceof RenderJobError) {
        throw error;
      }
      throw new RenderJobError("RENDER_FAILED", "レンダーに失敗しました。");
    }

    const digest = await hashFile(outputTempPath);
    const storageKey = `artifacts/${job.id}-${digest.sha256}.mp4`;
    await commitFile(outputTempPath, storageKey, config.directories);
    const outputPath = resolveStoragePath(config.directories, storageKey);
    const probe = await probeMedia(outputPath, "video", "video/mp4").catch(() => null);
    await prisma.$transaction(async (transaction) => {
      const artifact = await transaction.artifact.create({
        data: {
          jobId: job.id,
          role: "render",
          format: "mp4",
          storageKey,
          sha256: digest.sha256,
          byteSize: digest.byteSize,
          durationMs: probe?.durationMs ?? compiled.durationMs,
          widthPx: probe?.widthPx ?? snapshot.output.width,
          heightPx: probe?.heightPx ?? snapshot.output.height,
          fps: snapshot.output.fps,
          videoCodec: probe?.codec ?? null,
          audioCodec: probe?.audioCodec ?? null,
        },
      });
      await transaction.job.update({
        where: { id: job.id },
        data: {
          status: "succeeded",
          progressPercent: 100,
          finishedAt: new Date(),
          resultJson: JSON.stringify({ artifactId: artifact.id }),
        },
      });
    });
    logger.info("render_succeeded", { jobId: job.id, storageKey });
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
}
