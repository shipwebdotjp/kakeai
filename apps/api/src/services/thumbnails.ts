import { readFile } from "node:fs/promises";
import {
  THUMBNAIL_SCHEMA_VERSION,
  collectThumbnailAssetRefs,
  getThumbnailTemplate,
  thumbnailDocumentSchema,
  type CreateThumbnailRequest,
  type SaveThumbnailRequest,
  type Thumbnail as ThumbnailDto,
  type ThumbnailDocument,
  type ThumbnailPreview,
  type ThumbnailPreviewRequest,
} from "@kakeai/contracts";
import {
  CompositionCompileError,
  compileThumbnail,
  type CompiledThumbnail,
} from "@kakeai/video";
import type { z } from "zod";
import type { PrismaClient, Thumbnail as ThumbnailRow } from "../generated/prisma/client.ts";
import { deserializeContent } from "../domain/content-json.ts";
import { renderContentUrl, toThumbnail } from "../dto/mappers.ts";
import { ApiError } from "../http/errors.ts";
import { resourceNotFound, validationError, type ValidationIssue } from "../http/validation.ts";
import type { DataDirectories } from "../storage/paths.ts";
import type { AssetResolver } from "@kakeai/video";
import { resolveAssetContent } from "./assets.ts";
import { assertAssetsAvailable, type AssetWithRenditions } from "./script-versions.ts";
import { ThemeResolver } from "./theme-resolver.ts";
import type { Rasterizer } from "../media/rasterize.ts";

const MAX_THUMBNAIL_ASSET_BYTES = 10 * 1024 * 1024;

function zodIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map((segment) => (typeof segment === "symbol" ? segment.toString() : segment)),
    code: issue.code,
    message: issue.message,
  }));
}

export function serializeThumbnailDocument(document: ThumbnailDocument): string {
  return JSON.stringify({
    schemaVersion: document.schemaVersion,
    template: document.template,
    input: document.input,
  });
}

export function parseThumbnailDocument(inputJson: string): ThumbnailDocument {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(inputJson);
  } catch {
    throw new ApiError(500, "INTERNAL_ERROR", "サムネイルの入力を解釈できません。");
  }
  const parsed = thumbnailDocumentSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new ApiError(500, "INTERNAL_ERROR", "サムネイルの入力が不正です。");
  }
  return parsed.data;
}

async function validateDocument(
  prisma: PrismaClient,
  document: ThumbnailDocument,
): Promise<void> {
  const { id, version } = document.template;
  const definition = getThumbnailTemplate(id, version);
  if (definition === undefined) {
    throw validationError([
      {
        path: ["template"],
        code: "invalid_value",
        message: `未対応のサムネイルテンプレートです: ${id}@${version}`,
      },
    ]);
  }
  const parsed = definition.inputSchema.safeParse(document.input);
  if (!parsed.success) {
    throw validationError(zodIssues(parsed.error));
  }
  const references = collectThumbnailAssetRefs(document);
  if (references.length === 0) {
    return;
  }
  const ids = [...new Set(references.map((reference) => reference.assetId))];
  const assets = await prisma.asset.findMany({
    where: { id: { in: ids } },
    include: { renditions: true },
  });
  const assetById = new Map<string, AssetWithRenditions>(
    assets.map((asset) => [asset.id, asset]),
  );
  assertAssetsAvailable(references, assetById);
}

async function requireEditionWithTheme(prisma: PrismaClient, editionId: string) {
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
  const content = deserializeContent(current.contentJson);
  const theme = await new ThemeResolver(prisma).resolve(
    content.visualTheme.id,
    content.visualTheme.version,
  );
  if (theme === undefined) {
    throw validationError([
      {
        path: ["visualTheme"],
        code: "invalid_value",
        message: `Visual Themeが見つかりません: ${content.visualTheme.id}@${content.visualTheme.version}`,
      },
    ]);
  }
  return { edition, theme };
}

function compile(
  document: ThumbnailDocument,
  theme: Parameters<typeof compileThumbnail>[0]["theme"],
  assetResolver: AssetResolver,
): CompiledThumbnail {
  try {
    return compileThumbnail({ document, theme, assetResolver });
  } catch (error) {
    if (error instanceof CompositionCompileError) {
      throw new ApiError(422, "THUMBNAIL_INPUT_INVALID", undefined, { issues: error.issues });
    }
    throw error;
  }
}

