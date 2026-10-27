import {
  type CreateFaceSetRequest,
  type FaceSet,
  type FaceSetRevision,
  type FaceSetUsages,
  type UpdateFaceSetRequest,
  faceLayerPartSchema,
} from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { toFaceSet, toFaceSetRevision } from "../dto/mappers.ts";
import { ApiError } from "../http/errors.ts";
import { resourceNotFound, validationError } from "../http/validation.ts";
import {
  assertCompatibleWithLibraryAppearances,
  assertLayersUsable,
  assertPresetsUsable,
  type LayerInput,
  type LayerRow,
  type PresetInput,
  type PresetRow,
} from "./face-set-validation.ts";

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

function toLayerInput(layer: LayerRow): LayerInput {
  // `part` is a plain String column, so a legacy row could hold a value
  // outside the union. The agent partial update merges the latest revision, so
  // narrow it here instead of silently carrying a rogue value forward.
  const part = faceLayerPartSchema.safeParse(layer.part);
  if (!part.success) {
    throw validationError([
      {
        path: ["layers"],
        code: "invalid_value",
        message: "レイヤーの部位が不正です。",
      },
    ]);
  }
  return {
    id: layer.id,
    part: part.data,
    assetId: layer.assetId,
    blinkLayerId: layer.blinkLayerId,
    speakingLayerId: layer.speakingLayerId,
  };
}

function toPresetInput(preset: PresetRow): PresetInput {
  return {
    id: preset.id,
    name: preset.name,
    browLayerId: preset.browLayerId,
    eyeLayerId: preset.eyeLayerId,
    mouthLayerId: preset.mouthLayerId,
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

/** The members an agent partial update may change; omitted ones stay as-is. */
export interface FaceSetUpdatePatch {
  name?: string;
  layers?: LayerInput[];
  expressions?: PresetInput[];
}

/**
 * Merges a partial edit inside the write transaction and creates a new
 * revision only when the layers or expressions actually change. Every change
 * is validated against the merged content, so an edit that drops a layer still
 * referenced by a preset is rejected, and a revision that no longer fits a
 * library Appearance cannot become the latest revision.
 *
 * A name-only change, or a provided list identical to the latest revision,
 * updates the name without consuming a version.
 */
export async function updateFaceSetPartial(
  prisma: PrismaClient,
  faceSetId: string,
  patch: FaceSetUpdatePatch,
): Promise<FaceSet> {
  if (
    patch.name === undefined &&
    patch.layers === undefined &&
    patch.expressions === undefined
  ) {
    throw validationError([
      {
        path: [],
        code: "custom",
        message: "更新する項目を1つ以上指定してください。",
      },
    ]);
  }
  try {
    return await prisma.$transaction(async (transaction) => {
      const existing = await transaction.faceSet.findUnique({
        where: { id: faceSetId },
        include: latestRevisionInclude,
      });
      if (existing === null) {
        throw resourceNotFound("face_set", faceSetId);
      }
      const latest = latestRevisionOf(existing);
      const name = patch.name ?? existing.name;

      // A name-only edit never rewrites the revision. Return before converting
      // the stored rows, so a legacy layer part cannot block an unrelated
      // rename with a validation error on a path the caller never sent.
      if (patch.layers === undefined && patch.expressions === undefined) {
        const row = await transaction.faceSet.update({
          where: { id: faceSetId },
          data: { name },
          include: latestRevisionInclude,
        });
        return toLatestFaceSet(row);
      }

      const layers = patch.layers ?? latest.layers.map(toLayerInput);
      const expressions = patch.expressions ?? latest.expressions.map(toPresetInput);

      // Validate against the merged content, not just the provided member:
      // removing a layer can orphan a preset that still references it.
      await assertLayersUsable(transaction, layers);
      assertPresetsUsable(layers, expressions);

      const unchanged =
        normalizeLayers(latest.layers) === normalizeLayers(layers) &&
        normalizePresets(latest.expressions) === normalizePresets(expressions);
      if (unchanged) {
        const row = await transaction.faceSet.update({
          where: { id: faceSetId },
          data: { name },
          include: latestRevisionInclude,
        });
        return toLatestFaceSet(row);
      }

      await assertCompatibleWithLibraryAppearances(transaction, faceSetId, layers);
      const row = await transaction.faceSet.update({
        where: { id: faceSetId },
        data: {
          name,
          revisions: {
            create: {
              versionNumber: latest.versionNumber + 1,
              layers: {
                create: layers.map((layer, index) => toLayerData(layer, index)),
              },
              expressions: {
                create: expressions.map((preset, index) => toPresetData(preset, index)),
              },
            },
          },
        },
        include: latestRevisionInclude,
      });
      return toLatestFaceSet(row);
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    if (isPrismaCode(error, "P2025")) {
      throw resourceNotFound("face_set", faceSetId);
    }
    if (isPrismaCode(error, "P2002")) {
      // Layer and preset IDs were validated above, so the remaining unique
      // constraint is (faceSetId, versionNumber): a concurrent edit won.
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
