import {
  RENDITION_PURPOSE,
  characterStandingV1InputSchema,
  collectAssetReferences,
  type AssetKindName,
  type AssetReference,
  type ContentDocument,
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

export type FaceSetDetails = Prisma.FaceSetGetPayload<{
  include: { layers: true; expressions: true };
}>;

export interface LoadedReferences extends LoadedAssetReferences {
  faceSetById: Map<string, FaceSetDetails>;
}

export function collectFaceSetIds(content: ContentDocument): string[] {
  return [
    ...new Set(
      content.characters.flatMap((character) =>
        character.appearances.map((appearance) => appearance.faceSetId),
      ),
    ),
  ].filter((id): id is string => id !== null);
}

export async function loadFaceSets(
  client: PrismaClient | Prisma.TransactionClient,
  content: ContentDocument,
): Promise<Map<string, FaceSetDetails>> {
  const ids = collectFaceSetIds(content);
  const rows =
    ids.length === 0
      ? []
      : await client.faceSet.findMany({
          where: { id: { in: ids } },
          include: {
            layers: { orderBy: { position: "asc" } },
            expressions: { orderBy: { position: "asc" } },
          },
        });
  return new Map(rows.map((row) => [row.id, row]));
}

export async function loadLayerAssets(
  client: PrismaClient | Prisma.TransactionClient,
  faceSetById: Map<string, FaceSetDetails>,
): Promise<Map<string, AssetWithRenditions>> {
  const ids = [
    ...new Set(
      [...faceSetById.values()].flatMap((faceSet) =>
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
  faceSetById: Map<string, FaceSetDetails>,
): AssetReference[] {
  const references: AssetReference[] = [];
  const seen = new Set<string>();
  content.characters.forEach((character, characterIndex) => {
    character.appearances.forEach((appearance, appearanceIndex) => {
      if (appearance.faceSetId === null) {
        return;
      }
      const faceSet = faceSetById.get(appearance.faceSetId);
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
  const faceSetById = await loadFaceSets(client, content);
  const layerAssets = await loadLayerAssets(client, faceSetById);
  for (const [id, asset] of layerAssets) {
    if (!assetById.has(id)) {
      assetById.set(id, asset);
    }
  }
  return {
    references: [
      ...references,
      ...collectFaceLayerReferences(content, faceSetById),
    ],
    assetById,
    faceSetById,
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
  faceSetById: Map<string, FaceSetDetails>,
  assetById: Map<string, AssetWithRenditions>,
): void {
  const issues: ValidationIssue[] = [];
  const characterById = new Map(
    content.characters.map((character) => [character.id, character]),
  );
  content.characters.forEach((character, characterIndex) => {
    character.appearances.forEach((appearance, appearanceIndex) => {
      if (appearance.faceSetId === null) {
        return;
      }
      const faceSet = faceSetById.get(appearance.faceSetId);
      if (faceSet === undefined) {
        issues.push({
          path: [
            "characters",
            characterIndex,
            "appearances",
            appearanceIndex,
            "faceSetId",
          ],
          code: "invalid_value",
          message: "表情セットが見つかりません。",
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
          path: [
            "characters",
            characterIndex,
            "appearances",
            appearanceIndex,
            "faceSetId",
          ],
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
          path: [
            "characters",
            characterIndex,
            "appearances",
            appearanceIndex,
            "faceSetId",
          ],
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
        const faceSet =
          appearance?.faceSetId === null || appearance?.faceSetId === undefined
            ? undefined
            : faceSetById.get(appearance.faceSetId);
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
