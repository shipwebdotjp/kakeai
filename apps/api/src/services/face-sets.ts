import {
  type CreateFaceSetRequest,
  type FaceSet,
  type FaceSetRevision,
  type FaceSetUsages,
  type UpdateFaceSetRequest,
} from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { toFaceSet, toFaceSetRevision } from "../dto/mappers.ts";
import { ApiError } from "../http/errors.ts";
import { resourceNotFound, validationError, type ValidationIssue } from "../http/validation.ts";

type LayerInput = {
  id: string;
  part: "brow" | "eye" | "mouth" | "foreground";
  assetId: string;
  blinkLayerId: string | null;
  speakingLayerId: string | null;
};

type PresetInput = {
  id: string;
  name: string;
  browLayerId: string | null;
  eyeLayerId: string | null;
  mouthLayerId: string | null;
};

type LayerRow = {
  id: string;
  part: string;
  assetId: string;
  blinkLayerId: string | null;
  speakingLayerId: string | null;
};

type PresetRow = {
  id: string;
  name: string;
  browLayerId: string | null;
  eyeLayerId: string | null;
  mouthLayerId: string | null;
};

const revisionInclude = {
  layers: { orderBy: { position: "asc" as const } },
  expressions: { orderBy: { position: "asc" as const } },
};

const latestRevisionInclude = {
  revisions: {
    orderBy: { versionNumber: "desc" as const },
    take: 1,
    include: revisionInclude,
  },
};

interface FaceSetWithRevisions {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  revisions: Array<{
    versionNumber: number;
    layers: LayerRow[];
    expressions: PresetRow[];
  }>;
}

function latestRevisionOf(row: FaceSetWithRevisions) {
  const revision = row.revisions[0];
  if (revision === undefined) {
    throw resourceNotFound("face_set_revision", row.id);
  }
  return revision;
}

function toLatestFaceSet(row: FaceSetWithRevisions): FaceSet {
  const revision = latestRevisionOf(row);
  return toFaceSet({
    id: row.id,
    name: row.name,
    version: revision.versionNumber,
    layers: revision.layers,
    expressions: revision.expressions,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function checkDuplicateIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      duplicates.add(id);
    } else {
      seen.add(id);
    }
  }
  return [...duplicates];
}

async function assertLayersUsable(
  prisma: PrismaClient,
  layers: readonly LayerInput[],
): Promise<void> {
  const issues: ValidationIssue[] = [];
  const duplicates = checkDuplicateIds(layers.map((layer) => layer.id));
  if (duplicates.length > 0) {
    issues.push({
      path: ["layers"],
      code: "custom",
      message: `レイヤーのIDが重複しています: ${duplicates.join(", ")}`,
    });
  }
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  layers.forEach((layer, index) => {
    if (layer.blinkLayerId !== null && layer.part !== "eye") {
      issues.push({
        path: ["layers", index, "blinkLayerId"],
        code: "invalid_value",
        message: "閉眼レイヤーは目レイヤーにだけ指定できます。",
      });
    }
    if (layer.speakingLayerId !== null && layer.part !== "mouth") {
      issues.push({
        path: ["layers", index, "speakingLayerId"],
        code: "invalid_value",
        message: "開口レイヤーは口レイヤーにだけ指定できます。",
      });
    }
    for (const [key, targetId, expectedPart] of [
      ["blinkLayerId", layer.blinkLayerId, "eye"],
      ["speakingLayerId", layer.speakingLayerId, "mouth"],
    ] as const) {
      if (targetId === null) {
        continue;
      }
      const target = byId.get(targetId);
      if (target === undefined) {
        issues.push({
          path: ["layers", index, key],
          code: "invalid_value",
          message: "同じ表情セット内のレイヤーを指定してください。",
        });
      } else if (targetId === layer.id) {
        issues.push({
          path: ["layers", index, key],
          code: "invalid_value",
          message: "自身のレイヤーは指定できません。",
        });
      } else if (target.part !== expectedPart) {
        issues.push({
          path: ["layers", index, key],
          code: "invalid_value",
          message: "対応先の部位が一致しません。",
        });
      }
    }
  });
  const assetIds = [...new Set(layers.map((layer) => layer.assetId))];
  if (assetIds.length > 0) {
    const assets = await prisma.asset.findMany({
      where: { id: { in: assetIds } },
      select: { id: true, kind: true, status: true, widthPx: true, heightPx: true },
    });
    const byAssetId = new Map(assets.map((asset) => [asset.id, asset]));
    layers.forEach((layer, index) => {
      const asset = byAssetId.get(layer.assetId);
      if (asset === undefined) {
        issues.push({
          path: ["layers", index, "assetId"],
          code: "invalid_value",
          message: "素材が見つかりません。",
        });
        return;
      }
      if (asset.kind !== "image") {
        issues.push({
          path: ["layers", index, "assetId"],
          code: "invalid_type",
          message: "顔レイヤーには画像素材を選んでください。",
        });
        return;
      }
      if (asset.status !== "ready") {
        issues.push({
          path: ["layers", index, "assetId"],
          code: "invalid_value",
          message: "素材が準備完了していません。",
        });
      }
    });
    const sized = assets.filter(
      (asset): asset is typeof asset & { widthPx: number; heightPx: number } =>
        asset.widthPx !== null && asset.heightPx !== null,
    );
    if (sized.length !== assets.length) {
      issues.push({
        path: ["layers"],
        code: "invalid_value",
        message: "顔レイヤーの寸法を確認できません。",
      });
    } else if (sized.length > 0) {
      const first = sized[0]!;
      const mismatch = sized.some(
        (asset) => asset.widthPx !== first.widthPx || asset.heightPx !== first.heightPx,
      );
      if (mismatch) {
        issues.push({
          path: ["layers"],
          code: "invalid_value",
          message: "顔レイヤーは同じ寸法の画像にしてください。",
        });
      }
    }
  }
  if (issues.length > 0) {
    throw validationError(issues);
  }
}

