import {
  createDefaultYouTubeVideoSettingsDocument,
  createYouTubeSettingsTemplateRequestSchema,
  updateYouTubeSettingsTemplateRequestSchema,
  updateYouTubeVideoSettingsRequestSchema,
  youtubeVideoSettingsDocumentSchema,
  type CreateYouTubeSettingsTemplateRequest,
  type UpdateYouTubeSettingsTemplateRequest,
  type UpdateYouTubeVideoSettingsRequest,
  type YouTubeChaptersResult,
  type YouTubeSettingsTemplate,
  type YouTubeSettingsTemplateSummary,
  type YouTubeVideoSettingsDocument,
  type YouTubeVideoSettingsView,
} from "@kakeai/contracts";
import { buildYouTubeChapterList, CompositionCompileError } from "@kakeai/video";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { ApiError } from "../http/errors.ts";
import { resourceNotFound, validationError } from "../http/validation.ts";
import { deserializeContent } from "../domain/content-json.ts";

function isPrismaCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === code
  );
}

export async function getYouTubeVideoSettings(
  prisma: PrismaClient,
  languageEditionId: string,
): Promise<YouTubeVideoSettingsView> {
  const edition = await prisma.languageEdition.findUnique({
    where: { id: languageEditionId },
    include: { work: { select: { title: true } } },
  });
  if (edition === null) {
    throw resourceNotFound("language_edition", languageEditionId);
  }

  const defaultDoc = createDefaultYouTubeVideoSettingsDocument(
    edition.work.title,
    edition.locale,
  );

  const settingsRow = await prisma.youTubeVideoSettings.upsert({
    where: { languageEditionId },
    create: {
      languageEditionId,
      schemaVersion: defaultDoc.schemaVersion,
      settingsJson: JSON.stringify(defaultDoc),
    },
    update: {},
  });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(settingsRow.settingsJson);
  } catch {
    throw new ApiError(
      500,
      "INTERNAL_ERROR",
      `保存済みのYouTube投稿設定を解釈できません: ${languageEditionId}`,
    );
  }

  const parsed = youtubeVideoSettingsDocumentSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new ApiError(
      500,
      "INTERNAL_ERROR",
      `保存済みのYouTube投稿設定がスキーマを満たしていません: ${languageEditionId}`,
    );
  }

  return {
    languageEditionId,
    document: parsed.data,
    updatedAt: settingsRow.updatedAt.toISOString(),
  };
}

export async function updateYouTubeVideoSettings(
  prisma: PrismaClient,
  languageEditionId: string,
  input: UpdateYouTubeVideoSettingsRequest,
): Promise<YouTubeVideoSettingsView> {
  const edition = await prisma.languageEdition.findUnique({
    where: { id: languageEditionId },
    select: { id: true },
  });
  if (edition === null) {
    throw resourceNotFound("language_edition", languageEditionId);
  }

  const validated = updateYouTubeVideoSettingsRequestSchema.safeParse(input);
  if (!validated.success) {
    throw validationError(
      validated.error.issues.map((i) => ({
        path: i.path as (string | number)[],
        code: i.code,
        message: i.message,
      })),
    );
  }
  const validatedDoc = validated.data;

  const updatedRow = await prisma.youTubeVideoSettings.upsert({
    where: { languageEditionId },
    create: {
      languageEditionId,
      schemaVersion: validatedDoc.schemaVersion,
      settingsJson: JSON.stringify(validatedDoc),
    },
    update: {
      schemaVersion: validatedDoc.schemaVersion,
      settingsJson: JSON.stringify(validatedDoc),
    },
  });

  return {
    languageEditionId,
    document: JSON.parse(updatedRow.settingsJson) as YouTubeVideoSettingsDocument,
    updatedAt: updatedRow.updatedAt.toISOString(),
  };
}

export async function getYouTubeChaptersForScriptVersion(
  prisma: PrismaClient,
  scriptVersionId: string,
): Promise<YouTubeChaptersResult> {
  const scriptVersion = await prisma.scriptVersion.findUnique({
    where: { id: scriptVersionId },
    select: { id: true, contentJson: true },
  });
  if (scriptVersion === null) {
    throw resourceNotFound("script_version", scriptVersionId);
  }

  const contentDoc = deserializeContent(scriptVersion.contentJson);
  try {
    const result = buildYouTubeChapterList(contentDoc);
    return {
      scriptVersionId,
      chaptersText: result.chaptersText,
      warnings: result.warnings,
    };
  } catch (error) {
    if (error instanceof CompositionCompileError) {
      throw new ApiError(422, "RENDER_INPUT_INVALID", undefined, {
        issues: error.issues,
      });
    }
    throw error;
  }
}

