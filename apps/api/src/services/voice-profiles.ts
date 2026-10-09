import {
  voiceAdapterIdSchema,
  voiceProfileSettingsSchema,
  type ContentDocument,
  type CreateVoiceProfileRequest,
  type UpdateVoiceProfileRequest,
  type VoiceAdapterId,
  type VoiceList,
  type VoiceProfile,
} from "@kakeai/contracts";
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { deserializeContent } from "../domain/content-json.ts";
import { toVoiceProfile } from "../dto/mappers.ts";
import { ApiError } from "../http/errors.ts";
import { resourceNotFound } from "../http/validation.ts";
import { getTtsAdapter, TtsEngineUnavailableError } from "../tts/index.ts";
import type { AppConfig } from "../config.ts";

export async function listVoiceProfiles(prisma: PrismaClient): Promise<VoiceProfile[]> {
  const rows = await prisma.voiceProfile.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map(toVoiceProfile);
}

export async function getVoiceProfile(
  prisma: PrismaClient,
  voiceProfileId: string,
): Promise<VoiceProfile> {
  const row = await prisma.voiceProfile.findUnique({ where: { id: voiceProfileId } });
  if (row === null) {
    throw resourceNotFound("voice_profile", voiceProfileId);
  }
  return toVoiceProfile(row);
}

export async function createVoiceProfile(
  prisma: PrismaClient,
  input: CreateVoiceProfileRequest,
): Promise<VoiceProfile> {
  const row = await prisma.voiceProfile.create({
    data: {
      name: input.name,
      adapterId: input.adapterId,
      settingsJson: JSON.stringify(voiceProfileSettingsSchema.parse(input.settings)),
    },
  });
  return toVoiceProfile(row);
}

export async function updateVoiceProfile(
  prisma: PrismaClient,
  voiceProfileId: string,
  input: UpdateVoiceProfileRequest,
): Promise<VoiceProfile> {
  const existing = await prisma.voiceProfile.findUnique({ where: { id: voiceProfileId } });
  if (existing === null) {
    throw resourceNotFound("voice_profile", voiceProfileId);
  }
  try {
    const row = await prisma.voiceProfile.update({
      where: { id: voiceProfileId },
      data: {
        name: input.name,
        settingsJson: JSON.stringify(voiceProfileSettingsSchema.parse(input.settings)),
      },
    });
    return toVoiceProfile(row);
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2025") {
      throw resourceNotFound("voice_profile", voiceProfileId);
    }
    throw error;
  }
}

async function findVoiceProfileReferences(
  client: Prisma.TransactionClient,
  voiceProfileId: string,
): Promise<string[]> {
  const versions = await client.scriptVersion.findMany({
    select: { id: true, contentJson: true },
  });
  const references: string[] = [];
  for (const version of versions) {
    let content: ContentDocument;
    try {
      content = deserializeContent(version.contentJson);
    } catch {
      throw new ApiError(500, "INTERNAL_ERROR", "保存済みの台本を解釈できません。", {
        scriptVersionId: version.id,
      });
    }
    if (content.speakers.some((speaker) => speaker.voiceProfileId === voiceProfileId)) {
      references.push(version.id);
    }
  }
  return references;
}

export async function deleteVoiceProfile(
  prisma: PrismaClient,
  voiceProfileId: string,
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const existing = await transaction.voiceProfile.findUnique({ where: { id: voiceProfileId } });
    if (existing === null) {
      throw resourceNotFound("voice_profile", voiceProfileId);
    }
    const references = await findVoiceProfileReferences(transaction, voiceProfileId);
    const characters = await transaction.character.findMany({
      where: { voiceProfileId },
      select: { id: true },
    });
    if (references.length > 0 || characters.length > 0) {
      throw new ApiError(409, "VOICE_PROFILE_IN_USE", undefined, {
        voiceProfileId,
        scriptVersionIds: references,
        characterIds: characters.map((character) => character.id),
      });
    }
    await transaction.voiceProfile.delete({ where: { id: voiceProfileId } });
  });
}

export function parseAdapterId(value: string): VoiceAdapterId {
  const parsed = voiceAdapterIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(422, "VALIDATION_ERROR", undefined, {
      issues: [{ path: ["adapterId"], code: "invalid_value", message: "未対応のアダプターです。" }],
    });
  }
  return parsed.data;
}

export async function listAdapterVoices(
  config: AppConfig,
  adapterId: VoiceAdapterId,
): Promise<VoiceList> {
  const adapter = getTtsAdapter(adapterId);
  try {
    const listing = await adapter.listVoices(config.voicevoxBaseUrl);
    return { adapterId, voices: listing.voices };
  } catch (error) {
    if (error instanceof TtsEngineUnavailableError) {
      throw new ApiError(503, "TTS_ENGINE_UNAVAILABLE");
    }
    throw error;
  }
}
