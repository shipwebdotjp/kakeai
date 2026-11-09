import {
  LEGACY_FACE_SET_VERSION,
  NORMAL_EXPRESSION_ID,
  collectLiveProgramAssetReferences,
  liveMaterialProvenanceSchema,
  liveMaterialSnapshotSchema,
  liveResolutionSnapshotSchema,
  voiceAdapterIdSchema,
  voiceProfileExtrasSchemaFor,
  type LiveAssetSnapshot,
  type LiveMaterialProvenance,
  type LiveMaterialSnapshot,
  type LiveProgramDocument,
  type LiveResolutionSnapshot,
  type LiveSide,
  type VisualThemeDefinition,
  type VoiceAdapterId,
} from "@kakeai/contracts";
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { validationError, type ValidationIssue } from "../http/validation.ts";
import { canonicalJson } from "./canonical-json.ts";
import { canonicalJsonSha256, sha256Hex } from "./hash.ts";
import { faceSetRevisionHash } from "./face-set-hash.ts";
import { renditionOf, toLiveAssetSnapshot, type AssetWithRenditions } from "./asset-snapshot.ts";
import { ThemeResolver } from "../services/theme-resolver.ts";

type LiveDb = PrismaClient | Prisma.TransactionClient;

type CharacterRow = Prisma.CharacterGetPayload<{
  include: { appearances: true; names: true };
}>;
type FaceSetRow = Prisma.FaceSetRevisionGetPayload<{
  include: { layers: true; expressions: true; faceSet: true };
}>;
type MaterialRow = Prisma.LiveMaterialGetPayload<object>;

const CARD_IMAGE_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const LIVE_IMAGE_MEDIA_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/avif",
]);

interface AssetUse {
  kind: string;
  path: (string | number)[];
  requireRendition: boolean;
  mediaTypes: ReadonlySet<string> | null;
}

interface AssetRequirement {
  uses: AssetUse[];
}

interface ResolvedMaterial {
  row: MaterialRow;
  snapshot: LiveMaterialSnapshot;
  provenance: LiveMaterialProvenance;
}

interface ResolvedVoice {
  side: LiveSide;
  characterId: string;
  voiceProfileId: string;
  adapterId: VoiceAdapterId;
  voiceId: string;
  settings: Record<string, unknown>;
  refAudioAssetId: string | null;
}

function assetSnapshot(asset: AssetWithRenditions): LiveAssetSnapshot {
  return toLiveAssetSnapshot(asset);
}

function themeHash(theme: VisualThemeDefinition): string {
  return canonicalJsonSha256(theme);
}

/** Oversized DB byte sizes are reported as a validation issue, never a 500. */
function byteSizeMatches(value: bigint, expected: number): boolean {
  return (
    value >= BigInt(0) &&
    value <= BigInt(Number.MAX_SAFE_INTEGER) &&
    Number(value) === expected
  );
}

/**
 * Resolves every mutable reference of a draft into immutable hashes. All
 * missing or unusable references are collected so the caller can show every
 * problem at once as a 422 VALIDATION_ERROR.
 */
