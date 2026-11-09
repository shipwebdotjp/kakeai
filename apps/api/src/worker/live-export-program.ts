import { createHash } from "node:crypto";
import { mkdtemp, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  LIVE_CARD_SCHEMA_VERSION,
  LIVE_PROGRAM_PACKAGE_SCHEMA_VERSION,
  collectReferencedLiveCards,
  liveCharacterSheetSchema,
  liveExtensionForMediaType,
  livePackageManifestSchema,
  livePackageShowSchema,
  type LiveCardAsset,
  type LiveCardAssetMediaType,
  type LiveExportProgramJobSnapshot,
  type LiveExportResult,
  type LiveManifestVoice,
  type LivePackageManifest,
  type LivePackageShow,
} from "@kakeai/contracts";
import { hashFile } from "../storage/asset-store.ts";
import type { AppConfig } from "../config.ts";
import type { Job, PrismaClient } from "../generated/prisma/client.ts";
import { logger } from "../logger.ts";
import { canonicalJson } from "../live/canonical-json.ts";
import { LiveExportError } from "../live/errors.ts";
import { loadSnapshotAssets } from "../live/load-assets.ts";
import { assertUsableOutputDir } from "../live/output-dir.ts";
import { PackageWriter } from "../live/package-writer.ts";
import { prepareAudio } from "../live/prepare-audio.ts";
import { prepareCutIns } from "../live/prepare-cut-ins.ts";
import { prepareLiveMaterialCards } from "../live/prepare-live-materials.ts";
import { prepareProgramCharacters } from "../live/prepare-program-characters.ts";
import { prepareVoices, voiceForSpeaker } from "../live/prepare-voices.ts";
import { buildProgramResolution } from "../live/program-resolution.ts";
import { buildThemeCss } from "../live/theme-css.ts";
import { verifyPackage } from "../live/verify-package.ts";
import {
  failJob,
  isJobCancelled,
  succeedJob,
  updateProgress,
  type LiveExportJobDependencies,
} from "./live-export-common.ts";

