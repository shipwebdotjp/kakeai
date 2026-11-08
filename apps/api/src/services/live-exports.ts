import { createHash } from "node:crypto";
import {
  LIVE_EXPORT_SNAPSHOT_SCHEMA_VERSION,
  LIVE_EXPORTER_VERSION,
  liveExportJobSnapshotSchema,
  RENDITION_PURPOSE,
  type Job as JobDto,
  type LiveExportJobSnapshot,
  type LiveExportRequest,
  type LiveVoiceProfileSnapshot,
  type SnapshotAssetRef,
} from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { deserializeContent } from "../domain/content-json.ts";
import { bigIntToSafeNumber, toJob } from "../dto/mappers.ts";
import { ApiError } from "../http/errors.ts";
import { resourceNotFound } from "../http/validation.ts";
import type { AssetReference } from "@kakeai/contracts";
import {
  assertAssetsAvailable,
  assertFaceSetReferences,
  assertTakeDurations,
  loadAllReferences,
  renderSourceDurationMs,
  toSnapshotFaceSet,
  type AssetWithRenditions,
} from "./script-versions/references.ts";
import { collectFaceSetReferences } from "./script-versions/references.ts";
import { ThemeResolver } from "./theme-resolver.ts";
import { FontCatalogService, getSharedFontCatalogService } from "./font-catalog.ts";
import { canonicalJson } from "../live/canonical-json.ts";
import { LiveExportError } from "../live/errors.ts";
import { assertUsableOutputDir } from "../live/output-dir.ts";
import { validateMaterialScenes } from "../live/prepare-materials.ts";
import {
  resolveLiveProfile,
  type ResolvedAssetFile,
} from "../live/profile-resolution.ts";
import { manifestFontsFromResolution } from "../live/theme-css.ts";
import { localeSchema, voiceAdapterIdSchema, voiceProfileExtrasSchemaFor } from "@kakeai/contracts";

function inputError(message: string, id: string | null = null): never {
  throw new ApiError(422, "VALIDATION_ERROR", message, id === null ? undefined : { id });
}

function assetFile(asset: AssetWithRenditions): ResolvedAssetFile {
  return {
    assetId: asset.id,
    path: "",
    kind: asset.kind as ResolvedAssetFile["kind"],
    mediaType: asset.mediaType,
    sha256: asset.sha256,
    byteSize: bigIntToSafeNumber(asset.byteSize),
    durationMs: renderSourceDurationMs(asset),
    widthPx: asset.widthPx,
    heightPx: asset.heightPx,
    hasAudio: asset.hasAudio,
  };
}

function snapshotAsset(asset: AssetWithRenditions): SnapshotAssetRef {
  const rendition = asset.renditions.find((entry) => entry.purpose === RENDITION_PURPOSE);
  const source = rendition ?? asset;
  return {
    assetId: asset.id,
    renditionId: rendition?.id ?? null,
    sha256: source.sha256,
    mediaType: source.mediaType,
    byteSize: bigIntToSafeNumber(source.byteSize),
    durationMs: renderSourceDurationMs(asset),
    widthPx: source.widthPx,
    heightPx: source.heightPx,
  };
}

async function loadVoiceProfiles(
  prisma: PrismaClient,
  content: ReturnType<typeof deserializeContent>,
): Promise<Map<string, LiveVoiceProfileSnapshot>> {
  const ids = new Set<string>();
  for (const speaker of content.speakers) {
    if (speaker.voiceProfileId !== null) {
      ids.add(speaker.voiceProfileId);
    }
  }
  for (const character of content.characters) {
    for (const voice of character.voices) {
      ids.add(voice.voiceProfileId);
    }
  }
  if (ids.size === 0) {
    return new Map();
  }
  const rows = await prisma.voiceProfile.findMany({ where: { id: { in: [...ids] } } });
  const result = new Map<string, LiveVoiceProfileSnapshot>();
  for (const row of rows) {
    const adapter = voiceAdapterIdSchema.safeParse(row.adapterId);
    if (!adapter.success) {
      inputError(`未対応の音声アダプターです: ${row.id}`, row.id);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(row.settingsJson);
    } catch {
      inputError(`声プロファイルの設定を解釈できません: ${row.id}`, row.id);
    }
    const settings = voiceProfileExtrasSchemaFor(adapter.data).safeParse(raw);
    if (!settings.success) {
      inputError(`声プロファイルの設定が不正です: ${row.id}`, row.id);
    }
    const locale = localeSchema.safeParse(row.locale);
    if (!locale.success) {
      inputError(`声プロファイルのロケールが不正です: ${row.id}`, row.id);
    }
    result.set(row.id, {
      id: row.id,
      name: row.name,
      adapterId: adapter.data,
      voiceId: row.voiceId,
      locale: locale.data,
      settings: settings.data,
    });
  }
  for (const id of ids) {
    if (!result.has(id)) {
      inputError(`声プロファイルが見つかりません: ${id}`, id);
    }
  }
  return result;
}

