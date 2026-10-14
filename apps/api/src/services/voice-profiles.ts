import {
  localeSchema,
  voiceAdapterDescriptorFor,
  voiceAdapterDescriptors,
  voiceAdapterIdSchema,
  voiceProfileExtrasSchemaFor,
  type ContentDocument,
  type CreateVoiceProfileRequest,
  type UpdateVoiceProfileRequest,
  type ModelList,
  type VoiceAdapterId,
  type VoiceAdapterList,
  type VoiceList,
  type VoiceProfile,
  type VoiceProfileExtras,
} from "@kakeai/contracts";
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { deserializeContent } from "../domain/content-json.ts";
import { toVoiceProfile } from "../dto/mappers.ts";
import { ApiError } from "../http/errors.ts";
import { resourceNotFound, validationError } from "../http/validation.ts";
import { getTtsAdapter, TtsEngineUnavailableError } from "../tts/index.ts";
import { resolveVoiceBaseUrl, type AppConfig } from "../config.ts";

export function listVoiceAdapters(): VoiceAdapterList {
  return {
    adapters: voiceAdapterDescriptors.map((descriptor) => ({
      id: descriptor.id,
      label: descriptor.label,
      defaultLocale: descriptor.defaultLocale,
      voiceSelection: descriptor.voiceSelection,
      modelSelection: descriptor.modelSelection,
    })),
  };
}

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

function parseVoiceProfileExtras(
  adapterId: VoiceAdapterId,
  settings: unknown,
): VoiceProfileExtras {
  const parsed = voiceProfileExtrasSchemaFor(adapterId).safeParse(settings);
  if (!parsed.success) {
    throw validationError(
      parsed.error.issues.map((issue) => ({
        path: [
          "settings",
          ...issue.path.map((segment) =>
            typeof segment === "symbol" ? segment.toString() : segment,
          ),
        ],
        code: issue.code,
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

function parseVoiceProfileLocale(locale: unknown): string {
  const parsed = localeSchema.safeParse(locale);
  if (!parsed.success) {
    throw validationError([
      { path: ["locale"], code: "invalid_value", message: "未対応の言語です。" },
    ]);
  }
  return parsed.data;
}

export async function createVoiceProfile(
  prisma: PrismaClient,
  input: CreateVoiceProfileRequest,
): Promise<VoiceProfile> {
  const row = await prisma.voiceProfile.create({
    data: {
      name: input.name,
      adapterId: input.adapterId,
      voiceId: input.voiceId,
      locale: parseVoiceProfileLocale(input.locale),
      settingsJson: JSON.stringify(parseVoiceProfileExtras(input.adapterId, input.settings)),
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
  const adapterId = voiceAdapterIdSchema.safeParse(existing.adapterId);
  if (!adapterId.success) {
    throw new ApiError(500, "INTERNAL_ERROR", "声プロファイルのアダプターが不正です。");
  }
  const settings = parseVoiceProfileExtras(adapterId.data, input.settings);
  try {
    const row = await prisma.voiceProfile.update({
      where: { id: voiceProfileId },
      data: {
        name: input.name,
        voiceId: input.voiceId,
        locale: parseVoiceProfileLocale(input.locale),
        settingsJson: JSON.stringify(settings),
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
    const referenced =
      content.speakers.some((speaker) => speaker.voiceProfileId === voiceProfileId) ||
      content.characters.some((character) =>
        character.voices.some((voice) => voice.voiceProfileId === voiceProfileId),
      );
    if (referenced) {
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
    const characters = await transaction.characterVoice.findMany({
      where: { voiceProfileId },
      select: { characterId: true },
    });
    if (references.length > 0 || characters.length > 0) {
      throw new ApiError(409, "VOICE_PROFILE_IN_USE", undefined, {
        voiceProfileId,
        scriptVersionIds: references,
        characterIds: characters.map((character) => character.characterId),
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

function voiceQuerySettings(
  adapterId: VoiceAdapterId,
  model: string | undefined,
): VoiceProfileExtras | null {
  if (
    model === undefined ||
    model.trim().length === 0 ||
    !voiceAdapterDescriptorFor(adapterId).modelSelection
  ) {
    return null;
  }
  const parsed = voiceProfileExtrasSchemaFor(adapterId).safeParse({ model: model.trim() });
  if (!parsed.success) {
    throw validationError([
      { path: ["model"], code: "invalid_value", message: "model が不正です。" },
    ]);
  }
  return parsed.data;
}

export async function listAdapterVoices(
  config: AppConfig,
  adapterId: VoiceAdapterId,
  model?: string,
): Promise<VoiceList> {
  const adapter = getTtsAdapter(adapterId);
  try {
    const listing = await adapter.listVoices(
      { baseUrl: resolveVoiceBaseUrl(config, adapterId) },
      { settings: voiceQuerySettings(adapterId, model) },
    );
    return { adapterId, voices: listing.voices };
  } catch (error) {
    if (error instanceof TtsEngineUnavailableError) {
      throw new ApiError(503, "TTS_ENGINE_UNAVAILABLE");
    }
    throw error;
  }
}

export async function listAdapterModels(
  config: AppConfig,
  adapterId: VoiceAdapterId,
): Promise<ModelList> {
  const adapter = getTtsAdapter(adapterId);
  if (adapter.listModels === undefined) {
    return { adapterId, models: [] };
  }
  try {
    const models = await adapter.listModels({ baseUrl: resolveVoiceBaseUrl(config, adapterId) });
    return { adapterId, models };
  } catch (error) {
    if (error instanceof TtsEngineUnavailableError) {
      throw new ApiError(503, "TTS_ENGINE_UNAVAILABLE");
    }
    throw error;
  }
}