export async function listThumbnails(
  prisma: PrismaClient,
  editionId: string,
): Promise<ThumbnailDto[]> {
  const edition = await prisma.languageEdition.findUnique({
    where: { id: editionId },
    select: { id: true, primaryThumbnailId: true },
  });
  if (edition === null) {
    throw resourceNotFound("language_edition", editionId);
  }
  const rows = await prisma.thumbnail.findMany({
    where: { languageEditionId: editionId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => toThumbnail(row, row.id === edition.primaryThumbnailId));
}

export async function getThumbnail(
  prisma: PrismaClient,
  thumbnailId: string,
): Promise<ThumbnailDto> {
  const row = await prisma.thumbnail.findUnique({
    where: { id: thumbnailId },
    include: { languageEdition: { select: { primaryThumbnailId: true } } },
  });
  if (row === null) {
    throw resourceNotFound("thumbnail", thumbnailId);
  }
  return toThumbnail(row, row.id === row.languageEdition.primaryThumbnailId);
}

export async function createThumbnail(
  prisma: PrismaClient,
  editionId: string,
  input: CreateThumbnailRequest,
): Promise<ThumbnailDto> {
  await requireEditionWithTheme(prisma, editionId);
  const document: ThumbnailDocument = {
    schemaVersion: THUMBNAIL_SCHEMA_VERSION,
    template: input.template,
    input: input.input,
  };
  await validateDocument(prisma, document);
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.thumbnail.create({
      data: {
        languageEditionId: editionId,
        label: input.label,
        schemaVersion: document.schemaVersion,
        templateId: document.template.id,
        templateVersion: document.template.version,
        inputJson: serializeThumbnailDocument(document),
      },
    });
    const elected = await tx.languageEdition.updateMany({
      where: { id: editionId, primaryThumbnailId: null },
      data: { primaryThumbnailId: row.id },
    });
    return { row, isPrimary: elected.count > 0 };
  });
  return toThumbnail(created.row, created.isPrimary);
}

export async function saveThumbnail(
  prisma: PrismaClient,
  thumbnailId: string,
  input: SaveThumbnailRequest,
): Promise<ThumbnailDto> {
  const existing = await prisma.thumbnail.findUnique({
    where: { id: thumbnailId },
    include: { languageEdition: { select: { primaryThumbnailId: true } } },
  });
  if (existing === null) {
    throw resourceNotFound("thumbnail", thumbnailId);
  }
  const document: ThumbnailDocument = {
    schemaVersion: THUMBNAIL_SCHEMA_VERSION,
    template: input.template,
    input: input.input,
  };
  await validateDocument(prisma, document);
  const row = await prisma.thumbnail.update({
    where: { id: thumbnailId },
    data: {
      label: input.label,
      schemaVersion: document.schemaVersion,
      templateId: document.template.id,
      templateVersion: document.template.version,
      inputJson: serializeThumbnailDocument(document),
    },
  });
  return toThumbnail(row, row.id === existing.languageEdition.primaryThumbnailId);
}