function collectProfileAudioAssetIds(
  profile: LiveExportRequest["profile"],
  voiceProfiles: Map<string, LiveVoiceProfileSnapshot>,
): string[] {
  const ids = new Set<string>();
  for (const cue of profile.liveCues) {
    if (cue.audioAssetId !== undefined) {
      ids.add(cue.audioAssetId);
    }
  }
  for (const voice of voiceProfiles.values()) {
    const settings = voice.settings as Record<string, unknown>;
    if (typeof settings.refAudioAssetId === "string") {
      ids.add(settings.refAudioAssetId);
    }
  }
  return [...ids];
}

function collectProfileCutInAssetIds(
  profile: LiveExportRequest["profile"],
): string[] {
  return [...new Set(profile.cutIns.map((cutIn) => cutIn.assetId))];
}

/**
 * Loads Profile-only Assets (audio cues, CutIn videos) that are not part of the
 * script content. Missing rows become `ASSET_NOT_FOUND`; references keep the
 * caller-provided order so validation reports the same asset first.
 */
async function loadExtraAssets(
  prisma: PrismaClient,
  ids: string[],
  allowedKinds: AssetReference["allowedKinds"],
  pathPrefix: string,
): Promise<{ rows: AssetWithRenditions[]; references: AssetReference[] }> {
  if (ids.length === 0) {
    return { rows: [], references: [] };
  }
  const rows = await prisma.asset.findMany({
    where: { id: { in: ids } },
    include: { renditions: true },
  });
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const references: AssetReference[] = [];
  for (const assetId of ids) {
    if (!rowById.has(assetId)) {
      throw new ApiError(422, "ASSET_NOT_FOUND", undefined, { assetIds: [assetId] });
    }
    references.push({
      assetId,
      allowedKinds,
      path: [pathPrefix, assetId],
    });
  }
  return { rows, references };
}

function validateCharacterBindings(
  content: ReturnType<typeof deserializeContent>,
  profile: LiveExportRequest["profile"],
  voiceProfiles: Map<string, LiveVoiceProfileSnapshot>,
): void {
  for (const side of ["left", "right"] as const) {
    const characterId = profile.show.characters[side];
    if (characterId === null) {
      continue;
    }
    const character = content.characters.find((entry) => entry.id === characterId);
    if (character === undefined) {
      inputError(`キャラクターが見つかりません: ${characterId}`, characterId);
    }
    if (!character.appearances.some((appearance) => appearance.expression === "normal")) {
      inputError(`キャラクター ${characterId} に expression: normal の外観がありません。`, characterId);
    }
    const speaker = content.speakers.find((entry) => entry.characterId === characterId);
    if (speaker === undefined) {
      inputError(`キャラクター ${characterId} の話者が見つかりません。`, characterId);
    }
    if (speaker.voiceProfileId === null || !voiceProfiles.has(speaker.voiceProfileId)) {
      inputError(`キャラクター ${characterId} の声プロファイルが見つかりません。`, characterId);
    }
  }
}

function validateProfileCharacters(
  content: ReturnType<typeof deserializeContent>,
  faceSetByKey: Map<string, { expressions: { id: string }[] }>,
): void {
  for (const character of content.characters) {
    for (const appearance of character.appearances) {
      if (appearance.faceSetId === null) {
        continue;
      }
      const version = appearance.faceSetVersion ?? 1;
      const faceSet = faceSetByKey.get(`${appearance.faceSetId}@${version}`);
      if (faceSet === undefined) {
        inputError(`表情セットが見つかりません: ${appearance.faceSetId}@${version}`, appearance.faceSetId);
      }
      if (!faceSet.expressions.some((expression) => expression.id === "normal")) {
        inputError(`表情セットに normal がありません: ${appearance.faceSetId}@${version}`, appearance.faceSetId);
      }
    }
  }
}

