import {
  type CharacterLibraryEntry,
  type CreateCharacterRequest,
  type UpdateCharacterRequest,
} from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { toCharacterLibraryEntry } from "../dto/mappers.ts";
import { resourceNotFound, validationError, type ValidationIssue } from "../http/validation.ts";

type AppearanceInput = { id: string; assetId: string; expression: string; pose: string; label?: string };

async function assertAppearancesUsable(
  prisma: PrismaClient,
  appearances: readonly AppearanceInput[],
): Promise<void> {
  const ids = [...new Set(appearances.map((appearance) => appearance.assetId))];
  if (ids.length === 0) {
    return;
  }
  const assets = await prisma.asset.findMany({
    where: { id: { in: ids } },
    select: { id: true, kind: true, status: true },
  });
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const issues: ValidationIssue[] = [];
  appearances.forEach((appearance, index) => {
    const asset = byId.get(appearance.assetId);
    if (asset === undefined) {
      issues.push({
        path: ["appearances", index, "assetId"],
        code: "invalid_value",
        message: "素材が見つかりません。",
      });
      return;
    }
    if (asset.kind !== "image") {
      issues.push({
        path: ["appearances", index, "assetId"],
        code: "invalid_type",
        message: "立ち絵には画像素材を選んでください。",
      });
      return;
    }
    if (asset.status !== "ready") {
      issues.push({
        path: ["appearances", index, "assetId"],
        code: "invalid_value",
        message: "素材が準備完了していません。",
      });
    }
  });
  if (issues.length > 0) {
    throw validationError(issues);
  }
}

async function assertVoiceProfileExists(
  prisma: PrismaClient,
  voiceProfileId: string | null,
): Promise<void> {
  if (voiceProfileId === null) {
    return;
  }
  const profile = await prisma.voiceProfile.findUnique({
    where: { id: voiceProfileId },
    select: { id: true },
  });
  if (profile === null) {
    throw validationError([
      {
        path: ["voiceProfileId"],
        code: "invalid_value",
        message: "声プロファイルが見つかりません。",
      },
    ]);
  }
}

async function assertAppearanceIdsUsable(
  prisma: PrismaClient,
  characterId: string | null,
  appearances: readonly AppearanceInput[],
): Promise<void> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const appearance of appearances) {
    if (seen.has(appearance.id)) {
      duplicates.add(appearance.id);
    } else {
      seen.add(appearance.id);
    }
  }
  if (duplicates.size > 0) {
    throw validationError([
      {
        path: ["appearances"],
        code: "custom",
        message: `外観のIDが重複しています: ${[...duplicates].join(", ")}`,
      },
    ]);
  }
  if (appearances.length === 0) {
    return;
  }
  const existing = await prisma.characterAppearance.findMany({
    where: { id: { in: appearances.map((appearance) => appearance.id) } },
    select: { id: true, characterId: true },
  });
  const conflicting = existing.filter((row) => row.characterId !== characterId);
  if (conflicting.length > 0) {
    throw validationError([
      {
        path: ["appearances"],
        code: "custom",
        message: `他のキャラクターで使われている外観IDです: ${conflicting
          .map((row) => row.id)
          .join(", ")}`,
      },
    ]);
  }
}

function toAppearanceData(appearance: AppearanceInput, position: number) {
  return {
    id: appearance.id,
    assetId: appearance.assetId,
    expression: appearance.expression,
    pose: appearance.pose,
    label: appearance.label === undefined || appearance.label.length === 0 ? null : appearance.label,
    position,
  };
}

function toAppearanceCreate(appearances: readonly AppearanceInput[]) {
  return appearances.map((appearance, index) => toAppearanceData(appearance, index));
}

export async function listCharacters(prisma: PrismaClient): Promise<CharacterLibraryEntry[]> {
  const rows = await prisma.character.findMany({
    include: { appearances: { orderBy: { position: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toCharacterLibraryEntry);
}

export async function getCharacter(
  prisma: PrismaClient,
  characterId: string,
): Promise<CharacterLibraryEntry> {
  const row = await prisma.character.findUnique({
    where: { id: characterId },
    include: { appearances: { orderBy: { position: "asc" } } },
  });
  if (row === null) {
    throw resourceNotFound("character", characterId);
  }
  return toCharacterLibraryEntry(row);
}

export async function createCharacter(
  prisma: PrismaClient,
  input: CreateCharacterRequest,
): Promise<CharacterLibraryEntry> {
  await assertAppearancesUsable(prisma, input.appearances);
  await assertAppearanceIdsUsable(prisma, null, input.appearances);
  await assertVoiceProfileExists(prisma, input.voiceProfileId);
  try {
    const row = await prisma.character.create({
      data: {
        name: input.name,
        voiceProfileId: input.voiceProfileId,
        appearances: { create: toAppearanceCreate(input.appearances) },
      },
      include: { appearances: { orderBy: { position: "asc" } } },
    });
    return toCharacterLibraryEntry(row);
  } catch (error) {
    if (isPrismaCode(error, "P2002")) {
      throw validationError([
        {
          path: ["appearances"],
          code: "custom",
          message: "外観のIDが既に使われています。",
        },
      ]);
    }
    throw error;
  }
}

export async function updateCharacter(
  prisma: PrismaClient,
  characterId: string,
  input: UpdateCharacterRequest,
): Promise<CharacterLibraryEntry> {
  await assertAppearancesUsable(prisma, input.appearances);
  await assertAppearanceIdsUsable(prisma, characterId, input.appearances);
  await assertVoiceProfileExists(prisma, input.voiceProfileId);
  const existing = await prisma.character.findUnique({
    where: { id: characterId },
    select: { id: true },
  });
  if (existing === null) {
    throw resourceNotFound("character", characterId);
  }
  try {
    const row = await prisma.$transaction(async (transaction) => {
      await transaction.characterAppearance.deleteMany({ where: { characterId } });
      return transaction.character.update({
        where: { id: characterId },
        data: {
          name: input.name,
          voiceProfileId: input.voiceProfileId,
          appearances: { create: toAppearanceCreate(input.appearances) },
        },
        include: { appearances: { orderBy: { position: "asc" } } },
      });
    });
    return toCharacterLibraryEntry(row);
  } catch (error) {
    if (isPrismaCode(error, "P2025")) {
      throw resourceNotFound("character", characterId);
    }
    if (isPrismaCode(error, "P2002")) {
      throw validationError([
        {
          path: ["appearances"],
          code: "custom",
          message: "外観のIDが既に使われています。",
        },
      ]);
    }
    throw error;
  }
}

export async function deleteCharacter(
  prisma: PrismaClient,
  characterId: string,
): Promise<void> {
  const existing = await prisma.character.findUnique({
    where: { id: characterId },
    select: { id: true },
  });
  if (existing === null) {
    throw resourceNotFound("character", characterId);
  }
  try {
    await prisma.character.delete({ where: { id: characterId } });
  } catch (error) {
    if (isPrismaCode(error, "P2025")) {
      throw resourceNotFound("character", characterId);
    }
    throw error;
  }
}

function isPrismaCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
}
