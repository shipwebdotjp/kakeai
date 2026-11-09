import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { LivePackageCutIn } from "@kakeai/contracts";
import type { AppConfig } from "../config.ts";
import { createRendition } from "../media/normalize.ts";
import { probeMedia, type MediaProbe } from "../media/probe.ts";
import { LiveExportError } from "./errors";
import type { PackageWriter } from "./package-writer";
import type { ResolvedAssetFile, ResolvedCutIn } from "./resolved-assets";

export interface PrepareCutInsDependencies {
  isCancelled?: () => Promise<boolean>;
  createRendition?: typeof createRendition;
}

export interface PreparedCutIns {
  cutIns: LivePackageCutIn[];
  warnings: string[];
}

interface CutInFacts {
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

interface PreparedAsset extends CutInFacts {
  file: string;
}

const TARGET_ASPECT = 16 / 9;
const ASPECT_TOLERANCE = 0.02;
const DURATION_MISMATCH_MS = 50;

function fail(message: string, id: string | null = null): never {
  throw new LiveExportError("LIVE_EXPORT_CUT_IN_FAILED", "material", message, id);
}

async function probeVideo(
  path: string,
  id: string,
  mediaType: string = "video/mp4",
): Promise<MediaProbe> {
  try {
    return await probeMedia(path, "video", mediaType);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(`CutIn の動画情報を取得できませんでした: ${id} (${detail})`, id);
  }
}

function isBrowserPlayable(asset: ResolvedAssetFile, probe: MediaProbe): boolean {
  return (
    asset.mediaType === "video/mp4" &&
    probe.codec === "h264" &&
    (probe.audioCodec === null || probe.audioCodec === "aac") &&
    probe.rotation === 0 &&
    probe.constantFrameRate &&
    probe.durationMs !== null &&
    probe.durationMs > 0 &&
    probe.widthPx !== null &&
    probe.widthPx > 0 &&
    probe.heightPx !== null &&
    probe.heightPx > 0
  );
}

function factsFromProbe(probe: MediaProbe, id: string): CutInFacts {
  if (probe.durationMs === null || probe.durationMs <= 0) {
    fail(`CutIn の尺を取得できませんでした: ${id}`, id);
  }
  if (
    probe.widthPx === null ||
    probe.widthPx <= 0 ||
    probe.heightPx === null ||
    probe.heightPx <= 0
  ) {
    fail(`CutIn に動画ストリームがありません: ${id}`, id);
  }
  return {
    durationMs: probe.durationMs,
    width: probe.widthPx,
    height: probe.heightPx,
    hasAudio: probe.audioCodec !== null,
  };
}

async function prepareAsset(
  asset: ResolvedAssetFile,
  writer: PackageWriter,
  config: AppConfig,
  dependencies: PrepareCutInsDependencies,
): Promise<PreparedAsset> {
  const sourceProbe = await probeVideo(asset.path, asset.assetId, asset.mediaType);
  let file: string;

  if (isBrowserPlayable(asset, sourceProbe)) {
    const sourceFacts = factsFromProbe(sourceProbe, asset.assetId);
    file = await writer.writeAsset(asset.path, {
      mediaType: "video/mp4",
      kind: "cut-in",
      ...sourceFacts,
    });
  } else {
    const workDir = await mkdtemp(join(config.directories.tmp, "live-cutin-"));
    try {
      const outputPath = join(workDir, "cutin.mp4");
      const rendition = dependencies.createRendition ?? createRendition;
      try {
        await rendition(asset.path, outputPath, "video");
      } catch (error) {
        fail(
          `CutIn の正規化に失敗しました: ${asset.assetId} (${error instanceof Error ? error.message : String(error)})`,
          asset.assetId,
        );
      }
      const normalizedFacts = factsFromProbe(
        await probeVideo(outputPath, asset.assetId),
        asset.assetId,
      );
      file = await writer.writeAsset(outputPath, {
        mediaType: "video/mp4",
        kind: "cut-in",
        ...normalizedFacts,
      });
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // The packaged bytes are the source of truth, not the Asset row.
  const finalFacts = factsFromProbe(
    await probeVideo(writer.resolvePath(file), asset.assetId),
    asset.assetId,
  );
  return { file, ...finalFacts };
}

function warningsForAsset(
  asset: ResolvedAssetFile,
  facts: CutInFacts,
): string[] {
  const warnings: string[] = [];
  if (
    asset.durationMs !== null &&
    Math.abs(asset.durationMs - facts.durationMs) >= DURATION_MISMATCH_MS
  ) {
    warnings.push(
      `CutIn 素材 ${asset.assetId} の尺が DB の値と 50ms 以上ずれています。probe 結果を採用します: ${asset.durationMs}ms -> ${facts.durationMs}ms`,
    );
  }
  const aspect = facts.width / facts.height;
  if (Math.abs(aspect - TARGET_ASPECT) > ASPECT_TOLERANCE) {
    warnings.push(
      `CutIn 素材 ${asset.assetId} のアスペクト比が 16:9 ではありません: ${facts.width}x${facts.height}`,
    );
  }
  return warnings;
}

/**
 * Resolves the CutIns referenced by `cut_in` segments into package MP4s.
 * Unreferenced CutIns are allowed but never written. The same Asset used by
 * several CutIns is probed and normalized only once.
 */
export async function prepareCutIns(
  referencedIds: readonly string[],
  resolvedCutIns: readonly ResolvedCutIn[],
  assetById: Map<string, ResolvedAssetFile>,
  writer: PackageWriter,
  config: AppConfig,
  dependencies: PrepareCutInsDependencies = {},
): Promise<PreparedCutIns> {
  const isCancelled = dependencies.isCancelled ?? (async () => false);
  const throwIfCancelled = async (): Promise<void> => {
    if (await isCancelled()) {
      throw new LiveExportError(
        "LIVE_EXPORT_FAILED",
        "output",
        "書き出しがキャンセルされました。",
      );
    }
  };
  const referenced = new Set<string>(referencedIds);
  const resolvedById = new Map(resolvedCutIns.map((cutIn) => [cutIn.id, cutIn]));
  for (const cutInId of referenced) {
    if (!resolvedById.has(cutInId)) {
      fail(`CutIn が見つかりません: ${cutInId}`, cutInId);
    }
  }

  const targets = resolvedCutIns.filter((cutIn) => referenced.has(cutIn.id));
  const warnings: string[] = [];
  const preparedAssets = new Map<string, PreparedAsset>();

  for (const cutIn of targets) {
    await throwIfCancelled();
    if (preparedAssets.has(cutIn.assetId)) {
      continue;
    }
    const asset = assetById.get(cutIn.assetId);
    if (asset === undefined) {
      fail(`CutIn の素材が見つかりません: ${cutIn.assetId}`, cutIn.id);
    }
    if (asset.kind !== "video") {
      fail(`CutIn の素材が動画ではありません: ${cutIn.assetId}`, cutIn.id);
    }
    let prepared: PreparedAsset;
    try {
      prepared = await prepareAsset(asset, writer, config, dependencies);
    } catch (error) {
      if (
        error instanceof LiveExportError &&
        error.errorCode === "LIVE_EXPORT_CUT_IN_FAILED"
      ) {
        throw error;
      }
      const detail = error instanceof Error ? error.message : String(error);
      fail(
        `CutIn の準備に失敗しました: ${cutIn.id} (${detail})`,
        cutIn.id,
      );
    }
    await throwIfCancelled();
    warnings.push(...warningsForAsset(asset, prepared));
    preparedAssets.set(cutIn.assetId, prepared);
  }

  const cutIns = targets.map((cutIn) => {
    const prepared = preparedAssets.get(cutIn.assetId);
    if (prepared === undefined) {
      fail(`CutIn の準備結果が見つかりません: ${cutIn.id}`, cutIn.id);
    }
    return {
      id: cutIn.id,
      file: prepared.file,
      durationMs: prepared.durationMs,
      hasAudio: prepared.hasAudio,
      width: prepared.width,
      height: prepared.height,
    };
  });
  return { cutIns, warnings };
}
