import { readFile } from "node:fs/promises";
import {
  THUMBNAIL_SCHEMA_VERSION,
  applyThumbnailAppearance,
  collectThumbnailAssetRefs,
  getThumbnailTemplate,
  normalizeThumbnailAppearance,
  resolveThumbnailAppearanceDefaults,
  thumbnailAppearanceSchema,
  thumbnailDocumentSchema,
  type CreateThumbnailRequest,
  type SaveThumbnailRequest,
  type Thumbnail as ThumbnailDto,
  type ThumbnailAppearance,
  type ThumbnailAppearanceView,
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

function buildDocument(input: {
  template: ThumbnailDocument["template"];
  input: unknown;
  appearanceOverride?: ThumbnailAppearance | null;
}): ThumbnailDocument {
  const appearanceOverride = normalizeThumbnailAppearance(input.appearanceOverride);
  if (appearanceOverride === null) {
    return {
      schemaVersion: THUMBNAIL_SCHEMA_VERSION,
      template: input.template,
      input: input.input,
    };
  }
  return {
    schemaVersion: THUMBNAIL_SCHEMA_VERSION,
    template: input.template,
    input: input.input,
    appearanceOverride,
  };
}

export function serializeThumbnailDocument(document: ThumbnailDocument): string {
  // New writes are always v2. The v1 branch is defensive for callers that
  // serialize a parsed legacy document without rewriting it.
  if (document.schemaVersion === 1) {
    return JSON.stringify({
      schemaVersion: 1,
      template: document.template,
      input: document.input,
    });
  }
  const appearanceOverride = normalizeThumbnailAppearance(document.appearanceOverride);
  return JSON.stringify({
    schemaVersion: THUMBNAIL_SCHEMA_VERSION,
    template: document.template,
    input: document.input,
    ...(appearanceOverride === null ? {} : { appearanceOverride }),
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

/**
 * The stored appearance is a supplementary, unversioned patch. A stale or
 * corrupt row must not make thumbnails unrenderable, so reads degrade to the
 * Theme defaults. Writes still go through the strict request schema.
 */
export function parseThumbnailAppearanceJson(
  appearanceJson: string | null,
): ThumbnailAppearance | null {
  if (appearanceJson === null) {
    return null;
  }
  try {
    const parsed = thumbnailAppearanceSchema.safeParse(JSON.parse(appearanceJson));
    return parsed.success ? normalizeThumbnailAppearance(parsed.data) : null;
  } catch {
    return null;
  }
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

function appearanceView(
  theme: Parameters<typeof resolveThumbnailAppearanceDefaults>[0],
  locale: string,
  appearance: ThumbnailAppearance | null,
): ThumbnailAppearanceView {
  const defaults = resolveThumbnailAppearanceDefaults(theme, locale);
  return {
    appearance,
    defaults,
    resolved: applyThumbnailAppearance(defaults, appearance),
  };
}

function compile(
  document: ThumbnailDocument,
  theme: Parameters<typeof compileThumbnail>[0]["theme"],
  locale: string,
  assetResolver: AssetResolver,
  appearance: ThumbnailAppearance | null,
): CompiledThumbnail {
  try {
    return compileThumbnail({ document, theme, locale, assetResolver, appearance });
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
  const document = buildDocument(input);
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
  const document = buildDocument(input);
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

export async function updateThumbnailPartial(
  prisma: PrismaClient,
  thumbnailId: string,
  input: {
    label?: string;
    template?: ThumbnailDocument["template"];
    input?: unknown;
    appearanceOverride?: ThumbnailAppearance | null;
  },
): Promise<ThumbnailDto> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.thumbnail.findUnique({
      where: { id: thumbnailId },
      include: { languageEdition: { select: { primaryThumbnailId: true } } },
    });
    if (existing === null) {
      throw resourceNotFound("thumbnail", thumbnailId);
    }
    const currentDocument = parseThumbnailDocument(existing.inputJson);
    const label = input.label ?? existing.label;
    const template = input.template ?? currentDocument.template;
    const docInput = input.input ?? currentDocument.input;
    let appearanceOverride: ThumbnailAppearance | null;
    if (input.appearanceOverride === undefined) {
      appearanceOverride = (currentDocument as { appearanceOverride?: ThumbnailAppearance | null }).appearanceOverride ?? null;
    } else {
      appearanceOverride = normalizeThumbnailAppearance(input.appearanceOverride);
    }
    const document = buildDocument({ template, input: docInput, appearanceOverride });
    await validateDocument(tx as unknown as PrismaClient, document);
    const row = await tx.thumbnail.update({
      where: { id: thumbnailId },
      data: {
        label,
        schemaVersion: document.schemaVersion,
        templateId: document.template.id,
        templateVersion: document.template.version,
        inputJson: serializeThumbnailDocument(document),
      },
    });
    return toThumbnail(row, row.id === existing.languageEdition.primaryThumbnailId);
  });
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

export async function getThumbnailAppearance(
  prisma: PrismaClient,
  editionId: string,
): Promise<ThumbnailAppearanceView> {
  const { edition, theme } = await requireEditionWithTheme(prisma, editionId);
  return appearanceView(theme, edition.locale, parseThumbnailAppearanceJson(edition.thumbnailAppearanceJson));
}

export async function saveThumbnailAppearance(
  prisma: PrismaClient,
  editionId: string,
  appearance: ThumbnailAppearance | null,
): Promise<ThumbnailAppearanceView> {
  const { edition, theme } = await requireEditionWithTheme(prisma, editionId);
  const normalized = normalizeThumbnailAppearance(appearance);
  await prisma.languageEdition.update({
    where: { id: editionId },
    data: {
      thumbnailAppearanceJson: normalized === null ? null : JSON.stringify(normalized),
    },
  });
  return appearanceView(theme, edition.locale, normalized);
}

export async function createThumbnailPreview(
  prisma: PrismaClient,
  editionId: string,
  input: ThumbnailPreviewRequest,
): Promise<ThumbnailPreview> {
  const document = buildDocument(input);
  await validateDocument(prisma, document);
  const { edition, theme } = await requireEditionWithTheme(prisma, editionId);
  const commonAppearance =
    input.appearance === undefined
      ? parseThumbnailAppearanceJson(edition.thumbnailAppearanceJson)
      : normalizeThumbnailAppearance(input.appearance);
  const compiled = compile(document, theme, edition.locale, (assetId) => ({
    url: renderContentUrl(assetId),
    kind: "image",
  }), commonAppearance);
  return { html: compiled.html, width: compiled.width, height: compiled.height };
}

export interface ThumbnailImage {
  filename: string;
  width: number;
  height: number;
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

/**
 * Rasterizes a compiled thumbnail. The source assets are inlined as data URLs
 * because the headless screenshot browser never receives the app's media
 * session; this is the same path the HTTP PNG route uses.
 */
async function renderDocumentPng(
  prisma: PrismaClient,
  directories: DataDirectories,
  rasterizer: Rasterizer,
  document: ThumbnailDocument,
  theme: Parameters<typeof compileThumbnail>[0]["theme"],
  locale: string,
  commonAppearance: ThumbnailAppearance | null,
): Promise<{ width: number; height: number; png: Buffer }> {
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

  const compiled = compile(document, theme, locale, (assetId) => {
    const url = dataUrls.get(assetId);
    if (url === undefined) {
      // The `compile` wrapper turns this into THUMBNAIL_INPUT_INVALID with the
      // structured issue path, the same as every other invalid-input case.
      throw new CompositionCompileError([
        { path: ["input", "assetId"], code: "unresolvable_asset", message: "素材を解決できません。" },
      ]);
    }
    return { url, kind: "image" };
  }, commonAppearance);
  const png = await rasterizer.renderPng(compiled.html, compiled.width, compiled.height);
  return { width: compiled.width, height: compiled.height, png };
}

/** PNG of an unsaved draft; nothing is written to the database. */
export async function renderThumbnailPreviewImage(
  prisma: PrismaClient,
  directories: DataDirectories,
  rasterizer: Rasterizer,
  editionId: string,
  input: ThumbnailPreviewRequest,
): Promise<{ width: number; height: number; png: Buffer }> {
  const document = buildDocument(input);
  await validateDocument(prisma, document);
  const { edition, theme } = await requireEditionWithTheme(prisma, editionId);
  const commonAppearance =
    input.appearance === undefined
      ? parseThumbnailAppearanceJson(edition.thumbnailAppearanceJson)
      : normalizeThumbnailAppearance(input.appearance);
  return renderDocumentPng(
    prisma,
    directories,
    rasterizer,
    document,
    theme,
    edition.locale,
    commonAppearance,
  );
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
  const { edition, theme } = await requireEditionWithTheme(prisma, row.languageEditionId);
  const commonAppearance = parseThumbnailAppearanceJson(
    row.languageEdition.thumbnailAppearanceJson,
  );
  const rendered = await renderDocumentPng(
    prisma,
    directories,
    rasterizer,
    document,
    theme,
    edition.locale,
    commonAppearance,
  );
  return {
    filename: pngFilename(row.languageEdition.work.title),
    width: rendered.width,
    height: rendered.height,
    png: rendered.png,
  };
}

export type { ThumbnailRow };