export async function resolveLiveProgramVersion(
  db: LiveDb,
  programId: string,
  document: LiveProgramDocument,
): Promise<LiveResolutionSnapshot> {
  const issues: ValidationIssue[] = [];
  const issue = (path: (string | number)[], message: string): void => {
    issues.push({ path, code: "custom", message });
  };
  const requirements = new Map<string, AssetRequirement>();
  const requireAsset = (
    assetId: string,
    kind: string,
    path: (string | number)[],
    options: { requireRendition?: boolean; imageMediaTypes?: ReadonlySet<string> } = {},
  ): void => {
    const use: AssetUse = {
      kind,
      path,
      requireRendition: options.requireRendition ?? false,
      mediaTypes: options.imageMediaTypes ?? null,
    };
    const existing = requirements.get(assetId);
    if (existing === undefined) {
      requirements.set(assetId, { uses: [use] });
      return;
    }
    existing.uses.push(use);
  };

  const theme = await new ThemeResolver(db).resolve(
    document.theme.id,
    document.theme.version,
  );
  if (theme === undefined) {
    issue(
      ["theme"],
      `Visual Themeが見つかりません: ${document.theme.id}@${document.theme.version}`,
    );
  }

  const characterIds = [
    document.cast.left.characterId,
    document.cast.right?.characterId,
  ].filter((id): id is string => id !== undefined);
  const characterRows = await db.character.findMany({
    where: { id: { in: characterIds } },
    include: { appearances: true, names: true },
  });
  const characterById = new Map(characterRows.map((row) => [row.id, row]));

  const faceSetIds = new Set<string>();
  for (const character of characterRows) {
    for (const appearance of character.appearances) {
      requireAsset(appearance.assetId, "image", [
        "cast",
        character.id,
        "appearances",
        appearance.id,
        "assetId",
      ], { imageMediaTypes: LIVE_IMAGE_MEDIA_TYPES });
      if (appearance.faceSetId !== null) {
        faceSetIds.add(appearance.faceSetId);
      }
    }
  }
  const latestFaceSetVersions = faceSetIds.size === 0
    ? []
    : await db.faceSetRevision.groupBy({
        by: ["faceSetId"],
        where: { faceSetId: { in: [...faceSetIds] } },
        _max: { versionNumber: true },
      });
  const faceSetRows = latestFaceSetVersions.length === 0
    ? []
    : await db.faceSetRevision.findMany({
        where: {
          OR: latestFaceSetVersions.map((row) => ({
            faceSetId: row.faceSetId,
            versionNumber: row._max.versionNumber ?? 1,
          })),
        },
        include: { layers: true, expressions: true, faceSet: true },
      });
  const latestFaceSetByFaceSetId = new Map(
    faceSetRows.map((revision) => [revision.faceSetId, revision]),
  );
  // Library Characters always render the latest revision, so older revisions
  // must not make version finalization fail.
  for (const revision of latestFaceSetByFaceSetId.values()) {
    for (const layer of revision.layers) {
      requireAsset(layer.assetId, "image", [
        "faceSets",
        revision.faceSetId,
        String(revision.versionNumber),
        "layers",
        layer.id,
        "assetId",
      ], { imageMediaTypes: LIVE_IMAGE_MEDIA_TYPES });
    }
  }

  const voiceProfileIds = [
    document.cast.left.voiceProfileId,
    document.cast.right?.voiceProfileId,
  ].filter((id): id is string => id !== undefined);
  const voiceProfileRows = await db.voiceProfile.findMany({
    where: { id: { in: voiceProfileIds } },
  });
  const voiceProfileById = new Map(
    voiceProfileRows.map((row) => [row.id, row]),
  );
  const resolvedVoices: ResolvedVoice[] = [];

  for (const side of ["left", "right"] as const) {
    const cast = document.cast[side];
    if (cast === null) {
      continue;
    }
    const character = characterById.get(cast.characterId);
    if (character === undefined) {
      issue(["cast", side, "characterId"], `キャラクターが見つかりません: ${cast.characterId}`);
    } else if (
      !character.appearances.some(
        (appearance) => appearance.expression === NORMAL_EXPRESSION_ID,
      )
    ) {
      issue(
        ["cast", side, "characterId"],
        `キャラクターに expression: normal の外観がありません: ${cast.characterId}`,
      );
    }
    if (character !== undefined) {
      for (const appearance of character.appearances) {
        if (appearance.faceSetId === null) {
          continue;
        }
        const faceSet = latestFaceSetByFaceSetId.get(appearance.faceSetId);
        if (faceSet === undefined) {
          issue(
            ["cast", side, "characterId"],
            `表情セットの版が見つかりません: ${appearance.faceSetId}@${LEGACY_FACE_SET_VERSION} 以降`,
          );
          continue;
        }
        if (!faceSet.expressions.some((preset) => preset.id === appearance.expression)) {
          issue(
            ["cast", side, "characterId"],
            `表情 ${appearance.expression} が表情セットにありません: ${appearance.faceSetId}`,
          );
        }
      }
    }

    const profile = voiceProfileById.get(cast.voiceProfileId);
    if (profile === undefined) {
      issue(
        ["cast", side, "voiceProfileId"],
        `声プロファイルが見つかりません: ${cast.voiceProfileId}`,
      );
      continue;
    }
    const adapter = voiceAdapterIdSchema.safeParse(profile.adapterId);
    if (!adapter.success) {
      issue(
        ["cast", side, "voiceProfileId"],
        `未対応の音声アダプターです: ${profile.adapterId}`,
      );
      continue;
    }
    let rawSettings: unknown;
    try {
      rawSettings = JSON.parse(profile.settingsJson);
    } catch {
      issue(
        ["cast", side, "voiceProfileId"],
        `声プロファイルの設定を解釈できません: ${profile.id}`,
      );
      continue;
    }
    const settings = voiceProfileExtrasSchemaFor(adapter.data).safeParse(rawSettings);
    if (!settings.success) {
      issue(
        ["cast", side, "voiceProfileId"],
        `声プロファイルの設定が不正です: ${profile.id}`,
      );
      continue;
    }
    const rawRecord = settings.data as Record<string, unknown>;
    const refAudioAssetId =
      typeof rawRecord.refAudioAssetId === "string"
        ? rawRecord.refAudioAssetId
        : null;
    if (refAudioAssetId !== null) {
      requireAsset(refAudioAssetId, "audio", [
        "cast",
        side,
        "voiceProfileId",
      ]);
    }
    const sanitized: Record<string, unknown> = { ...rawRecord };
    delete sanitized.refAudioAssetId;
    resolvedVoices.push({
      side,
      characterId: cast.characterId,
      voiceProfileId: profile.id,
      adapterId: adapter.data,
      voiceId: profile.voiceId,
      settings: sanitized,
      refAudioAssetId,
    });
  }

  const documentAssets = collectLiveProgramAssetReferences(document);
  for (const [index, assetId] of documentAssets.cardImageAssetIds.entries()) {
    requireAsset(assetId, "image", ["cards", index, "states"], {
      imageMediaTypes: CARD_IMAGE_MEDIA_TYPES,
    });
  }
  for (const [index, cue] of document.cues.entries()) {
    if (cue.audioAssetId !== undefined) {
      requireAsset(cue.audioAssetId, "audio", ["cues", index, "audioAssetId"], {
        requireRendition: true,
      });
    }
  }
  for (const [index, cutIn] of document.cutIns.entries()) {
    requireAsset(cutIn.assetId, "video", ["cutIns", index, "assetId"]);
  }

  const materialIds = document.materials.map((material) => material.id);
  const materialRows = materialIds.length === 0
    ? []
    : await db.liveMaterial.findMany({ where: { id: { in: materialIds } } });
  const materialById = new Map(materialRows.map((row) => [row.id, row]));
  const resolvedMaterials: ResolvedMaterial[] = [];
  for (const [index, reference] of document.materials.entries()) {
    const row = materialById.get(reference.id);
    if (row === undefined) {
      issue(["materials", index, "id"], `Live Material が見つかりません: ${reference.id}`);
      continue;
    }
    if (row.programId !== programId) {
      issue(
        ["materials", index, "id"],
        `Live Material が別のプログラムに属しています: ${reference.id}`,
      );
      continue;
    }
    let snapshot: LiveMaterialSnapshot;
    let provenance: LiveMaterialProvenance;
    try {
      snapshot = liveMaterialSnapshotSchema.parse(JSON.parse(row.snapshotJson));
      provenance = liveMaterialProvenanceSchema.parse(
        JSON.parse(row.provenanceJson),
      );
    } catch {
      issue(
        ["materials", index, "id"],
        `Live Material のスナップショットが壊れています: ${reference.id}`,
      );
      continue;
    }
    for (const [assetIndex, asset] of snapshot.assets.entries()) {
      requireAsset(asset.assetId, asset.kind, [
        "materials",
        index,
        "assets",
        assetIndex,
      ], {
        imageMediaTypes:
          asset.kind === "image" ? LIVE_IMAGE_MEDIA_TYPES : undefined,
      });
    }
    resolvedMaterials.push({ row, snapshot, provenance });
  }

  const assetIds = [...requirements.keys()];
  const assetRows = assetIds.length === 0
    ? []
    : await db.asset.findMany({
        where: { id: { in: assetIds } },
        include: { renditions: true },
      });
  const assetById = new Map(assetRows.map((row) => [row.id, row]));
  for (const [assetId, requirement] of requirements) {
    const asset = assetById.get(assetId);
    for (const use of requirement.uses) {
      if (asset === undefined) {
        issue(use.path, `Asset が見つかりません: ${assetId}`);
        continue;
      }
      if (asset.status !== "ready") {
        issue(use.path, `Asset が ready ではありません: ${assetId}`);
        continue;
      }
      if (asset.kind !== use.kind) {
        issue(use.path, `Asset の種類が用途と一致しません: ${assetId}`);
      }
      if (use.mediaTypes !== null && !use.mediaTypes.has(asset.mediaType)) {
        issue(use.path, `画像 Asset の形式が非対応です: ${assetId} (${asset.mediaType})`);
      }
      if (use.requireRendition && renditionOf(asset) === undefined) {
        issue(use.path, `音声 Asset に準備済み Rendition がありません: ${assetId}`);
      }
    }
  }

  // Live Material asset snapshots are frozen at import. Their current DB rows
  // must still resolve, and every captured media fact must still match.
  for (const [index, material] of resolvedMaterials.entries()) {
    for (const [assetIndex, snapshotAsset] of material.snapshot.assets.entries()) {
      const asset = assetById.get(snapshotAsset.assetId);
      if (asset === undefined) {
        continue;
      }
      const path = ["materials", index, "assets", assetIndex];
      const rendition =
        snapshotAsset.renditionId === null
          ? undefined
          : asset.renditions.find(
              (entry) => entry.id === snapshotAsset.renditionId,
            );
      if (snapshotAsset.renditionId !== null && rendition === undefined) {
        issue(path, `Live Material の Rendition が見つかりません: ${snapshotAsset.assetId}`);
        continue;
      }
      const source = rendition ?? asset;
      const matches =
        source.sha256 === snapshotAsset.sha256 &&
        source.mediaType === snapshotAsset.mediaType &&
        byteSizeMatches(source.byteSize, snapshotAsset.byteSize) &&
        (rendition?.durationMs ?? asset.durationMs) === snapshotAsset.durationMs &&
        source.widthPx === snapshotAsset.widthPx &&
        source.heightPx === snapshotAsset.heightPx &&
        asset.hasAudio === snapshotAsset.hasAudio;
      if (!matches) {
        issue(
          path,
          `Live Material の Asset スナップショットが現在の Asset と一致しません: ${snapshotAsset.assetId}`,
        );
      }
    }
  }

  if (issues.length > 0) {
    throw validationError(issues);
  }
  if (theme === undefined) {
    // The theme issue above already throws; this only narrows the type.
    throw validationError([
      { path: ["theme"], code: "custom", message: "Theme を解決できません。" },
    ]);
  }

  const snapshotOf = (
    assetId: string,
    path: (string | number)[],
  ): LiveAssetSnapshot => {
    const row = assetById.get(assetId);
    if (row === undefined) {
      throw validationError([
        { path, code: "custom", message: `Asset が見つかりません: ${assetId}` },
      ]);
    }
    return assetSnapshot(row);
  };

  const snapshot = liveResolutionSnapshotSchema.safeParse({
    schemaVersion: 1,
    theme: {
      id: theme.id,
      version: theme.version,
      sha256: themeHash(theme),
    },
    characters: (["left", "right"] as const).flatMap((side) => {
      const cast = document.cast[side];
      if (cast === null) {
        return [];
      }
      const character = characterById.get(cast.characterId);
      if (character === undefined) {
        return [];
      }
      return [
        {
          side,
          characterId: cast.characterId,
          name:
            character.names.find((entry) => entry.locale === document.locale)?.name ??
            character.name,
          appearances: character.appearances.map((appearance) => {
            const faceSet =
              appearance.faceSetId === null
                ? undefined
                : latestFaceSetByFaceSetId.get(appearance.faceSetId);
            return {
              id: appearance.id,
              expression: appearance.expression,
              pose: appearance.pose,
              standing: {
                scale: appearance.standingScale,
                edge: appearance.standingEdge,
                vertical: appearance.standingVertical,
              },
              image: snapshotOf(appearance.assetId, [
                "cast",
                side,
                "appearances",
                appearance.id,
                "assetId",
              ]),
              faceSet:
                faceSet === undefined
                  ? null
                  : {
                      id: faceSet.faceSetId,
                      version: faceSet.versionNumber,
                      sha256: faceSetRevisionHash(faceSet),
                      layers: faceSet.layers.map((layer) =>
                        snapshotOf(layer.assetId, [
                          "faceSets",
                          faceSet.faceSetId,
                          String(faceSet.versionNumber),
                          "layers",
                          layer.id,
                          "assetId",
                        ]),
                      ),
                    },
            };
          }),
        },
      ];
    }),
    voices: resolvedVoices.map((voice) => ({
      side: voice.side,
      characterId: voice.characterId,
      voiceProfileId: voice.voiceProfileId,
      adapterId: voice.adapterId,
      voiceId: voice.voiceId,
      speedScale: 1,
      settings: voice.settings,
      referenceAudio:
        voice.refAudioAssetId === null
          ? null
          : snapshotOf(voice.refAudioAssetId, [
              "cast",
              voice.side,
              "voiceProfileId",
            ]),
    })),
    audioAssets: document.cues.flatMap((cue, index) =>
      cue.audioAssetId === undefined
        ? []
        : [
            {
              cueId: cue.id,
              asset: snapshotOf(cue.audioAssetId, ["cues", index, "audioAssetId"]),
            },
          ],
    ),
    cutIns: document.cutIns.map((cutIn, index) => ({
      cutInId: cutIn.id,
      asset: snapshotOf(cutIn.assetId, ["cutIns", index, "assetId"]),
    })),
    cardAssets: documentAssets.cardImageAssetIds.map((assetId, index) => ({
      assetId,
      asset: snapshotOf(assetId, ["cards", index, "states"]),
    })),
    materials: resolvedMaterials.map((material) => ({
      materialId: material.row.id,
      name: material.row.name,
      format: material.snapshot.format,
      durationMs: material.snapshot.durationMs,
      scene: material.snapshot.scene,
      assets: material.snapshot.assets,
      snapshotSha256: sha256Hex(canonicalJson(material.snapshot)),
      provenanceSha256: sha256Hex(canonicalJson(material.provenance)),
    })),
  });
  if (!snapshot.success) {
    throw validationError(
      snapshot.error.issues.map((issue) => ({
        path: issue.path.map((segment) =>
          typeof segment === "symbol" ? segment.toString() : segment,
        ),
        code: issue.code,
        message: issue.message,
      })),
    );
  }
  return snapshot.data;
}
