import {
  collectAssetReferences,
  computeContentWarnings,
  type AssetKindName,
  type ContentDocument,
  type SaveScriptVersionRequest,
  type ScriptVersion as ScriptVersionDto,
  type ScriptVersionSummary,
  type Warning,
} from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { deserializeContent, serializeContent } from "../domain/content-json.ts";
import { toScriptVersion, toScriptVersionSummary } from "../dto/mappers.ts";
import { ApiError } from "../http/errors.ts";
import { resourceNotFound, validationError, type ValidationIssue } from "../http/validation.ts";

export interface SaveScriptVersionResult {
  scriptVersion: ScriptVersionDto;
  warnings: Warning[];
}

async function requireEdition(prisma: PrismaClient, editionId: string) {
  const edition = await prisma.languageEdition.findUnique({ where: { id: editionId } });
  if (edition === null) {
    throw resourceNotFound("language_edition", editionId);
  }
  return edition;
}

async function validateAssetReferences(
  prisma: PrismaClient,
  content: ContentDocument,
): Promise<void> {
  const references = collectAssetReferences(content);
  if (references.length === 0) {
    return;
  }
  const ids = [...new Set(references.map((reference) => reference.assetId))];
  const assets = await prisma.asset.findMany({ where: { id: { in: ids } } });
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));

  const missing = ids.filter((id) => !assetById.has(id));
  if (missing.length > 0) {
    throw new ApiError(422, "ASSET_NOT_FOUND", undefined, { assetIds: missing });
  }

  const processing = ids.filter((id) => assetById.get(id)?.status === "processing");
  if (processing.length > 0) {
    throw new ApiError(409, "ASSET_PROCESSING", undefined, { assetIds: processing });
  }

  const failed = ids.filter((id) => assetById.get(id)?.status === "failed");
  if (failed.length > 0) {
    throw new ApiError(422, "ASSET_UNAVAILABLE", undefined, { assetIds: failed });
  }

  const kindIssues: ValidationIssue[] = [];
  for (const reference of references) {
    const asset = assetById.get(reference.assetId);
    if (asset === undefined) {
      continue;
    }
    if (!reference.allowedKinds.includes(asset.kind as AssetKindName)) {
      kindIssues.push({
        path: reference.path,
        code: "invalid_type",
        message: `素材 ${reference.assetId} はこの用途に使えません。`,
      });
    }
  }
  if (kindIssues.length > 0) {
    throw validationError(kindIssues);
  }
}

export async function getCurrentScriptVersion(
  prisma: PrismaClient,
  editionId: string,
): Promise<ScriptVersionDto> {
  const edition = await prisma.languageEdition.findUnique({
    where: { id: editionId },
    include: { currentScriptVersion: true },
  });
  if (edition === null) {
    throw resourceNotFound("language_edition", editionId);
  }
  const current = edition.currentScriptVersion;
  if (current === null) {
    throw new ApiError(500, "INTERNAL_ERROR", "現在の台本版が設定されていません。");
  }
  return toScriptVersion(current, deserializeContent(current.contentJson));
}

export async function listScriptVersions(
  prisma: PrismaClient,
  editionId: string,
): Promise<ScriptVersionSummary[]> {
  await requireEdition(prisma, editionId);
  const rows = await prisma.scriptVersion.findMany({
    where: { languageEditionId: editionId },
    orderBy: { versionNumber: "desc" },
  });
  return rows.map(toScriptVersionSummary);
}

export async function getScriptVersion(
  prisma: PrismaClient,
  scriptVersionId: string,
): Promise<ScriptVersionDto> {
  const row = await prisma.scriptVersion.findUnique({ where: { id: scriptVersionId } });
  if (row === null) {
    throw resourceNotFound("script_version", scriptVersionId);
  }
  return toScriptVersion(row, deserializeContent(row.contentJson));
}

export async function saveScriptVersion(
  prisma: PrismaClient,
  editionId: string,
  input: SaveScriptVersionRequest,
): Promise<SaveScriptVersionResult> {
  const edition = await requireEdition(prisma, editionId);
  const { content, sourceScriptVersionId } = input;

  if (content.locale !== edition.locale) {
    throw validationError([
      {
        path: ["content", "locale"],
        code: "invalid_value",
        message: `言語版のロケール(${edition.locale})と一致しません。`,
      },
    ]);
  }

  if (sourceScriptVersionId !== null) {
    const source = await prisma.scriptVersion.findUnique({
      where: { id: sourceScriptVersionId },
      select: { languageEditionId: true },
    });
    if (source === null || source.languageEditionId !== editionId) {
      throw validationError([
        {
          path: ["sourceScriptVersionId"],
          code: "invalid_value",
          message: "復元元は同じ言語版の版を指定してください。",
        },
      ]);
    }
  }

  await validateAssetReferences(prisma, content);

  const warnings = computeContentWarnings(content);
  const contentJson = serializeContent(content);

  const created = await prisma.$transaction(async (tx) => {
    const aggregate = await tx.scriptVersion.aggregate({
      where: { languageEditionId: editionId },
      _max: { versionNumber: true },
    });
    const versionNumber = (aggregate._max.versionNumber ?? 0) + 1;
    const row = await tx.scriptVersion.create({
      data: {
        languageEditionId: editionId,
        versionNumber,
        contentSchemaVersion: content.schemaVersion,
        contentJson,
        sourceScriptVersionId,
      },
    });
    await tx.languageEdition.update({
      where: { id: editionId },
      data: { currentScriptVersionId: row.id },
    });
    await tx.work.update({ where: { id: edition.workId }, data: { updatedAt: new Date() } });
    return row;
  });

  return { scriptVersion: toScriptVersion(created, deserializeContent(contentJson)), warnings };
}
