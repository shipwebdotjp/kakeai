import {
  LIVE_EXPORT_SNAPSHOT_SCHEMA_VERSION,
  LIVE_EXPORTER_VERSION,
  liveExportProgramJobSnapshotSchema,
  liveProgramVersionDocumentSchema,
  liveResolutionSnapshotSchema,
  RENDITION_PURPOSE,
  type Job as JobDto,
  type LiveAssetSnapshot,
  type LiveCardAssetMediaType,
  type LiveExportProgramCharacter,
  type LiveExportProgramCharacterAppearance,
  type LiveExportProgramJobSnapshot,
  type LiveExportProgramRequest,
  type LiveResolutionSnapshot,
  type LiveVoiceProfileSnapshot,
  type SnapshotAssetRef,
  type SnapshotFaceSet,
} from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { toJob } from "../dto/mappers.ts";
import { ApiError } from "../http/errors.ts";
import { resourceNotFound } from "../http/validation.ts";
import { canonicalJson } from "../live/canonical-json.ts";
import { canonicalJsonSha256, sha256Hex } from "../live/hash.ts";
import { faceSetRevisionHash } from "../live/face-set-hash.ts";
import { assertUsableOutputDir } from "../live/output-dir.ts";
import { LiveExportError } from "../live/errors.ts";
import { validateLiveMaterialSnapshot } from "../live/prepare-live-materials.ts";
import { buildProgramVoices } from "../live/program-resolution.ts";
import { manifestFontsFromResolution } from "../live/theme-css.ts";
import { ThemeResolver } from "./theme-resolver.ts";
import { FontCatalogService, getSharedFontCatalogService } from "./font-catalog.ts";

