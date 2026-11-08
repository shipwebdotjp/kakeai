import {
  liveAutoProfileResultSchema,
  type LiveAutoProfileRequest,
  type LiveAutoProfileResult,
} from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { deserializeContent } from "../domain/content-json.ts";
import { ApiError } from "../http/errors.ts";
import { resourceNotFound } from "../http/validation.ts";
import { buildAutoShowProfile, AutoProfileError } from "../live/auto-profile.ts";
import {
  assertAssetsAvailable,
  assertFaceSetReferences,
  loadAllReferences,
} from "./script-versions/references.ts";

function inputError(message: string, id: string | null = null): never {
  throw new ApiError(422, "VALIDATION_ERROR", message, id === null ? undefined : { id });
}

/**
 * Generates a Show Profile draft from the current ScriptVersion and validates
 * the references that would otherwise fail late in the live export Job.
 */
export async function buildLiveAutoProfile(
  prisma: PrismaClient,
  input: LiveAutoProfileRequest,
): Promise<LiveAutoProfileResult> {
  const work = await prisma.work.findUnique({
    where: { id: input.workId },
    select: { id: true, title: true },
  });
  if (work === null) {
    throw resourceNotFound("work", input.workId);
  }

  const row = await prisma.scriptVersion.findUnique({
    where: { id: input.scriptVersionId },
    include: {
      languageEdition: {
        select: { id: true, workId: true },
      },
    },
  });
  if (row === null) {
    throw resourceNotFound("script_version", input.scriptVersionId);
  }
  if (row.languageEdition.workId !== input.workId) {
    inputError("workId と ScriptVersion が一致しません。");
  }

  let content;
  try {
    content = deserializeContent(row.contentJson);
  } catch {
    throw new ApiError(500, "INTERNAL_ERROR", "保存済みの台本を解釈できません。");
  }
  if (content.locale !== "ja-JP") {
    inputError("ライブは ja-JP の台本だけに対応しています。");
  }

  const { references, assetById, faceSetByKey } = await loadAllReferences(
    prisma,
    content,
  );
  assertAssetsAvailable(references, assetById);
  assertFaceSetReferences(content, faceSetByKey, assetById);

  const assetKindById = new Map(
    [...assetById].map(([assetId, asset]) => [assetId, { kind: asset.kind }]),
  );

  const title = (input.title ?? work.title).trim();
  if (title.length === 0) {
    inputError("show.title が空です。");
  }

  let result: LiveAutoProfileResult;
  try {
    result = buildAutoShowProfile({
      title,
      content,
      includeCommentCorners: input.includeCommentCorners,
      assetKindById,
    });
  } catch (error) {
    if (error instanceof AutoProfileError) {
      inputError(error.message);
    }
    throw error;
  }

  await assertSelectedCharacters(content, result, prisma);
  const parsed = liveAutoProfileResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new ApiError(
      500,
      "INTERNAL_ERROR",
      "自動生成した Show Profile を検証できませんでした。",
    );
  }
  return parsed.data;
}

async function assertSelectedCharacters(
  content: ReturnType<typeof deserializeContent>,
  result: LiveAutoProfileResult,
  prisma: PrismaClient,
): Promise<void> {
  const characterIds = [result.profile.show.characters.left, result.profile.show.characters.right]
    .filter((id): id is string => id !== null);
  const voiceProfileIds = new Set<string>();
  for (const characterId of characterIds) {
    const character = content.characters.find((entry) => entry.id === characterId);
    if (character === undefined) {
      inputError(`キャラクターが見つかりません: ${characterId}`, characterId);
    }
    if (!character.appearances.some((appearance) => appearance.expression === "normal")) {
      inputError(
        `キャラクター ${characterId} に expression: normal の外観がありません。`,
        characterId,
      );
    }
    const speakers = content.speakers.filter(
      (entry) => entry.characterId === characterId,
    );
    if (speakers.length !== 1) {
      inputError(
        `キャラクター ${characterId} の話者が1人ではありません。v1では1キャラクター1話者にしてください。`,
        characterId,
      );
    }
    const speaker = speakers[0]!;
    if (speaker.voiceProfileId === null) {
      inputError(`キャラクター ${characterId} の声プロファイルがありません。`, characterId);
    }
    voiceProfileIds.add(speaker.voiceProfileId);
  }

  if (voiceProfileIds.size === 0) {
    return;
  }
  const rows = await prisma.voiceProfile.findMany({
    where: { id: { in: [...voiceProfileIds] } },
    select: { id: true },
  });
  const found = new Set(rows.map((row) => row.id));
  const missing = [...voiceProfileIds].filter((id) => !found.has(id));
  if (missing.length > 0) {
    inputError(`声プロファイルが見つかりません: ${missing.join(", ")}`, missing[0]!);
  }
}