function assertPresetsUsable(
  layers: readonly LayerInput[],
  presets: readonly PresetInput[],
): void {
  const issues: ValidationIssue[] = [];
  const duplicates = checkDuplicateIds(presets.map((preset) => preset.id));
  if (duplicates.length > 0) {
    issues.push({
      path: ["expressions"],
      code: "custom",
      message: `表情のIDが重複しています: ${duplicates.join(", ")}`,
    });
  }
  if (!presets.some((preset) => preset.id === "normal")) {
    issues.push({
      path: ["expressions"],
      code: "custom",
      message: "normal の表情が必要です。",
    });
  }
  const layerIds = new Map(layers.map((layer) => [layer.id, layer]));
  presets.forEach((preset, index) => {
    for (const [key, targetId, expectedPart] of [
      ["browLayerId", preset.browLayerId, "brow"],
      ["eyeLayerId", preset.eyeLayerId, "eye"],
      ["mouthLayerId", preset.mouthLayerId, "mouth"],
    ] as const) {
      if (targetId === null) {
        continue;
      }
      const target = layerIds.get(targetId);
      if (target === undefined) {
        issues.push({
          path: ["expressions", index, key],
          code: "invalid_value",
          message: "同じ表情セット内のレイヤーを指定してください。",
        });
      } else if (target.part !== expectedPart) {
        issues.push({
          path: ["expressions", index, key],
          code: "invalid_value",
          message: "対応先の部位が一致しません。",
        });
      }
    }
  });
  if (issues.length > 0) {
    throw validationError(issues);
  }
}

async function assertCompatibleWithLibraryAppearances(
  prisma: PrismaClient,
  faceSetId: string,
  layers: readonly LayerInput[],
): Promise<void> {
  if (layers.length === 0) {
    return;
  }
  const appearances = await prisma.characterAppearance.findMany({
    where: { faceSetId },
    select: {
      id: true,
      assetId: true,
      label: true,
      character: { select: { name: true } },
    },
  });
  if (appearances.length === 0) {
    return;
  }
  const assetIds = [
    ...new Set([
      ...layers.map((layer) => layer.assetId),
      ...appearances.map((appearance) => appearance.assetId),
    ]),
  ];
  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds } },
    select: { id: true, widthPx: true, heightPx: true },
  });
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const layerSizes = layers.map((layer) => byId.get(layer.assetId));
  const layerSize = layerSizes[0];
  if (
    layerSize === undefined ||
    layerSize.widthPx === null ||
    layerSize.heightPx === null
  ) {
    // The layer assets are validated by assertLayersUsable; this guard only
    // keeps the comparison meaningful if that validation changes.
    return;
  }
  const issues: ValidationIssue[] = [];
  for (const appearance of appearances) {
    const base = byId.get(appearance.assetId);
    if (
      base === undefined ||
      base.widthPx === null ||
      base.heightPx === null
    ) {
      issues.push({
        path: ["layers"],
        code: "invalid_value",
        message: `「${appearance.character.name}」のベース画像の寸法を確認できません。`,
      });
      continue;
    }
    if (
      base.widthPx !== layerSize.widthPx ||
      base.heightPx !== layerSize.heightPx
    ) {
      const label =
        appearance.label === null || appearance.label.length === 0
          ? appearance.id
          : appearance.label;
      issues.push({
        path: ["layers"],
        code: "invalid_value",
        message: `「${appearance.character.name}」の外観「${label}」のベース画像（${base.widthPx}×${base.heightPx}）と顔レイヤーの寸法（${layerSize.widthPx}×${layerSize.heightPx}）が一致しません。`,
      });
    }
  }
  if (issues.length > 0) {
    throw validationError(issues);
  }
}

