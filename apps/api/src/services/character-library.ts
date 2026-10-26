import { randomUUID } from "node:crypto";
import {
  type CharacterLibraryEntry,
  type CreateCharacterRequest,
  type UpdateCharacterRequest,
} from "@kakeai/contracts";
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { toCharacterLibraryEntry } from "../dto/mappers.ts";
import { resourceNotFound, validationError, type ValidationIssue } from "../http/validation.ts";

type AppearanceInput = {
  id: string;
  assetId: string;
  expression: string;
  pose: string;
  label?: string;
  faceSetId: string | null;
};

type VoiceInput = {
  locale: string;
  voiceProfileId: string;
};

type NameInput = {
  locale: string;
  name: string;
};

function assertNamesUsable(names: readonly NameInput[]): void {
  const seen = new Set<string>();
  const issues: ValidationIssue[] = [];
  names.forEach((entry, index) => {
    if (seen.has(entry.locale)) {
      issues.push({
        path: ["names", index, "locale"],
        code: "invalid_value",
        message: "言語が重複しています。",
      });
      return;
    }
    seen.add(entry.locale);
    if (entry.name.trim().length === 0) {
      issues.push({
        path: ["names", index, "name"],
        code: "invalid_value",
        message: "名前を入力してください。",
      });
    }
  });
  if (issues.length > 0) {
    throw validationError(issues);
  }
}

async function assertAppearancesUsable(
  prisma: PrismaClient | Prisma.TransactionClient,
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

async function assertVoiceProfilesExist(
  prisma: PrismaClient | Prisma.TransactionClient,
  voices: readonly VoiceInput[],
): Promise<void> {
  const ids = [...new Set(voices.map((voice) => voice.voiceProfileId))];
  if (ids.length === 0) {
    return;
  }
  const rows = await prisma.voiceProfile.findMany({
    where: { id: { in: ids } },
    select: { id: true, locale: true },
  });
  const localeById = new Map(rows.map((row) => [row.id, row.locale]));
  const issues: ValidationIssue[] = [];
  const seenLocales = new Set<string>();
  voices.forEach((voice, index) => {
    if (seenLocales.has(voice.locale)) {
      issues.push({
        path: ["voices", index, "locale"],
        code: "invalid_value",
        message: "言語が重複しています。",
      });
      return;
    }
    seenLocales.add(voice.locale);
    const profileLocale = localeById.get(voice.voiceProfileId);
    if (profileLocale === undefined) {
      issues.push({
        path: ["voices", index, "voiceProfileId"],
        code: "invalid_value",
        message: "声プロファイルが見つかりません。",
      });
    } else if (profileLocale !== voice.locale) {
      issues.push({
        path: ["voices", index, "voiceProfileId"],
        code: "invalid_value",
        message: "声プロファイルの言語と一致しません。",
      });
    }
  });
  if (issues.length > 0) {
    throw validationError(issues);
  }
}

async function assertFaceSetsExist(
  prisma: PrismaClient | Prisma.TransactionClient,
  appearances: readonly AppearanceInput[],
): Promise<void> {
  const ids = [...new Set(appearances.map((appearance) => appearance.faceSetId))].filter(
    (faceSetId): faceSetId is string => faceSetId !== null,
  );
  if (ids.length === 0) {
    return;
  }
  const rows = await prisma.faceSet.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const found = new Set(rows.map((row) => row.id));
  const issues: ValidationIssue[] = [];
  appearances.forEach((appearance, index) => {
    if (appearance.faceSetId !== null && !found.has(appearance.faceSetId)) {
      issues.push({
        path: ["appearances", index, "faceSetId"],
        code: "invalid_value",
        message: "表情セットが見つかりません。",
      });
    }
  });
  if (issues.length > 0) {
    throw validationError(issues);
  }
}

async function assertAppearanceIdsUsable(
  prisma: PrismaClient | Prisma.TransactionClient,
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
    faceSetId: appearance.faceSetId,
    position,
  };
}

function toAppearanceCreate(appearances: readonly AppearanceInput[]) {
  return appearances.map((appearance, index) => toAppearanceData(appearance, index));
}

function toVoiceCreate(voices: readonly VoiceInput[]) {
  return voices.map((voice, index) => ({
    locale: voice.locale,
    voiceProfileId: voice.voiceProfileId,
    position: index,
  }));
}

function toNameCreate(names: readonly NameInput[]) {
  return names.map((entry, index) => ({
    locale: entry.locale,
    name: entry.name.trim(),
    position: index,
  }));
}

const characterInclude = {
  appearances: { orderBy: { position: "asc" } },
  voices: { orderBy: { position: "asc" } },
  names: { orderBy: { position: "asc" } },
} as const;

/**
 * Library appearance ids are internal keys: scripts copy appearances into
 * their own ids and Face Sets are referenced by `faceSetId`, so nothing
 * outside the Character row points at one. Callers that do not already track
 * an id (the Agent surface) let the server mint it.
 */
export function newCharacterAppearanceId(): string {
  return `appearance-${randomUUID()}`;
}

export async function listCharacters(prisma: PrismaClient): Promise<CharacterLibraryEntry[]> {
  const rows = await prisma.character.findMany({
    include: characterInclude,
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
    include: characterInclude,
  });
  if (row === null) {
    throw resourceNotFound("character", characterId);
  }
  return toCharacterLibraryEntry(row);
}

function appearanceIdConflictError() {
  return validationError([
    {
      path: ["appearances"],
      code: "custom",
      message: "外観のIDが既に使われています。",
    },
  ]);
}