export async function listYouTubeSettingsTemplates(
  prisma: PrismaClient,
): Promise<YouTubeSettingsTemplateSummary[]> {
  const templates = await prisma.youTubeSettingsTemplate.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }));
}

export async function getYouTubeSettingsTemplate(
  prisma: PrismaClient,
  templateId: string,
): Promise<YouTubeSettingsTemplate> {
  const row = await prisma.youTubeSettingsTemplate.findUnique({
    where: { id: templateId },
  });
  if (row === null) {
    throw resourceNotFound("youtube_settings_template", templateId);
  }

  return {
    id: row.id,
    name: row.name,
    document: JSON.parse(row.settingsJson) as YouTubeVideoSettingsDocument,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createYouTubeSettingsTemplate(
  prisma: PrismaClient,
  input: CreateYouTubeSettingsTemplateRequest,
): Promise<YouTubeSettingsTemplate> {
  const validated = createYouTubeSettingsTemplateRequestSchema.safeParse(input);
  if (!validated.success) {
    throw validationError(
      validated.error.issues.map((i) => ({
        path: i.path as (string | number)[],
        code: i.code,
        message: i.message,
      })),
    );
  }
  const parsed = validated.data;

  const existing = await prisma.youTubeSettingsTemplate.findUnique({
    where: { name: parsed.name },
  });
  if (existing !== null) {
    throw new ApiError(409, "VALIDATION_ERROR", "同名のテンプレートが既に存在します。");
  }

  try {
    const row = await prisma.youTubeSettingsTemplate.create({
      data: {
        name: parsed.name,
        settingsJson: JSON.stringify(parsed.document),
      },
    });

    return {
      id: row.id,
      name: row.name,
      document: JSON.parse(row.settingsJson) as YouTubeVideoSettingsDocument,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  } catch (error) {
    if (isPrismaCode(error, "P2002")) {
      throw new ApiError(409, "VALIDATION_ERROR", "同名のテンプレートが既に存在します。");
    }
    throw error;
  }
}

export async function updateYouTubeSettingsTemplate(
  prisma: PrismaClient,
  templateId: string,
  input: UpdateYouTubeSettingsTemplateRequest,
): Promise<YouTubeSettingsTemplate> {
  const existingTemplate = await prisma.youTubeSettingsTemplate.findUnique({
    where: { id: templateId },
  });
  if (existingTemplate === null) {
    throw resourceNotFound("youtube_settings_template", templateId);
  }

  const validated = updateYouTubeSettingsTemplateRequestSchema.safeParse(input);
  if (!validated.success) {
    throw validationError(
      validated.error.issues.map((i) => ({
        path: i.path as (string | number)[],
        code: i.code,
        message: i.message,
      })),
    );
  }
  const parsed = validated.data;

  if (parsed.name !== existingTemplate.name) {
    const nameConflict = await prisma.youTubeSettingsTemplate.findUnique({
      where: { name: parsed.name },
    });
    if (nameConflict !== null) {
      throw new ApiError(409, "VALIDATION_ERROR", "同名のテンプレートが既に存在します。");
    }
  }

  try {
    const updatedRow = await prisma.youTubeSettingsTemplate.update({
      where: { id: templateId },
      data: {
        name: parsed.name,
        settingsJson: JSON.stringify(parsed.document),
      },
    });

    return {
      id: updatedRow.id,
      name: updatedRow.name,
      document: JSON.parse(updatedRow.settingsJson) as YouTubeVideoSettingsDocument,
      createdAt: updatedRow.createdAt.toISOString(),
      updatedAt: updatedRow.updatedAt.toISOString(),
    };
  } catch (error) {
    if (isPrismaCode(error, "P2002")) {
      throw new ApiError(409, "VALIDATION_ERROR", "同名のテンプレートが既に存在します。");
    }
    throw error;
  }
}

export async function deleteYouTubeSettingsTemplate(
  prisma: PrismaClient,
  templateId: string,
): Promise<void> {
  const existing = await prisma.youTubeSettingsTemplate.findUnique({
    where: { id: templateId },
  });
  if (existing === null) {
    throw resourceNotFound("youtube_settings_template", templateId);
  }

  await prisma.youTubeSettingsTemplate.delete({
    where: { id: templateId },
  });
}
