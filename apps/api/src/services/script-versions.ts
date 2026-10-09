import {
  COMPOSITION_ENGINE,
  COMPILER_VERSION,
  HYPERFRAMES_PLAYER_VERSION,
  compileDocument,
  CompositionCompileError,
  type CompiledComposition,
  type ResolvedAssetKind,
} from "@kakeai/video";
import {
  RENDITION_PURPOSE,
  collectAssetReferences,
  computeContentWarnings,
  scriptVersionPreviewSchema,
  type AssetKindName,
  type AssetReference,
  type ContentDocument,
  type SaveScriptVersionRequest,
  type ScriptVersion as ScriptVersionDto,
  type ScriptVersionPreview,
  type ScriptVersionSummary,
  type Warning,
} from "@kakeai/contracts";
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { deserializeContent, serializeContent } from "../domain/content-json.ts";
import { toScriptVersion, toScriptVersionSummary } from "../dto/mappers.ts";
import { ApiError } from "../http/errors.ts";
import { API_BASE_PATH } from "../http/security.ts";
import { resourceNotFound, validationError, type ValidationIssue } from "../http/validation.ts";
import type { DataDirectories } from "../storage/paths.ts";
import { resolveAssetContent } from "./assets.ts";

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

function isVersionNumberConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; meta?: unknown };
  if (candidate.code !== "P2002") {
    return false;
  }
  const target = (candidate.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) {
    return target.includes("versionNumber");
  }
  if (typeof target === "string") {
    return target.includes("versionNumber");
  }
  return target === undefined;
}

export type AssetWithRenditions = Prisma.AssetGetPayload<{ include: { renditions: true } }>;

export interface LoadedAssetReferences {
  references: AssetReference[];
  assetById: Map<string, AssetWithRenditions>;
}

export async function loadAssetReferences(
  client: PrismaClient | Prisma.TransactionClient,
  content: ContentDocument,
): Promise<LoadedAssetReferences> {
  const references = collectAssetReferences(content);
  const ids = [...new Set(references.map((reference) => reference.assetId))];
  const assets =
    ids.length === 0
      ? []
      : await client.asset.findMany({
          where: { id: { in: ids } },
          include: { renditions: true },
        });
  return { references, assetById: new Map(assets.map((asset) => [asset.id, asset])) };
}

export function assertAssetsAvailable(
  references: AssetReference[],
  assetById: Map<string, AssetWithRenditions>,
): void {
  const uniqueIds = [...new Set(references.map((reference) => reference.assetId))];

  const missing = uniqueIds.filter((id) => !assetById.has(id));
  if (missing.length > 0) {
    throw new ApiError(422, "ASSET_NOT_FOUND", undefined, { assetIds: missing });
  }

  const processing = uniqueIds.filter((id) => assetById.get(id)?.status === "processing");
  if (processing.length > 0) {
    throw new ApiError(409, "ASSET_PROCESSING", undefined, { assetIds: processing });
  }

  const failed = uniqueIds.filter((id) => assetById.get(id)?.status === "failed");
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

export function assertTakeDurations(
  content: ContentDocument,
  assetById: Map<string, AssetWithRenditions>,
): void {
  const durationIssues: ValidationIssue[] = [];
  content.audioTakes.forEach((take, index) => {
    const asset = assetById.get(take.assetId);
    if (asset === undefined || asset.status !== "ready") {
      return;
    }
    const rendition = asset.renditions.find((row) => row.purpose === RENDITION_PURPOSE);
    const expectedMs = rendition?.durationMs ?? asset.durationMs;
    if (expectedMs !== null && take.durationMs !== expectedMs) {
      durationIssues.push({
        path: ["audioTakes", index, "durationMs"],
        code: "invalid_value",
        message: `音声 ${take.id} の尺が素材と一致しません。`,
      });
    }
  });
  if (durationIssues.length > 0) {
    throw validationError(durationIssues);
  }
}

async function validateAssetReferences(
  client: PrismaClient | Prisma.TransactionClient,
  content: ContentDocument,
): Promise<void> {
  if (content.audioTakes.length === 0 && collectAssetReferences(content).length === 0) {
    return;
  }
  const { references, assetById } = await loadAssetReferences(client, content);
  assertAssetsAvailable(references, assetById);
  assertTakeDurations(content, assetById);
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

export function renderSourceDurationMs(asset: AssetWithRenditions): number | null {
  const rendition = asset.renditions.find((entry) => entry.purpose === RENDITION_PURPOSE);
  return rendition?.durationMs ?? asset.durationMs;
}

export async function getScriptVersionPreview(
  prisma: PrismaClient,
  directories: DataDirectories,
  scriptVersionId: string,
): Promise<ScriptVersionPreview> {
  const row = await prisma.scriptVersion.findUnique({ where: { id: scriptVersionId } });
  if (row === null) {
    throw resourceNotFound("script_version", scriptVersionId);
  }
  let content: ContentDocument;
  try {
    content = deserializeContent(row.contentJson);
  } catch {
    throw new ApiError(500, "INTERNAL_ERROR", "保存済みの台本を解釈できません。");
  }

  const { references, assetById } = await loadAssetReferences(prisma, content);
  assertAssetsAvailable(references, assetById);

  const renderContentUrl = (assetId: string): string =>
    `${API_BASE_PATH}/assets/${encodeURIComponent(assetId)}/render-content`;

  let compiled: CompiledComposition;
  try {
    compiled = compileDocument({
      document: content,
      assetResolver: (assetId) => {
        const asset = assetById.get(assetId);
        const kind = asset?.kind;
        if (
          asset === undefined ||
          (kind !== "image" && kind !== "video" && kind !== "audio")
        ) {
          throw new CompositionCompileError([
            {
              path: ["assets", assetId],
              code: "unresolvable_asset",
              message: "素材を解決できません。",
            },
          ]);
        }
        return {
          url: renderContentUrl(assetId),
          kind: kind as ResolvedAssetKind,
          durationMs: kind === "audio" ? renderSourceDurationMs(asset) : null,
        };
      },
    });
  } catch (error) {
    if (error instanceof CompositionCompileError) {
      throw new ApiError(422, "PREVIEW_INPUT_INVALID", undefined, { issues: error.issues });
    }
    throw error;
  }

  const previewAssets = await Promise.all(
    compiled.assetIds.map(async (assetId) => {
      const location = await resolveAssetContent(prisma, directories, assetId, true);
      return { assetId, contentUrl: renderContentUrl(assetId), sha256: location.sha256 };
    }),
  );

  const preview = {
    scriptVersionId: row.id,
    compositionHtml: compiled.html,
    assets: previewAssets,
    renderer: {
      engine: COMPOSITION_ENGINE,
      compilerVersion: COMPILER_VERSION,
      playerVersion: HYPERFRAMES_PLAYER_VERSION,
    },
  };
  const parsed = scriptVersionPreviewSchema.safeParse(preview);
  if (!parsed.success) {
    throw new ApiError(500, "INTERNAL_ERROR", "プレビュー応答を生成できません。");
  }
  return parsed.data;
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

  const warnings = computeContentWarnings(content);
  const contentJson = serializeContent(content);

  const maxAttempts = 5;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        await validateAssetReferences(tx, content);
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
    } catch (error) {
      if (attempt < maxAttempts && isVersionNumberConflict(error)) {
        continue;
      }
      throw error;
    }
  }
}