export async function createCharacter(
  prisma: PrismaClient,
  input: CreateCharacterRequest,
): Promise<CharacterLibraryEntry> {
  assertNamesUsable(input.names);
  await assertAppearancesUsable(prisma, input.appearances);
  await assertAppearanceIdsUsable(prisma, null, input.appearances);
  await assertFaceSetsExist(prisma, input.appearances);
  await assertVoiceProfilesExist(prisma, input.voices);
  try {
    const row = await prisma.character.create({
      data: {
        name: input.name,
        names: { create: toNameCreate(input.names) },
        voices: { create: toVoiceCreate(input.voices) },
        appearances: { create: toAppearanceCreate(input.appearances) },
      },
      include: characterInclude,
    });
    return toCharacterLibraryEntry(row);
  } catch (error) {
    if (isPrismaCode(error, "P2002")) {
      throw appearanceIdConflictError();
    }
    throw error;
  }
}

export async function updateCharacter(
  prisma: PrismaClient,
  characterId: string,
  input: UpdateCharacterRequest,
): Promise<CharacterLibraryEntry> {
  assertNamesUsable(input.names);
  await assertAppearancesUsable(prisma, input.appearances);
  await assertAppearanceIdsUsable(prisma, characterId, input.appearances);
  await assertFaceSetsExist(prisma, input.appearances);
  await assertVoiceProfilesExist(prisma, input.voices);
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
      await transaction.characterVoice.deleteMany({ where: { characterId } });
      await transaction.characterName.deleteMany({ where: { characterId } });
      return transaction.character.update({
        where: { id: characterId },
        data: {
          name: input.name,
          names: { create: toNameCreate(input.names) },
          voices: { create: toVoiceCreate(input.voices) },
          appearances: { create: toAppearanceCreate(input.appearances) },
        },
        include: characterInclude,
      });
    });
    return toCharacterLibraryEntry(row);
  } catch (error) {
    if (isPrismaCode(error, "P2025")) {
      throw resourceNotFound("character", characterId);
    }
    if (isPrismaCode(error, "P2002")) {
      throw appearanceIdConflictError();
    }
    throw error;
  }
}

/** The members an agent partial update may change; omitted ones stay as-is. */
export interface CharacterUpdatePatch {
  name?: UpdateCharacterRequest["name"];
  names?: UpdateCharacterRequest["names"];
  voices?: UpdateCharacterRequest["voices"];
  appearances?: UpdateCharacterRequest["appearances"];
}

/**
 * Merges a partial update inside the write transaction. The current row is
 * read there, not by the caller, so a concurrent `character.setVoices` or UI
 * edit cannot be overwritten with a stale snapshot between a read and a write.
 */
export async function updateCharacterPartial(
  prisma: PrismaClient,
  characterId: string,
  patch: CharacterUpdatePatch,
): Promise<CharacterLibraryEntry> {
  if (patch.names !== undefined) {
    assertNamesUsable(patch.names);
  }
  try {
    return await prisma.$transaction(async (transaction) => {
      // Validate the referenced Asset / Face Set / Voice Profile inside the
      // write transaction. A Face Set has no foreign key, so a delete between
      // an outside check and this write would otherwise persist a dangling
      // reference; a Voice Profile delete would surface as a raw P2003.
      if (patch.appearances !== undefined) {
        await assertAppearancesUsable(transaction, patch.appearances);
        await assertAppearanceIdsUsable(transaction, characterId, patch.appearances);
        await assertFaceSetsExist(transaction, patch.appearances);
      }
      if (patch.voices !== undefined) {
        await assertVoiceProfilesExist(transaction, patch.voices);
      }
      const current = await transaction.character.findUnique({
        where: { id: characterId },
        include: characterInclude,
      });
      if (current === null) {
        throw resourceNotFound("character", characterId);
      }
      const entry = toCharacterLibraryEntry(current);
      const row = await transaction.character.update({
        where: { id: characterId },
        data: {
          name: patch.name ?? entry.name,
          names: { deleteMany: {}, create: toNameCreate(patch.names ?? entry.names) },
          voices: { deleteMany: {}, create: toVoiceCreate(patch.voices ?? entry.voices) },
          appearances: {
            deleteMany: {},
            create: toAppearanceCreate(patch.appearances ?? entry.appearances),
          },
        },
        include: characterInclude,
      });
      return toCharacterLibraryEntry(row);
    });
  } catch (error) {
    if (isPrismaCode(error, "P2025")) {
      throw resourceNotFound("character", characterId);
    }
    // The Agent surface mints fresh appearance ids, so this is a safety net
    // for callers that carry ids through (the app UI).
    if (isPrismaCode(error, "P2002")) {
      throw appearanceIdConflictError();
    }
    throw error;
  }
}

export async function setCharacterVoices(
  prisma: PrismaClient,
  characterId: string,
  voices: readonly VoiceInput[],
): Promise<CharacterLibraryEntry> {
  await assertVoiceProfilesExist(prisma, voices);
  const existing = await prisma.character.findUnique({
    where: { id: characterId },
    select: { id: true },
  });
  if (existing === null) {
    throw resourceNotFound("character", characterId);
  }
  try {
    const row = await prisma.$transaction(async (transaction) => {
      await transaction.characterVoice.deleteMany({ where: { characterId } });
      return transaction.character.update({
        where: { id: characterId },
        data: { voices: { create: toVoiceCreate(voices) } },
        include: characterInclude,
      });
    });
    return toCharacterLibraryEntry(row);
  } catch (error) {
    if (isPrismaCode(error, "P2025")) {
      throw resourceNotFound("character", characterId);
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