export async function deleteThumbnail(prisma: PrismaClient, thumbnailId: string): Promise<void> {
  const row = await prisma.thumbnail.findUnique({ where: { id: thumbnailId } });
  if (row === null) {
    throw resourceNotFound("thumbnail", thumbnailId);
  }
  await prisma.$transaction(async (tx) => {
    const edition = await tx.languageEdition.findUnique({
      where: { id: row.languageEditionId },
      select: { primaryThumbnailId: true },
    });
    await tx.thumbnail.delete({ where: { id: thumbnailId } });
    if (edition?.primaryThumbnailId === thumbnailId) {
      const fallback = await tx.thumbnail.findFirst({
        where: { languageEditionId: row.languageEditionId },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      await tx.languageEdition.update({
        where: { id: row.languageEditionId },
        data: { primaryThumbnailId: fallback?.id ?? null },
      });
    }
  });
}

export async function setPrimaryThumbnail(
  prisma: PrismaClient,
  editionId: string,
  thumbnailId: string | null,
): Promise<ThumbnailDto | null> {
  const edition = await prisma.languageEdition.findUnique({
    where: { id: editionId },
    select: { id: true },
  });
  if (edition === null) {
    throw resourceNotFound("language_edition", editionId);
  }
  if (thumbnailId !== null) {
    const row = await prisma.thumbnail.findUnique({
      where: { id: thumbnailId },
      select: { languageEditionId: true },
    });
    if (row === null || row.languageEditionId !== editionId) {
      throw resourceNotFound("thumbnail", thumbnailId);
    }
  }
  await prisma.languageEdition.update({
    where: { id: editionId },
    data: { primaryThumbnailId: thumbnailId },
  });
  if (thumbnailId === null) {
    return null;
  }
  return getThumbnail(prisma, thumbnailId);
}

export async function createThumbnailPreview(
  prisma: PrismaClient,
  editionId: string,
  input: ThumbnailPreviewRequest,
): Promise<ThumbnailPreview> {
  const document: ThumbnailDocument = {
    schemaVersion: THUMBNAIL_SCHEMA_VERSION,
    template: input.template,
    input: input.input,
  };
  await validateDocument(prisma, document);
  const { theme } = await requireEditionWithTheme(prisma, editionId);
  const compiled = compile(document, theme, (assetId) => ({
    url: renderContentUrl(assetId),
    kind: "image",
  }));
  return { html: compiled.html, width: compiled.width, height: compiled.height };
}

export interface ThumbnailImage {
  filename: string;
  png: Buffer;
}

function pngFilename(title: string): string {
  const cleaned = title
    .replace(/\s+/g, " ")
    .replace(/[\\/:*?"<>|\p{C}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const truncated = [...cleaned]
    .slice(0, 80)
    .join("")
    .replace(/[.\s]+$/u, "")
    .replace(/^\.+/u, "");
  const base = truncated.length === 0 ? "thumbnail" : truncated;
  return `${base}.png`;
}

export async function generateThumbnailImage(
  prisma: PrismaClient,
  directories: DataDirectories,
  rasterizer: Rasterizer,
  thumbnailId: string,
): Promise<ThumbnailImage> {
  const row = await prisma.thumbnail.findUnique({
    where: { id: thumbnailId },
    include: { languageEdition: { include: { work: true } } },
  });
  if (row === null) {
    throw resourceNotFound("thumbnail", thumbnailId);
  }
  const document = parseThumbnailDocument(row.inputJson);
  await validateDocument(prisma, document);
  const { theme } = await requireEditionWithTheme(prisma, row.languageEditionId);

  const assetIds = [
    ...new Set(collectThumbnailAssetRefs(document).map((reference) => reference.assetId)),
  ];
  const dataUrls = new Map<string, string>(
    await Promise.all(
      assetIds.map(async (assetId): Promise<[string, string]> => {
        const location = await resolveAssetContent(prisma, directories, assetId, true);
        if (!location.mediaType.startsWith("image/")) {
          throw new ApiError(422, "THUMBNAIL_INPUT_INVALID", "サムネイルの写真は画像を指定してください。", {
            assetIds: [assetId],
          });
        }
        if (location.byteSize > MAX_THUMBNAIL_ASSET_BYTES) {
          throw new ApiError(422, "THUMBNAIL_INPUT_INVALID", "サムネイルの写真が大きすぎます。", {
            assetIds: [assetId],
          });
        }
        const bytes = await readFile(location.path);
        return [assetId, `data:${location.mediaType};base64,${bytes.toString("base64")}`];
      }),
    ),
  );

  const compiled = compile(document, theme, (assetId) => {
    const url = dataUrls.get(assetId);
    if (url === undefined) {
      throw new CompositionCompileError([
        { path: ["input", "assetId"], code: "unresolvable_asset", message: "素材を解決できません。" },
      ]);
    }
    return { url, kind: "image" };
  });
  const png = await rasterizer.renderPng(compiled.html, compiled.width, compiled.height);
  return { filename: pngFilename(row.languageEdition.work.title), png };
}

export type { ThumbnailRow };
