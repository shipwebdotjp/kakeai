import type { PrismaClient } from "../generated/prisma/client.ts";
import { toCharacterLibraryEntry } from "../dto/mappers.ts";
import { resourceNotFound, validationError } from "../http/validation.ts";
import {
  assertAppearancesUsable,
  assertFaceSetsExist,
  characterInclude,
  newCharacterAppearanceId,
  type AppearanceInput,
} from "./character-library.ts";
import type { CharacterLibraryEntry } from "@kakeai/contracts";

export type AddCharacterAppearanceInput = {
  assetId: string;
  expression: string;
  pose: string;
  label?: string;
  faceSetId?: string | null;
};

export type UpdateCharacterAppearancePatch = {
  assetId?: string;
  expression?: string;
  pose?: string;
  label?: string | null;
  faceSetId?: string | null;
};

export async function addCharacterAppearance(
  prisma: PrismaClient,
  characterId: string,
  input: AddCharacterAppearanceInput,
): Promise<CharacterLibraryEntry> {
  return prisma.$transaction(async (transaction) => {
    const current = await transaction.character.findUnique({
      where: { id: characterId },
      include: characterInclude,
    });
    if (current === null) {
      throw resourceNotFound("character", characterId);
    }

    if (current.appearances.length >= 50) {
      throw validationError([
        {
          path: ["appearances"],
          code: "invalid_value",
          message: "外観の登録数が上限（50件）を超えています。",
        },
      ]);
    }

    const appearanceId = newCharacterAppearanceId();
    const newAppearance: AppearanceInput = {
      id: appearanceId,
      assetId: input.assetId,
      expression: input.expression,
      pose: input.pose,
      label: input.label,
      faceSetId: input.faceSetId ?? null,
    };

    await assertAppearancesUsable(transaction, [newAppearance]);
    await assertFaceSetsExist(transaction, [newAppearance]);

    const row = await transaction.character.update({
      where: { id: characterId },
      data: {
        appearances: {
          create: {
            id: appearanceId,
            assetId: input.assetId,
            expression: input.expression,
            pose: input.pose,
            label:
              input.label === undefined || input.label.trim().length === 0
                ? null
                : input.label.trim(),
            faceSetId: input.faceSetId ?? null,
            position: current.appearances.length,
          },
        },
      },
      include: characterInclude,
    });
    return toCharacterLibraryEntry(row);
  });
}

export async function updateCharacterAppearance(
  prisma: PrismaClient,
  characterId: string,
  appearanceId: string,
  patch: UpdateCharacterAppearancePatch,
): Promise<CharacterLibraryEntry> {
  return prisma.$transaction(async (transaction) => {
    const current = await transaction.character.findUnique({
      where: { id: characterId },
      include: characterInclude,
    });
    if (current === null) {
      throw resourceNotFound("character", characterId);
    }

    const existing = current.appearances.find((app) => app.id === appearanceId);
    if (existing === undefined) {
      throw resourceNotFound("appearance", appearanceId);
    }

    const mergedAssetId = patch.assetId ?? existing.assetId;
    const mergedExpression = patch.expression ?? existing.expression;
    const mergedPose = patch.pose ?? existing.pose;
    const mergedLabel =
      patch.label !== undefined ? patch.label : existing.label;
    const mergedFaceSetId =
      patch.faceSetId !== undefined ? patch.faceSetId : existing.faceSetId;

    const mergedAppearance: AppearanceInput = {
      id: appearanceId,
      assetId: mergedAssetId,
      expression: mergedExpression,
      pose: mergedPose,
      label: mergedLabel ?? undefined,
      faceSetId: mergedFaceSetId,
    };

    await assertAppearancesUsable(transaction, [mergedAppearance]);
    await assertFaceSetsExist(transaction, [mergedAppearance]);

    const appearanceUpdateData: {
      assetId?: string;
      expression?: string;
      pose?: string;
      label?: string | null;
      faceSetId?: string | null;
    } = {};
    if (patch.assetId !== undefined) {
      appearanceUpdateData.assetId = patch.assetId;
    }
    if (patch.expression !== undefined) {
      appearanceUpdateData.expression = patch.expression;
    }
    if (patch.pose !== undefined) {
      appearanceUpdateData.pose = patch.pose;
    }
    if (patch.label !== undefined) {
      appearanceUpdateData.label =
        patch.label === null || patch.label.trim().length === 0
          ? null
          : patch.label.trim();
    }
    if (patch.faceSetId !== undefined) {
      appearanceUpdateData.faceSetId = patch.faceSetId;
    }

    const row = await transaction.character.update({
      where: { id: characterId },
      data: {
        appearances: {
          update: {
            where: { id: appearanceId },
            data: appearanceUpdateData,
          },
        },
      },
      include: characterInclude,
    });
    return toCharacterLibraryEntry(row);
  });
}
