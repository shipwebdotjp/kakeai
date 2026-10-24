import {
  normalizeThumbnailAppearance,
  thumbnailAppearanceSchema,
  type CreateThumbnailAppearancePresetRequest,
  type ThumbnailAppearance,
  type ThumbnailAppearancePreset,
  type ThumbnailAppearancePresetSummary,
  type UpdateThumbnailAppearancePresetRequest,
} from "@kakeai/contracts";
import type {
  PrismaClient,
  ThumbnailAppearancePreset as ThumbnailAppearancePresetRow,
} from "../generated/prisma/client.ts";
import {
  toThumbnailAppearancePreset,
  toThumbnailAppearancePresetSummary,
} from "../dto/mappers.ts";
import { ApiError } from "../http/errors.ts";
import { resourceNotFound, validationError } from "../http/validation.ts";

function isPrismaCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
}

function requireAppearance(appearance: ThumbnailAppearance): ThumbnailAppearance {
  const normalized = normalizeThumbnailAppearance(appearance);
  if (normalized === null) {
    throw validationError([
      {
        path: ["appearance"],
        code: "invalid_value",
        message: "外観の上書きがありません。",
      },
    ]);
  }
  return normalized;
}

function parseStoredAppearance(row: ThumbnailAppearancePresetRow): ThumbnailAppearance {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(row.appearanceJson);
  } catch {
    throw new ApiError(500, "INTERNAL_ERROR", `外観プリセットを解釈できません: ${row.id}`);
  }
  const parsed = thumbnailAppearanceSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new ApiError(500, "INTERNAL_ERROR", `外観プリセットが不正です: ${row.id}`);
  }
  const normalized = normalizeThumbnailAppearance(parsed.data);
  if (normalized === null) {
    throw new ApiError(500, "INTERNAL_ERROR", `外観プリセットが空です: ${row.id}`);
  }
  return normalized;
}

export async function listThumbnailAppearancePresets(
  prisma: PrismaClient,
): Promise<ThumbnailAppearancePresetSummary[]> {
  const rows = await prisma.thumbnailAppearancePreset.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, createdAt: true, updatedAt: true },
  });
  return rows.map(toThumbnailAppearancePresetSummary);
}

export async function getThumbnailAppearancePreset(
  prisma: PrismaClient,
  presetId: string,
): Promise<ThumbnailAppearancePreset> {
  const row = await prisma.thumbnailAppearancePreset.findUnique({
    where: { id: presetId },
  });
  if (row === null) {
    throw resourceNotFound("thumbnail_appearance_preset", presetId);
  }
  return toThumbnailAppearancePreset(row, parseStoredAppearance(row));
}

export async function createThumbnailAppearancePreset(
  prisma: PrismaClient,
  input: CreateThumbnailAppearancePresetRequest,
): Promise<ThumbnailAppearancePreset> {
  const appearance = requireAppearance(input.appearance);
  const row = await prisma.thumbnailAppearancePreset.create({
    data: {
      name: input.name,
      appearanceJson: JSON.stringify(appearance),
    },
  });
  return toThumbnailAppearancePreset(row, appearance);
}

export async function updateThumbnailAppearancePreset(
  prisma: PrismaClient,
  presetId: string,
  input: UpdateThumbnailAppearancePresetRequest,
): Promise<ThumbnailAppearancePreset> {
  const existing = await prisma.thumbnailAppearancePreset.findUnique({
    where: { id: presetId },
    select: { id: true },
  });
  if (existing === null) {
    throw resourceNotFound("thumbnail_appearance_preset", presetId);
  }
  const appearance = requireAppearance(input.appearance);
  let row: ThumbnailAppearancePresetRow;
  try {
    row = await prisma.thumbnailAppearancePreset.update({
      where: { id: presetId },
      data: {
        name: input.name,
        appearanceJson: JSON.stringify(appearance),
      },
    });
  } catch (error) {
    if (isPrismaCode(error, "P2025")) {
      throw resourceNotFound("thumbnail_appearance_preset", presetId);
    }
    throw error;
  }
  return toThumbnailAppearancePreset(row, appearance);
}

export async function deleteThumbnailAppearancePreset(
  prisma: PrismaClient,
  presetId: string,
): Promise<void> {
  const existing = await prisma.thumbnailAppearancePreset.findUnique({
    where: { id: presetId },
    select: { id: true },
  });
  if (existing === null) {
    throw resourceNotFound("thumbnail_appearance_preset", presetId);
  }
  try {
    await prisma.thumbnailAppearancePreset.delete({ where: { id: presetId } });
  } catch (error) {
    if (isPrismaCode(error, "P2025")) {
      throw resourceNotFound("thumbnail_appearance_preset", presetId);
    }
    throw error;
  }
}