const CARD_IMAGE_MEDIA_TYPES = new Set<LiveCardAssetMediaType>([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

function fail(message: string, id: string | null = null): never {
  throw new LiveExportError("LIVE_EXPORT_FAILED", "manifest", message, id);
}

function packageIdForProgram(
  snapshot: LiveExportProgramJobSnapshot,
  jobId: string,
): string {
  const digest = createHash("sha256")
    .update(
      canonicalJson({
        exporterVersion: snapshot.exporterVersion,
        programVersionId: snapshot.programVersionId,
        buildId: jobId,
      }),
      "utf8",
    )
    .digest("hex");
  return `livepkg-${digest.slice(0, 24)}`;
}

async function writeCardAssets(
  snapshot: LiveExportProgramJobSnapshot,
  assetById: Map<string, import("../live/resolved-assets.ts").ResolvedAssetFile>,
  writer: PackageWriter,
): Promise<LiveCardAsset[]> {
  // The version-pinned list also decides which files may be written. Reading
  // the document's card ids here would let a later document edit select
  // different bytes than the ones the resolution snapshot froze.
  const cardAssets: LiveCardAsset[] = [];
  for (const pinned of snapshot.resolutionSnapshot.cardAssets) {
    const assetId = pinned.assetId;
    const asset = assetById.get(assetId);
    if (asset === undefined) {
      fail(`カード画像が見つかりません: ${assetId}`, assetId);
    }
    if (pinned.asset.kind !== "image" || asset.kind !== "image") {
      fail(`カード画像が画像ではありません: ${assetId}`, assetId);
    }
    const mediaType = pinned.asset.mediaType as LiveCardAssetMediaType;
    if (!CARD_IMAGE_MEDIA_TYPES.has(mediaType)) {
      fail(`カード画像の形式が非対応です: ${assetId} (${mediaType})`, assetId);
    }
    if (pinned.asset.widthPx === null || pinned.asset.heightPx === null) {
      fail(`カード画像の寸法がありません: ${assetId}`, assetId);
    }
    if (
      asset.sha256 !== pinned.asset.sha256 ||
      asset.mediaType !== pinned.asset.mediaType ||
      asset.byteSize !== pinned.asset.byteSize
    ) {
      fail(`カード画像が版確定時のスナップショットと一致しません: ${assetId}`, assetId);
    }
    const file = `cards/${assetId}.${liveExtensionForMediaType(mediaType)}`;
    await writer.copyFile(asset.path, file, {
      mediaType,
      kind: "card-asset",
      durationMs: null,
      width: pinned.asset.widthPx,
      height: pinned.asset.heightPx,
      hasAudio: false,
    });
    cardAssets.push({
      id: assetId,
      file,
      mediaType,
      width: pinned.asset.widthPx,
      height: pinned.asset.heightPx,
    });
  }
  return cardAssets;
}

function packageSegments(snapshot: LiveExportProgramJobSnapshot) {
  return snapshot.document.segments.map((segment) => {
    if (segment.kind === "cut_in") {
      return {
        id: segment.id,
        kind: "cut_in" as const,
        label: segment.label,
        cutInId: segment.cutInId,
      };
    }
    if (segment.kind === "comment") {
      return {
        id: segment.id,
        kind: "comment" as const,
        label: segment.label,
        targetDurationMs: segment.targetDurationMs,
        ...(segment.commentPolicy === undefined
          ? {}
          : { commentPolicy: segment.commentPolicy }),
        ...(segment.visual === undefined ? {} : { visual: segment.visual }),
      };
    }
    return {
      id: segment.id,
      kind: segment.kind,
      label: segment.label,
      targetDurationMs: segment.targetDurationMs,
      cues: segment.cues,
      ...(segment.visual === undefined ? {} : { visual: segment.visual }),
    };
  });
}

export async function processProgramLiveExportJob(
  prisma: PrismaClient,
  config: AppConfig,
  job: Job,
  snapshot: LiveExportProgramJobSnapshot,
  dependencies: LiveExportJobDependencies,
): Promise<void> {
  const isCancelled = dependencies.isCancelled ?? ((jobId: string) => isJobCancelled(prisma, jobId));
  let tempDir: string | undefined;
  let committed = false;
  const warnings: string[] = [];
  let preparedCueCount: number | null = null;
  let manifestSha256: string | null = null;
  let packageId: string | null = null;

  try {
    await assertUsableOutputDir(snapshot.outDir);
    // Create a unique staging directory next to the output. A deterministic
    // name would let two workers delete each other's build; rename below
    // refuses to replace a directory that appeared concurrently.
    tempDir = await mkdtemp(
      join(dirname(snapshot.outDir), `.${basename(snapshot.outDir)}.live-export-`),
    );
    const writer = new PackageWriter(tempDir);

    await updateProgress(prisma, job.id, 10);
    const assetById = await loadSnapshotAssets(prisma, config, snapshot.assets);
    if (snapshot.document.safety === undefined) {
      throw new LiveExportError(
        "LIVE_EXPORT_INPUT_INVALID",
        "input",
        "show.json を作るには safety が必要です。",
      );
    }
    const voiceProfiles = new Map(snapshot.voiceProfiles.map((profile) => [profile.id, profile]));
    const resolved = buildProgramResolution(
      snapshot.document,
      snapshot.resolutionSnapshot,
      assetById,
    );

    if (await isCancelled(job.id)) {
      throw new LiveExportError("LIVE_EXPORT_FAILED", "output", "書き出しがキャンセルされました。");
    }
    const voices = await prepareVoices(resolved, voiceProfiles, assetById, writer, config, {
      ...(dependencies.adapterFor === undefined ? {} : { adapterFor: dependencies.adapterFor }),
      isCancelled: () => isCancelled(job.id),
    });
    await updateProgress(prisma, job.id, 25);

    const characters = await prepareProgramCharacters(
      snapshot.characters,
      snapshot.faceSets,
      assetById,
      resolved.speakers,
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

    const materials = await prepareLiveMaterialCards(
      snapshot.resolutionSnapshot.materials,
      snapshot.theme,
      assetById,
      writer,
      {
        ...(dependencies.rasterizer === undefined ? {} : { rasterizer: dependencies.rasterizer }),
        ...(dependencies.renderMp4 === undefined ? {} : { renderMp4: dependencies.renderMp4 }),
        workDir: tempDir,
        isCancelled: () => isCancelled(job.id),
      },
    );
    const cutInIds = snapshot.document.segments
      .filter((segment) => segment.kind === "cut_in")
      .map((segment) => segment.cutInId);
    const preparedCutIns = await prepareCutIns(
      cutInIds,
      resolved.cutIns,
      assetById,
      writer,
      config,
      { isCancelled: () => isCancelled(job.id) },
    );
    warnings.push(...preparedCutIns.warnings);
    if (snapshot.fontDiagnostics !== undefined) {
      if (snapshot.fontDiagnostics.missingFonts.length > 0) {
        warnings.push(
          `フォントが見つかりません: ${snapshot.fontDiagnostics.missingFonts.join(", ")}`,
        );
      }
      warnings.push(...(snapshot.fontDiagnostics.diagnostics ?? []));
    }
    await updateProgress(prisma, job.id, 85);

    await writer.writeText("theme.css", buildThemeCss(snapshot.theme, snapshot.document.locale), {
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

    const cardAssets = await writeCardAssets(snapshot, assetById, writer);
    const speakers = resolved.speakers.map((speaker) => ({
      id: speaker.id,
      name: speaker.name,
      side: speaker.side,
      characterId: speaker.characterId,
      voice: voiceForSpeaker(speaker, voices),
    }));
    const rawShow = {
      schemaVersion: 2 as const,
      show: {
        title: snapshot.document.title,
        locale: snapshot.document.locale,
        targetDurationMs: snapshot.document.targetDurationMs,
        stageTemplate: snapshot.document.stageTemplate,
        theme: "theme.css" as const,
        characters: {
          left: snapshot.document.cast.left.characterId,
          right: snapshot.document.cast.right?.characterId ?? null,
        },
      },
      segments: packageSegments(snapshot),
      cues,
      materials,
      cards: collectReferencedLiveCards(snapshot.document),
      cardAssets,
      cutIns: preparedCutIns.cutIns,
      speakers,
      commentPolicy: snapshot.document.commentPolicy,
      safety: snapshot.document.safety,
      playout: snapshot.document.playout,
    };
    let parsedShow: LivePackageShow;
    try {
      parsedShow = livePackageShowSchema.parse(rawShow);
    } catch (error) {
      throw new LiveExportError(
        "LIVE_EXPORT_FAILED",
        "manifest",
        `show.json が不正です: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await writer.writeJson("show.json", parsedShow, {
      mediaType: "application/json",
      kind: "show",
      hasAudio: false,
    });
    await updateProgress(prisma, job.id, 90);

    packageId = packageIdForProgram(snapshot, job.id);
    const manifestVoices: LiveManifestVoice[] = voices.manifestVoices;
    let manifest: LivePackageManifest;
    try {
      manifest = livePackageManifestSchema.parse({
        packageSchemaVersion: LIVE_PROGRAM_PACKAGE_SCHEMA_VERSION,
        exporterVersion: snapshot.exporterVersion,
        packageId,
        createdAt: new Date().toISOString(),
        source: {
          programId: snapshot.programId,
          programVersionId: snapshot.programVersionId,
          programVersionNumber: snapshot.programVersionNumber,
          programDocumentSha256: snapshot.programDocumentSha256,
          resolutionSnapshotSha256: snapshot.resolutionSnapshotSha256,
          theme: {
            id: snapshot.resolutionSnapshot.theme.id,
            version: snapshot.resolutionSnapshot.theme.version,
          },
        },
        cardSchemaVersion: LIVE_CARD_SCHEMA_VERSION,
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
    try {
      await rename(tempDir, snapshot.outDir);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST" || code === "ENOTEMPTY" || code === "ENOTDIR") {
        throw new LiveExportError(
          "LIVE_EXPORT_OUTPUT_UNAVAILABLE",
          "output",
          `出力先が同時に作成されました: ${snapshot.outDir}`,
        );
      }
      throw error;
    }
    // The staging directory now belongs to outDir; do not remove it in catch.
    tempDir = undefined;
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
    await succeedJob(prisma, job, snapshot, result);
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
