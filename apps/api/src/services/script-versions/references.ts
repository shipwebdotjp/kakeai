import {
  LEGACY_FACE_SET_VERSION,
  RENDITION_PURPOSE,
  characterStandingV1InputSchema,
  collectAssetReferences,
  type AssetKindName,
  type AssetReference,
  type ContentDocument,
  type SnapshotFaceSet,
  type VisualCue,
} from "@kakeai/contracts";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.ts";
import { ApiError } from "../../http/errors.ts";
import {
  validationError,
  type ValidationIssue,
} from "../../http/validation.ts";

export type AssetWithRenditions = Prisma.AssetGetPayload<{
  include: { renditions: true };
}>;

export interface LoadedAssetReferences {
  references: AssetReference[];
  assetById: Map<string, AssetWithRenditions>;
}

export type FaceSetRevisionDetails = {
  faceSetId: string;
  name: string;
  version: number;
  layers: Array<{
    id: string;
    part: string;
    assetId: string;
    blinkLayerId: string | null;
    speakingLayerId: string | null;
  }>;
  expressions: Array<{
    id: string;
    name: string;
    browLayerId: string | null;
    eyeLayerId: string | null;
    mouthLayerId: string | null;
  }>;
  createdAt: Date;
  updatedAt: Date;
};

export type FaceSetDetails = FaceSetRevisionDetails;

export interface FaceSetReferenceKey {
  faceSetId: string;
  version: number;
}

export interface LoadedReferences extends LoadedAssetReferences {
  faceSetByKey: Map<string, FaceSetRevisionDetails>;
}

export function faceSetKey(faceSetId: string, version: number): string {
  return `${faceSetId}@${version}`;
}

export function toSnapshotFaceSet(faceSet: FaceSetRevisionDetails): SnapshotFaceSet {
  return {
    id: faceSet.faceSetId,
    version: faceSet.version,
    name: faceSet.name,
    layers: faceSet.layers.map((layer) => ({
      id: layer.id,
      part: layer.part as SnapshotFaceSet["layers"][number]["part"],
      assetId: layer.assetId,
      blinkLayerId: layer.blinkLayerId,
      speakingLayerId: layer.speakingLayerId,
    })),
    expressions: faceSet.expressions.map((preset) => ({
      id: preset.id,
      name: preset.name,
      browLayerId: preset.browLayerId,
      eyeLayerId: preset.eyeLayerId,
      mouthLayerId: preset.mouthLayerId,
    })),
  };
}

/** The pinned revision of an Appearance. `null` means the legacy v1. */
export function faceSetReferenceOf(appearance: {
  faceSetId: string | null;
  faceSetVersion: number | null;
}): FaceSetReferenceKey | null {
  if (appearance.faceSetId === null) {
    return null;
  }
  return {
    faceSetId: appearance.faceSetId,
    version: appearance.faceSetVersion ?? LEGACY_FACE_SET_VERSION,
  };
}

export function collectFaceSetReferences(
  content: ContentDocument,
): FaceSetReferenceKey[] {
  const byKey = new Map<string, FaceSetReferenceKey>();
  for (const character of content.characters) {
    for (const appearance of character.appearances) {
      const reference = faceSetReferenceOf(appearance);
      if (reference !== null) {
        byKey.set(faceSetKey(reference.faceSetId, reference.version), reference);
      }
    }
  }
  return [...byKey.values()];
}

export async function loadFaceSets(
  client: PrismaClient | Prisma.TransactionClient,
  content: ContentDocument,
): Promise<Map<string, FaceSetRevisionDetails>> {
  const references = collectFaceSetReferences(content);
  if (references.length === 0) {
    return new Map();
  }
  const rows = await client.faceSetRevision.findMany({
    where: {
      OR: references.map((reference) => ({
        faceSetId: reference.faceSetId,
        versionNumber: reference.version,
      })),
    },
    include: {
      faceSet: true,
      layers: { orderBy: { position: "asc" } },
      expressions: { orderBy: { position: "asc" } },
    },
  });
  return new Map(
    rows.map((row) => [
      faceSetKey(row.faceSetId, row.versionNumber),
      {
        faceSetId: row.faceSetId,
        name: row.faceSet.name,
        version: row.versionNumber,
        layers: row.layers,
        expressions: row.expressions,
        createdAt: row.faceSet.createdAt,
        updatedAt: row.faceSet.updatedAt,
      },
    ]),
  );
}

export async function loadLayerAssets(
  client: PrismaClient | Prisma.TransactionClient,
  faceSetByKey: Map<string, FaceSetRevisionDetails>,
): Promise<Map<string, AssetWithRenditions>> {
  const ids = [
    ...new Set(
      [...faceSetByKey.values()].flatMap((faceSet) =>
        faceSet.layers.map((layer) => layer.assetId),
      ),
    ),
  ];
  if (ids.length === 0) {
    return new Map();
  }
  const assets = await client.asset.findMany({
    where: { id: { in: ids } },
    include: { renditions: true },
  });
  return new Map(assets.map((asset) => [asset.id, asset]));
}