export async function createLiveExportJob(
  prisma: PrismaClient,
  input: LiveExportRequest,
  fontCatalogService: FontCatalogService = getSharedFontCatalogService(),
): Promise<JobDto> {
  const row = await prisma.scriptVersion.findUnique({
    where: { id: input.scriptVersionId },
    include: {
      languageEdition: {
        select: {
          id: true,
          workId: true,
          work: { select: { id: true } },
        },
      },
    },
  });
  if (row === null) {
    throw resourceNotFound("script_version", input.scriptVersionId);
  }
  if (row.languageEdition.workId !== input.workId) {
    throw new ApiError(422, "VALIDATION_ERROR", "workId と ScriptVersion が一致しません。");
  }
  if (input.profile.test !== undefined && input.fixture === undefined) {
    throw new ApiError(422, "VALIDATION_ERROR", "test.fixture に対応する fixture がありません。");
  }

  let content;
  try {
    content = deserializeContent(row.contentJson);
  } catch {
    throw new ApiError(500, "INTERNAL_ERROR", "保存済みの台本を解釈できません。");
  }

  const themeResolver = new ThemeResolver(prisma);
  const theme = await themeResolver.resolve(content.visualTheme.id, content.visualTheme.version);
  if (theme === undefined) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      `Visual Themeが見つかりません: ${content.visualTheme.id}@${content.visualTheme.version}`,
    );
  }

  let fontResolution;
  try {
    fontResolution = await fontCatalogService.resolveThemeFonts(theme, {
      verify: true,
      locale: content.locale,
    });
  } catch (error) {
    fontResolution = {
      catalogSupported: false,
      verificationSupported: false,
      verificationReason: null,
      roles: [],
      missingFonts: [],
      diagnostics: [
        `Font診断を省略しました: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }

  const { references, assetById, faceSetByKey } = await loadAllReferences(prisma, content);
  assertAssetsAvailable(references, assetById);
  assertTakeDurations(content, assetById);
  assertFaceSetReferences(content, faceSetByKey, assetById);

  const voiceProfiles = await loadVoiceProfiles(prisma, content);
  validateProfileCharacters(content, faceSetByKey);
  validateCharacterBindings(content, input.profile, voiceProfiles);

  const extraAssetIds = collectProfileAudioAssetIds(input.profile, voiceProfiles);
  const cutInAssetIds = collectProfileCutInAssetIds(input.profile);
  const [extra, cutIn] = await Promise.all([
    loadExtraAssets(prisma, extraAssetIds, ["audio"], "liveCues"),
    loadExtraAssets(prisma, cutInAssetIds, ["video"], "cutIns"),
  ]);
  for (const asset of [...extra.rows, ...cutIn.rows]) {
    if (!assetById.has(asset.id)) {
      assetById.set(asset.id, asset);
    }
  }
  const allExtraReferences = [...extra.references, ...cutIn.references];
  assertAssetsAvailable([...references, ...allExtraReferences], assetById);

  const resolvedAssets = new Map<string, ResolvedAssetFile>();
  for (const [assetId, asset] of assetById) {
    resolvedAssets.set(assetId, assetFile(asset));
  }
  try {
    resolveLiveProfile(content, input.profile, resolvedAssets, voiceProfiles);
    validateMaterialScenes(input.profile, content, resolvedAssets);
  } catch (error) {
    if (error instanceof LiveExportError) {
      throw new ApiError(422, "VALIDATION_ERROR", error.message, error.failure);
    }
    throw error;
  }

  const snapshotAssets = [...new Set([...references, ...allExtraReferences].map((reference) => reference.assetId))]
    .map((assetId) => assetById.get(assetId))
    .filter((asset): asset is AssetWithRenditions => asset !== undefined)
    .map(snapshotAsset);

  const snapshotFaceSets = [...collectFaceSetReferences(content)].map((reference) => {
    const faceSet = faceSetByKey.get(`${reference.faceSetId}@${reference.version}`);
    if (faceSet === undefined) {
      throw new ApiError(500, "INTERNAL_ERROR", "表情セットを解決できません。");
    }
    return toSnapshotFaceSet(faceSet);
  });

  await assertUsableOutputDir(input.outDir).catch((error) => {
    if (error instanceof LiveExportError) {
      throw new ApiError(409, "LIVE_EXPORT_OUTPUT_UNAVAILABLE", error.message);
    }
    throw error;
  });

  const profileSha256 = createHash("sha256")
    .update(canonicalJson(input.profile), "utf8")
    .digest("hex");

  const snapshot: LiveExportJobSnapshot = {
    snapshotSchemaVersion: LIVE_EXPORT_SNAPSHOT_SCHEMA_VERSION,
    kind: "live_export",
    workId: row.languageEdition.workId,
    languageEditionId: row.languageEdition.id,
    scriptVersionId: row.id,
    versionNumber: row.versionNumber,
    locale: content.locale,
    content,
    profile: input.profile,
    profileSha256,
    ...(input.fixture === undefined ? {} : { fixture: input.fixture }),
    outDir: input.outDir,
    exporterVersion: LIVE_EXPORTER_VERSION,
    theme,
    assets: snapshotAssets,
    faceSets: snapshotFaceSets,
    voiceProfiles: [...voiceProfiles.values()],
    fonts: manifestFontsFromResolution(fontResolution),
    fontDiagnostics: {
      missingFonts: fontResolution.missingFonts,
      diagnostics: fontResolution.diagnostics,
    },
  };

  let parsedSnapshot: LiveExportJobSnapshot;
  try {
    parsedSnapshot = liveExportJobSnapshotSchema.parse(snapshot);
  } catch {
    throw new ApiError(
      500,
      "INTERNAL_ERROR",
      "ライブ書き出しのスナップショットを組み立てられませんでした。",
    );
  }
  const created = await prisma.job.create({
    data: {
      kind: "live_export",
      status: "queued",
      workId: row.languageEdition.workId,
      languageEditionId: row.languageEdition.id,
      scriptVersionId: row.id,
      snapshotSchemaVersion: LIVE_EXPORT_SNAPSHOT_SCHEMA_VERSION,
      inputSnapshotJson: JSON.stringify(parsedSnapshot),
    },
    include: { artifacts: true },
  });
  return toJob(created);
}