function toLayerData(layer: LayerInput, position: number) {
  return {
    id: layer.id,
    part: layer.part,
    assetId: layer.assetId,
    blinkLayerId: layer.blinkLayerId,
    speakingLayerId: layer.speakingLayerId,
    position,
  };
}

function toPresetData(preset: PresetInput, position: number) {
  return {
    id: preset.id,
    name: preset.name,
    browLayerId: preset.browLayerId,
    eyeLayerId: preset.eyeLayerId,
    mouthLayerId: preset.mouthLayerId,
    position,
  };
}

function normalizeLayers(layers: readonly LayerRow[]): string {
  return JSON.stringify(
    layers.map((layer) => ({
      id: layer.id,
      part: layer.part,
      assetId: layer.assetId,
      blinkLayerId: layer.blinkLayerId,
      speakingLayerId: layer.speakingLayerId,
    })),
  );
}

function normalizePresets(presets: readonly PresetRow[]): string {
  return JSON.stringify(
    presets.map((preset) => ({
      id: preset.id,
      name: preset.name,
      browLayerId: preset.browLayerId,
      eyeLayerId: preset.eyeLayerId,
      mouthLayerId: preset.mouthLayerId,
    })),
  );
}

export async function listFaceSets(prisma: PrismaClient): Promise<FaceSet[]> {
  const rows = await prisma.faceSet.findMany({
    include: latestRevisionInclude,
    orderBy: { createdAt: "asc" },
  });
  return rows
    .filter((row) => row.revisions.length > 0)
    .map((row) => toLatestFaceSet(row));
}

export async function getFaceSet(
  prisma: PrismaClient,
  faceSetId: string,
  version?: number,
): Promise<FaceSet> {
  const row = await prisma.faceSet.findUnique({
    where: { id: faceSetId },
    include: {
      revisions: {
        where: version === undefined ? undefined : { versionNumber: version },
        orderBy: { versionNumber: "desc" },
        take: 1,
        include: revisionInclude,
      },
    },
  });
  if (row === null) {
    throw resourceNotFound("face_set", faceSetId);
  }
  if (row.revisions.length === 0) {
    throw resourceNotFound(
      "face_set_revision",
      version === undefined ? faceSetId : `${faceSetId}@${version}`,
    );
  }
  return toLatestFaceSet(row);
}

export async function getFaceSetRevisions(
  prisma: PrismaClient,
  faceSetId: string,
): Promise<FaceSetRevision[]> {
  const row = await prisma.faceSet.findUnique({
    where: { id: faceSetId },
    include: {
      revisions: {
        orderBy: { versionNumber: "asc" },
        include: revisionInclude,
      },
    },
  });
  if (row === null) {
    throw resourceNotFound("face_set", faceSetId);
  }
  return row.revisions.map((revision) =>
    toFaceSetRevision({
      id: revision.id,
      faceSetId,
      version: revision.versionNumber,
      layers: revision.layers,
      expressions: revision.expressions,
      createdAt: revision.createdAt,
    }),
  );
}