export function collectFaceLayerReferences(
  content: ContentDocument,
  faceSetByKey: Map<string, FaceSetRevisionDetails>,
): AssetReference[] {
  const references: AssetReference[] = [];
  const seen = new Set<string>();
  content.characters.forEach((character, characterIndex) => {
    character.appearances.forEach((appearance, appearanceIndex) => {
      const reference = faceSetReferenceOf(appearance);
      if (reference === null) {
        return;
      }
      const faceSet = faceSetByKey.get(
        faceSetKey(reference.faceSetId, reference.version),
      );
      if (faceSet === undefined) {
        return;
      }
      for (const layer of faceSet.layers) {
        if (seen.has(layer.assetId)) {
          continue;
        }
        seen.add(layer.assetId);
        references.push({
          assetId: layer.assetId,
          allowedKinds: ["image"],
          path: [
            "characters",
            characterIndex,
            "appearances",
            appearanceIndex,
            "faceSetId",
          ],
        });
      }
    });
  });
  return references;
}

export async function loadAllReferences(
  client: PrismaClient | Prisma.TransactionClient,
  content: ContentDocument,
): Promise<LoadedReferences> {
  const { references, assetById } = await loadAssetReferences(client, content);
  const faceSetByKey = await loadFaceSets(client, content);
  const layerAssets = await loadLayerAssets(client, faceSetByKey);
  for (const [id, asset] of layerAssets) {
    if (!assetById.has(id)) {
      assetById.set(id, asset);
    }
  }
  return {
    references: [
      ...references,
      ...collectFaceLayerReferences(content, faceSetByKey),
    ],
    assetById,
    faceSetByKey,
  };
}

function standingCueTarget(
  cue: VisualCue,
): { characterId: string; appearanceId: string } | undefined {
  if (cue.template.id !== "character.standing") {
    return undefined;
  }
  const parsed = characterStandingV1InputSchema.safeParse(cue.input);
  if (parsed.success) {
    return {
      characterId: parsed.data.characterId,
      appearanceId: parsed.data.appearanceId,
    };
  }
  return undefined;
}

function readyDimensions(
  asset: AssetWithRenditions | undefined,
): { widthPx: number; heightPx: number } | undefined {
  if (
    asset === undefined ||
    asset.status !== "ready" ||
    asset.widthPx === null ||
    asset.heightPx === null
  ) {
    return undefined;
  }
  return { widthPx: asset.widthPx, heightPx: asset.heightPx };
}

export function assertFaceSetReferences(
  content: ContentDocument,
  faceSetByKey: Map<string, FaceSetRevisionDetails>,
  assetById: Map<string, AssetWithRenditions>,
): void {
  const issues: ValidationIssue[] = [];
  const characterById = new Map(
    content.characters.map((character) => [character.id, character]),
  );
  content.characters.forEach((character, characterIndex) => {
    character.appearances.forEach((appearance, appearanceIndex) => {
      const reference = faceSetReferenceOf(appearance);
      if (reference === null) {
        return;
      }
      const path = [
        "characters",
        characterIndex,
        "appearances",
        appearanceIndex,
        "faceSetId",
      ];
      const faceSet = faceSetByKey.get(
        faceSetKey(reference.faceSetId, reference.version),
      );
      if (faceSet === undefined) {
        issues.push({
          path,
          code: "invalid_value",
          message: `表情セットの版が見つかりません: ${reference.faceSetId} v${reference.version}`,
        });
        return;
      }
      const base = readyDimensions(assetById.get(appearance.assetId));
      const layerDims = faceSet.layers.map((layer) =>
        readyDimensions(assetById.get(layer.assetId)),
      );
      if (
        faceSet.layers.length > 0 &&
        (base === undefined || layerDims.some((dims) => dims === undefined))
      ) {
        issues.push({
          path,
          code: "invalid_value",
          message: "顔レイヤーの寸法を確認できません。",
        });
        return;
      }
      const mismatch =
        base !== undefined &&
        layerDims.some(
          (dims) =>
            dims !== undefined &&
            (dims.widthPx !== base.widthPx || dims.heightPx !== base.heightPx),
        );
      if (mismatch) {
        issues.push({
          path,
          code: "invalid_value",
          message: "顔レイヤーはベース画像と同じ寸法にしてください。",
        });
      }
    });
  });

  const characterIdBySpeakerId = new Map(
    content.speakers.map((speaker) => [speaker.id, speaker.characterId]),
  );
  content.scenes.forEach((scene, sceneIndex) => {
    scene.lines.forEach((line, lineIndex) => {
      if (line.expressionId === null || line.speakerId === null) {
        return;
      }
      const path: (string | number)[] = [
        "scenes",
        sceneIndex,
        "lines",
        lineIndex,
        "expressionId",
      ];
      const characterId = characterIdBySpeakerId.get(line.speakerId);
      const character =
        characterId === null || characterId === undefined
          ? undefined
          : characterById.get(characterId);
      if (character === undefined) {
        issues.push({
          path,
          code: "invalid_value",
          message: "表情を指定する台詞にはキャラクターを持つ話者が必要です。",
        });
        return;
      }
      const appearanceIds = scene.visualCues
        .map(standingCueTarget)
        .filter(
          (target): target is { characterId: string; appearanceId: string } =>
            target !== undefined && target.characterId === character.id,
        )
        .map((target) => target.appearanceId);
      if (appearanceIds.length === 0) {
        return;
      }
      for (const appearanceId of appearanceIds) {
        const appearance = character.appearances.find(
          (entry) => entry.id === appearanceId,
        );
        const reference =
          appearance === undefined ? null : faceSetReferenceOf(appearance);
        const faceSet =
          reference === null
            ? undefined
            : faceSetByKey.get(faceSetKey(reference.faceSetId, reference.version));
        if (
          faceSet === undefined ||
          !faceSet.expressions.some((preset) => preset.id === line.expressionId)
        ) {
          issues.push({
            path,
            code: "invalid_value",
            message: "この表情は話者の立ち絵で利用できません。",
          });
          return;
        }
      }
    });
  });
  if (issues.length > 0) {
    throw validationError(issues);
  }
}