const CARD_IMAGE_MEDIA_TYPES = new Set<LiveCardAssetMediaType>([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

function inputError(message: string, id: string | null = null): never {
  throw new ApiError(422, "VALIDATION_ERROR", message, id === null ? undefined : { id });
}

function assetNotFound(assetIds: string[]): never {
  throw new ApiError(422, "ASSET_NOT_FOUND", undefined, { assetIds });
}

function assetUnavailable(assetIds: string[]): never {
  throw new ApiError(422, "ASSET_UNAVAILABLE", undefined, { assetIds });
}

function internalError(message: string): never {
  throw new ApiError(500, "INTERNAL_ERROR", message);
}

/** Byte sizes are exposed as JS numbers; oversized values are a 422, not a 500. */
function safeByteSize(value: bigint, assetId: string): number {
  if (value < BigInt(0) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    inputError(
      `Asset のサイズが安全な整数の範囲を超えています: ${assetId}`,
      assetId,
    );
  }
  return Number(value);
}

function toSnapshotRef(asset: LiveAssetSnapshot): SnapshotAssetRef {
  return {
    assetId: asset.assetId,
    renditionId: asset.renditionId,
    sha256: asset.sha256,
    mediaType: asset.mediaType,
    byteSize: asset.byteSize,
    durationMs: asset.durationMs,
    widthPx: asset.widthPx,
    heightPx: asset.heightPx,
  };
}

/**
 * Re-checks the frozen snapshot against the current Asset rows. Missing rows
 * and renditions are reported as unavailable; changed metadata means the
 * version can no longer be exported without producing different bytes.
 */
async function loadAndValidateAssets(
  prisma: PrismaClient,
  snapshots: readonly LiveAssetSnapshot[],
  cardImageAssetIds: readonly string[],
): Promise<{ rows: Map<string, AssetRow>; refs: Map<string, SnapshotAssetRef> }> {
  const ids = [...new Set([...snapshots.map((asset) => asset.assetId), ...cardImageAssetIds])];
  const rows =
    ids.length === 0
      ? []
      : await prisma.asset.findMany({
          where: { id: { in: ids } },
          include: { renditions: true },
        });
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const missing = snapshots
    .map((asset) => asset.assetId)
    .filter((assetId) => !rowById.has(assetId));
  if (missing.length > 0) {
    assetNotFound([...new Set(missing)]);
  }
  const notReady = [...rowById.values()]
    .filter((row) => row.status !== "ready")
    .map((row) => row.id);
  if (notReady.length > 0) {
    assetUnavailable(notReady);
  }

  for (const snapshot of snapshots) {
    const row = rowById.get(snapshot.assetId);
    if (row === undefined) {
      assetUnavailable([snapshot.assetId]);
    }
    const source =
      snapshot.renditionId === null
        ? row
        : row.renditions.find((rendition) => rendition.id === snapshot.renditionId);
    if (source === undefined) {
      assetUnavailable([snapshot.assetId]);
    }
    const durationMs = source.durationMs ?? row.durationMs;
    const matches =
      row.kind === snapshot.kind &&
      source.sha256 === snapshot.sha256 &&
      source.mediaType === snapshot.mediaType &&
      safeByteSize(source.byteSize, snapshot.assetId) === snapshot.byteSize &&
      durationMs === snapshot.durationMs &&
      source.widthPx === snapshot.widthPx &&
      source.heightPx === snapshot.heightPx &&
      row.hasAudio === snapshot.hasAudio;
    if (!matches) {
      inputError(
        `Asset が版確定時の解決スナップショットと一致しません: ${snapshot.assetId}`,
        snapshot.assetId,
      );
    }
  }

  const cardIdsMissing = cardImageAssetIds.filter((assetId) => !rowById.has(assetId));
  if (cardIdsMissing.length > 0) {
    assetNotFound([...new Set(cardIdsMissing)]);
  }
  const refs = new Map<string, SnapshotAssetRef>();
  for (const snapshot of snapshots) {
    refs.set(snapshot.assetId, toSnapshotRef(snapshot));
  }
  for (const assetId of cardImageAssetIds) {
    const row = rowById.get(assetId);
    if (row === undefined) {
      assetNotFound([assetId]);
    }
    if (row.kind !== "image") {
      inputError(`カード画像 Asset が画像ではありません: ${assetId}`, assetId);
    }
    const rendition = row.renditions.find((entry) => entry.purpose === RENDITION_PURPOSE);
    const source = rendition ?? row;
    if (!CARD_IMAGE_MEDIA_TYPES.has(source.mediaType as LiveCardAssetMediaType)) {
      inputError(
        `カード画像の形式が非対応です: ${assetId} (${source.mediaType})`,
        assetId,
      );
    }
    if (
      source.widthPx === null ||
      source.heightPx === null ||
      source.widthPx <= 0 ||
      source.heightPx <= 0
    ) {
      inputError(`カード画像の寸法がありません: ${assetId}`, assetId);
    }
    refs.set(assetId, {
      assetId,
      renditionId: rendition?.id ?? null,
      sha256: source.sha256,
      mediaType: source.mediaType,
      byteSize: safeByteSize(source.byteSize, assetId),
      durationMs: rendition?.durationMs ?? row.durationMs,
      widthPx: source.widthPx,
      heightPx: source.heightPx,
    });
  }
  return { rows: rowById, refs };
}

type AssetRow = {
  id: string;
  kind: string;
  status: string;
  mediaType: string;
  sha256: string;
  byteSize: bigint;
  durationMs: number | null;
  widthPx: number | null;
  heightPx: number | null;
  hasAudio: boolean;
  renditions: Array<{
    id: string;
    purpose: string;
    sha256: string;
    mediaType: string;
    byteSize: bigint;
    durationMs: number | null;
    widthPx: number | null;
    heightPx: number | null;
  }>;
};

async function resolveCharacters(
  prisma: PrismaClient,
  snapshot: LiveResolutionSnapshot,
): Promise<{
  characters: LiveExportProgramCharacter[];
  faceSets: SnapshotFaceSet[];
}> {
  const ids = snapshot.characters.map((character) => character.characterId);
  const rows =
    ids.length === 0
      ? []
      : await prisma.character.findMany({
          where: { id: { in: ids } },
          include: { appearances: true },
        });
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const characters: LiveExportProgramCharacter[] = [];

  for (const character of snapshot.characters) {
    const row = rowById.get(character.characterId);
    if (row === undefined) {
      inputError(`キャラクターが見つかりません: ${character.characterId}`, character.characterId);
    }
    const appearances: LiveExportProgramCharacterAppearance[] = [];
    for (const appearance of character.appearances) {
      const rowAppearance = row.appearances.find((entry) => entry.id === appearance.id);
      if (rowAppearance === undefined) {
        inputError(
          `キャラクター外観が見つかりません: ${appearance.id}`,
          appearance.id,
        );
      }
      if (
        rowAppearance.assetId !== appearance.image.assetId ||
        rowAppearance.expression !== appearance.expression ||
        rowAppearance.pose !== appearance.pose ||
        rowAppearance.standingScale !== appearance.standing.scale ||
        rowAppearance.standingEdge !== appearance.standing.edge ||
        rowAppearance.standingVertical !== appearance.standing.vertical
      ) {
        inputError(
          `キャラクター外観が版確定時から変更されています: ${appearance.id}`,
          appearance.id,
        );
      }
      appearances.push({
        id: appearance.id,
        expression: appearance.expression,
        pose: appearance.pose,
        imageAssetId: appearance.image.assetId,
        faceSetId: appearance.faceSet?.id ?? null,
        faceSetVersion: appearance.faceSet?.version ?? null,
        standing: appearance.standing,
      });
    }
    characters.push({
      id: character.characterId,
      side: character.side,
      name: character.name,
      appearances,
    });
  }

  const faceSetKeys = new Map<
    string,
    { id: string; version: number; sha256: string }
  >();
  for (const character of snapshot.characters) {
    for (const appearance of character.appearances) {
      if (appearance.faceSet === null) {
        continue;
      }
      const key = `${appearance.faceSet.id}@${appearance.faceSet.version}`;
      faceSetKeys.set(key, {
        id: appearance.faceSet.id,
        version: appearance.faceSet.version,
        sha256: appearance.faceSet.sha256,
      });
    }
  }
  const revisions =
    faceSetKeys.size === 0
      ? []
      : await prisma.faceSetRevision.findMany({
          where: {
            OR: [...faceSetKeys.values()].map((entry) => ({
              faceSetId: entry.id,
              versionNumber: entry.version,
            })),
          },
          include: { layers: true, expressions: true, faceSet: true },
        });
  const revisionByKey = new Map(
    revisions.map((revision) => [
      `${revision.faceSetId}@${revision.versionNumber}`,
      revision,
    ]),
  );
  const faceSets: SnapshotFaceSet[] = [];
  for (const [key, expected] of faceSetKeys) {
    const revision = revisionByKey.get(key);
    if (revision === undefined) {
      inputError(`表情セットの版が見つかりません: ${key}`, expected.id);
    }
    if (faceSetRevisionHash(revision) !== expected.sha256) {
      inputError(`表情セットが版確定時から変更されています: ${key}`, expected.id);
    }
    faceSets.push({
      id: revision.faceSetId,
      version: revision.versionNumber,
      name: revision.faceSet.name,
      layers: revision.layers.map((layer) => ({
        id: layer.id,
        part: layer.part as SnapshotFaceSet["layers"][number]["part"],
        assetId: layer.assetId,
        blinkLayerId: layer.blinkLayerId,
        speakingLayerId: layer.speakingLayerId,
      })),
      expressions: revision.expressions.map((expression) => ({
        id: expression.id,
        name: expression.name,
        browLayerId: expression.browLayerId,
        eyeLayerId: expression.eyeLayerId,
        mouthLayerId: expression.mouthLayerId,
      })),
    });
  }

  return { characters, faceSets };
}

function referenceAudioOf(snapshot: LiveResolutionSnapshot): LiveAssetSnapshot[] {
  return snapshot.voices.flatMap((voice) =>
    voice.referenceAudio === null ? [] : [voice.referenceAudio],
  );
}

/**
 * Creates a `live_export` Job for an immutable Live Program Version. The Job
 * snapshot contains the document, its resolution snapshot and the display data
 * that characters.json needs, so the worker never reads a Work, Scene or
 * mutable program draft.
 */
export async function createProgramLiveExportJob(
  prisma: PrismaClient,
  input: LiveExportProgramRequest,
  fontCatalogService: FontCatalogService = getSharedFontCatalogService(),
): Promise<JobDto> {
  const row = await prisma.liveProgramVersion.findUnique({
    where: { id: input.programVersionId },
  });
  if (row === null) {
    throw resourceNotFound("live_program_version", input.programVersionId);
  }

  let document;
  try {
    document = liveProgramVersionDocumentSchema.parse(JSON.parse(row.documentJson));
  } catch {
    internalError("保存済みの Live Program Version を解釈できません。");
  }
  let resolutionSnapshot: LiveResolutionSnapshot;
  try {
    resolutionSnapshot = liveResolutionSnapshotSchema.parse(
      JSON.parse(row.resolutionSnapshotJson),
    );
  } catch {
    internalError("保存済みの解決スナップショットを解釈できません。");
  }
  if (sha256Hex(canonicalJson(document)) !== row.documentSha256) {
    internalError("Live Program Version の文書ハッシュが一致しません。");
  }
  if (sha256Hex(canonicalJson(resolutionSnapshot)) !== row.resolutionSnapshotSha256) {
    internalError("解決スナップショットのハッシュが一致しません。");
  }

  const theme = await new ThemeResolver(prisma).resolve(
    resolutionSnapshot.theme.id,
    resolutionSnapshot.theme.version,
  );
  if (theme === undefined) {
    inputError(
      `Visual Themeが見つかりません: ${resolutionSnapshot.theme.id}@${resolutionSnapshot.theme.version}`,
      resolutionSnapshot.theme.id,
    );
  }
  if (canonicalJsonSha256(theme) !== resolutionSnapshot.theme.sha256) {
    inputError(
      `Visual Themeが版確定時から変更されています: ${resolutionSnapshot.theme.id}@${resolutionSnapshot.theme.version}`,
      resolutionSnapshot.theme.id,
    );
  }

  const { characters, faceSets } = await resolveCharacters(prisma, resolutionSnapshot);
  let voices;
  try {
    voices = buildProgramVoices(document, resolutionSnapshot);
  } catch (error) {
    if (error instanceof LiveExportError) {
      inputError(error.message, error.failure.id);
    }
    throw error;
  }
  for (const side of ["left", "right"] as const) {
    const cast = document.cast[side];
    if (cast === null) {
      continue;
    }
    const voice = voices.bySide.get(side);
    if (voice === undefined) {
      inputError(`side ${side} の声スナップショットがありません。`, cast.voiceProfileId);
    }
    if (voice.voiceProfileId !== cast.voiceProfileId) {
      inputError(`side ${side} の声プロファイルが版と一致しません。`, cast.voiceProfileId);
    }
    const character = resolutionSnapshot.characters.find((entry) => entry.side === side);
    if (character === undefined || character.characterId !== cast.characterId) {
      inputError(`side ${side} のキャラクターが版と一致しません。`, cast.characterId);
    }
  }

  const assetSnapshots = new Map<string, LiveAssetSnapshot>();
  const addSnapshot = (asset: LiveAssetSnapshot): void => {
    const existing = assetSnapshots.get(asset.assetId);
    if (
      existing !== undefined &&
      canonicalJson(existing) !== canonicalJson(asset)
    ) {
      inputError(
        `同じ Asset に異なる解決スナップショットがあります: ${asset.assetId}`,
        asset.assetId,
      );
    }
    assetSnapshots.set(asset.assetId, asset);
  };
  for (const character of resolutionSnapshot.characters) {
    for (const appearance of character.appearances) {
      addSnapshot(appearance.image);
      for (const layer of appearance.faceSet?.layers ?? []) {
        addSnapshot(layer);
      }
    }
  }
  for (const asset of referenceAudioOf(resolutionSnapshot)) {
    addSnapshot(asset);
  }
  for (const audio of resolutionSnapshot.audioAssets) {
    addSnapshot(audio.asset);
  }
  for (const cutIn of resolutionSnapshot.cutIns) {
    addSnapshot(cutIn.asset);
  }
  for (const cardAsset of resolutionSnapshot.cardAssets) {
    addSnapshot(cardAsset.asset);
  }
  for (const material of resolutionSnapshot.materials) {
    for (const asset of material.assets) {
      addSnapshot(asset);
    }
  }

  // Card images are frozen in the resolution snapshot. Never re-resolve which
  // cards the document references: a version must always export the same bytes.
  const cardImageAssetIds = resolutionSnapshot.cardAssets.map(
    (cardAsset) => cardAsset.assetId,
  );
  for (const materialId of document.materials.map((material) => material.id)) {
    if (!resolutionSnapshot.materials.some((material) => material.materialId === materialId)) {
      inputError(`Live Material が解決スナップショットにありません: ${materialId}`, materialId);
    }
  }
  for (const cue of document.cues) {
    if (cue.audioAssetId === undefined) {
      continue;
    }
    const audio = resolutionSnapshot.audioAssets.find((entry) => entry.cueId === cue.id);
    if (audio === undefined || audio.asset.assetId !== cue.audioAssetId) {
      inputError(
        `音声 Asset が解決スナップショットと一致しません: ${cue.audioAssetId}`,
        cue.audioAssetId,
      );
    }
  }
  for (const cutIn of document.cutIns) {
    const snapshotCutIn = resolutionSnapshot.cutIns.find(
      (entry) => entry.cutInId === cutIn.id,
    );
    if (
      snapshotCutIn === undefined ||
      snapshotCutIn.asset.assetId !== cutIn.assetId
    ) {
      inputError(
        `CutIn が解決スナップショットと一致しません: ${cutIn.assetId}`,
        cutIn.assetId,
      );
    }
  }

  const loaded = await loadAndValidateAssets(
    prisma,
    [...assetSnapshots.values()],
    cardImageAssetIds,
  );
  const kindById = new Map(
    [...loaded.rows].map(([id, asset]) => [id, { kind: asset.kind }]),
  );
  for (const material of resolutionSnapshot.materials) {
    try {
      validateLiveMaterialSnapshot(material, kindById, theme);
    } catch (error) {
      if (error instanceof LiveExportError) {
        inputError(error.message, error.failure.id);
      }
      throw error;
    }
  }

  let fontResolution;
  try {
    fontResolution = await fontCatalogService.resolveThemeFonts(theme, {
      verify: true,
      locale: document.locale,
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

  await assertUsableOutputDir(input.outDir).catch((error) => {
    if (error instanceof LiveExportError) {
      throw new ApiError(409, "LIVE_EXPORT_OUTPUT_UNAVAILABLE", error.message);
    }
    throw error;
  });

  const voiceProfiles: LiveVoiceProfileSnapshot[] = [...voices.profiles.values()];
  const snapshot: LiveExportProgramJobSnapshot = {
    snapshotSchemaVersion: LIVE_EXPORT_SNAPSHOT_SCHEMA_VERSION,
    kind: "live_export",
    sourceKind: "program",
    programId: row.programId,
    programVersionId: row.id,
    programVersionNumber: row.versionNumber,
    programDocumentSha256: row.documentSha256,
    resolutionSnapshotSha256: row.resolutionSnapshotSha256,
    document,
    resolutionSnapshot,
    characters,
    faceSets,
    ...(input.fixture === undefined ? {} : { fixture: input.fixture }),
    outDir: input.outDir,
    exporterVersion: LIVE_EXPORTER_VERSION,
    theme,
    assets: [...loaded.refs.values()],
    voiceProfiles,
    fonts: manifestFontsFromResolution(fontResolution),
    fontDiagnostics: {
      missingFonts: fontResolution.missingFonts,
      diagnostics: fontResolution.diagnostics,
    },
  };

  let parsedSnapshot: LiveExportProgramJobSnapshot;
  try {
    parsedSnapshot = liveExportProgramJobSnapshotSchema.parse(snapshot);
  } catch {
    internalError("ライブ書き出しのスナップショットを組み立てられませんでした。");
  }
  const created = await prisma.job.create({
    data: {
      kind: "live_export",
      status: "queued",
      snapshotSchemaVersion: LIVE_EXPORT_SNAPSHOT_SCHEMA_VERSION,
      inputSnapshotJson: JSON.stringify(parsedSnapshot),
    },
    include: { artifacts: true },
  });
  return toJob(created);
}