export async function getFaceSetUsages(
  prisma: PrismaClient,
  faceSetId: string,
): Promise<FaceSetUsages> {
  const existing = await prisma.faceSet.findUnique({
    where: { id: faceSetId },
    select: { id: true },
  });
  if (existing === null) {
    throw resourceNotFound("face_set", faceSetId);
  }
  const appearances = await prisma.characterAppearance.findMany({
    where: { faceSetId },
    include: { character: { select: { id: true, name: true } } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  const assetIds = [...new Set(appearances.map((appearance) => appearance.assetId))];
  const assets =
    assetIds.length === 0
      ? []
      : await prisma.asset.findMany({
          where: { id: { in: assetIds } },
          select: { id: true, widthPx: true, heightPx: true },
        });
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  return {
    libraryAppearances: appearances.map((appearance) => {
      const asset = byId.get(appearance.assetId);
      return {
        characterId: appearance.character.id,
        characterName: appearance.character.name,
        appearanceId: appearance.id,
        label: appearance.label,
        assetId: appearance.assetId,
        widthPx: asset?.widthPx ?? null,
        heightPx: asset?.heightPx ?? null,
      };
    }),
  };
}

export async function createFaceSet(
  prisma: PrismaClient,
  input: CreateFaceSetRequest,
): Promise<FaceSet> {
  await assertLayersUsable(prisma, input.layers);
  assertPresetsUsable(input.layers, input.expressions);
  try {
    const row = await prisma.faceSet.create({
      data: {
        name: input.name,
        revisions: {
          create: {
            versionNumber: 1,
            layers: {
              create: input.layers.map((layer, index) => toLayerData(layer, index)),
            },
            expressions: {
              create: input.expressions.map((preset, index) => toPresetData(preset, index)),
            },
          },
        },
      },
      include: latestRevisionInclude,
    });
    return toLatestFaceSet(row);
  } catch (error) {
    if (isPrismaCode(error, "P2002")) {
      throw validationError([
        {
          path: ["layers"],
          code: "custom",
          message: "レイヤーまたは表情のIDが既に使われています。",
        },
      ]);
    }
    throw error;
  }
}

export async function updateFaceSet(
  prisma: PrismaClient,
  faceSetId: string,
  input: UpdateFaceSetRequest,
): Promise<FaceSet> {
  await assertLayersUsable(prisma, input.layers);
  assertPresetsUsable(input.layers, input.expressions);

  const existing = await prisma.faceSet.findUnique({
    where: { id: faceSetId },
    include: latestRevisionInclude,
  });
  if (existing === null) {
    throw resourceNotFound("face_set", faceSetId);
  }
  const latest = latestRevisionOf(existing);
  const unchanged =
    normalizeLayers(latest.layers) === normalizeLayers(input.layers) &&
    normalizePresets(latest.expressions) === normalizePresets(input.expressions);
  if (unchanged) {
    const row = await prisma.faceSet.update({
      where: { id: faceSetId },
      data: { name: input.name },
      include: latestRevisionInclude,
    });
    return toLatestFaceSet(row);
  }

  // Identical layers cannot break a library appearance. Skipping the check
  // here lets a rename through even when legacy data already has a mismatch.
  await assertCompatibleWithLibraryAppearances(prisma, faceSetId, input.layers);

  try {
    const row = await prisma.faceSet.update({
      where: { id: faceSetId },
      data: {
        name: input.name,
        revisions: {
          create: {
            versionNumber: latest.versionNumber + 1,
            layers: {
              create: input.layers.map((layer, index) => toLayerData(layer, index)),
            },
            expressions: {
              create: input.expressions.map((preset, index) => toPresetData(preset, index)),
            },
          },
        },
      },
      include: latestRevisionInclude,
    });
    return toLatestFaceSet(row);
  } catch (error) {
    if (isPrismaCode(error, "P2025")) {
      throw resourceNotFound("face_set", faceSetId);
    }
    if (isPrismaCode(error, "P2002")) {
      // Layer and preset IDs were validated above, so the only remaining
      // unique constraint is (faceSetId, versionNumber): a concurrent update
      // won the race. Surface it as retryable rather than an input error.
      throw new ApiError(409, "FACE_SET_VERSION_CONFLICT", undefined, { faceSetId });
    }
    throw error;
  }
}

export function isFaceSetReferencedInContent(contentJson: string, faceSetId: string): boolean {
  let content: unknown;
  try {
    content = JSON.parse(contentJson) as unknown;
  } catch {
    return false;
  }
  if (typeof content !== "object" || content === null) {
    return false;
  }
  const characters = (content as { characters?: unknown }).characters;
  if (!Array.isArray(characters)) {
    return false;
  }
  return characters.some((character) => {
    if (typeof character !== "object" || character === null) {
      return false;
    }
    const appearances = (character as { appearances?: unknown }).appearances;
    if (!Array.isArray(appearances)) {
      return false;
    }
    return appearances.some(
      (appearance) =>
        typeof appearance === "object" &&
        appearance !== null &&
        (appearance as { faceSetId?: unknown }).faceSetId === faceSetId,
    );
  });
}

export async function deleteFaceSet(prisma: PrismaClient, faceSetId: string): Promise<void> {
  const existing = await prisma.faceSet.findUnique({
    where: { id: faceSetId },
    select: { id: true },
  });
  if (existing === null) {
    throw resourceNotFound("face_set", faceSetId);
  }
  try {
    await prisma.$transaction(async (transaction) => {
      const versions = await transaction.scriptVersion.findMany({
        select: { contentJson: true },
      });
      const used = versions.some((version) =>
        isFaceSetReferencedInContent(version.contentJson, faceSetId),
      );
      if (used) {
        throw new ApiError(409, "FACE_SET_IN_USE", undefined, {
          faceSetId,
          references: [{ type: "script_version" }],
        });
      }
      const libraryUse = await transaction.characterAppearance.findFirst({
        where: { faceSetId },
        select: { id: true },
      });
      if (libraryUse !== null) {
        throw new ApiError(409, "FACE_SET_IN_USE", undefined, {
          faceSetId,
          references: [{ type: "character_appearance", id: libraryUse.id }],
        });
      }
      await transaction.faceSet.delete({ where: { id: faceSetId } });
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    if (isPrismaCode(error, "P2025")) {
      throw resourceNotFound("face_set", faceSetId);
    }
    throw error;
  }
}

function isPrismaCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
}