export async function loadAssetReferences(
  client: PrismaClient | Prisma.TransactionClient,
  content: ContentDocument,
): Promise<LoadedAssetReferences> {
  const references = collectAssetReferences(content);
  const ids = [...new Set(references.map((reference) => reference.assetId))];
  const assets =
    ids.length === 0
      ? []
      : await client.asset.findMany({
          where: { id: { in: ids } },
          include: { renditions: true },
        });
  return {
    references,
    assetById: new Map(assets.map((asset) => [asset.id, asset])),
  };
}

export function assertAssetsAvailable(
  references: AssetReference[],
  assetById: Map<string, AssetWithRenditions>,
): void {
  const uniqueIds = [
    ...new Set(references.map((reference) => reference.assetId)),
  ];

  const missing = uniqueIds.filter((id) => !assetById.has(id));
  if (missing.length > 0) {
    throw new ApiError(422, "ASSET_NOT_FOUND", undefined, {
      assetIds: missing,
    });
  }

  const processing = uniqueIds.filter(
    (id) => assetById.get(id)?.status === "processing",
  );
  if (processing.length > 0) {
    throw new ApiError(409, "ASSET_PROCESSING", undefined, {
      assetIds: processing,
    });
  }

  const failed = uniqueIds.filter(
    (id) => assetById.get(id)?.status === "failed",
  );
  if (failed.length > 0) {
    throw new ApiError(422, "ASSET_UNAVAILABLE", undefined, {
      assetIds: failed,
    });
  }

  const kindIssues: ValidationIssue[] = [];
  for (const reference of references) {
    const asset = assetById.get(reference.assetId);
    if (asset === undefined) {
      continue;
    }
    if (!reference.allowedKinds.includes(asset.kind as AssetKindName)) {
      kindIssues.push({
        path: reference.path,
        code: "invalid_type",
        message: `素材 ${reference.assetId} はこの用途に使えません。`,
      });
    }
  }
  if (kindIssues.length > 0) {
    throw validationError(kindIssues);
  }
}

export function assertTakeDurations(
  content: ContentDocument,
  assetById: Map<string, AssetWithRenditions>,
): void {
  const durationIssues: ValidationIssue[] = [];
  content.audioTakes.forEach((take, index) => {
    const asset = assetById.get(take.assetId);
    if (asset === undefined || asset.status !== "ready") {
      return;
    }
    const rendition = asset.renditions.find(
      (row) => row.purpose === RENDITION_PURPOSE,
    );
    const expectedMs = rendition?.durationMs ?? asset.durationMs;
    if (expectedMs !== null && take.durationMs !== expectedMs) {
      durationIssues.push({
        path: ["audioTakes", index, "durationMs"],
        code: "invalid_value",
        message: `音声 ${take.id} の尺が素材と一致しません。`,
      });
    }
  });
  if (durationIssues.length > 0) {
    throw validationError(durationIssues);
  }
}

export function renderSourceDurationMs(
  asset: AssetWithRenditions,
): number | null {
  const rendition = asset.renditions.find(
    (entry) => entry.purpose === RENDITION_PURPOSE,
  );
  return rendition?.durationMs ?? asset.durationMs;
}
