import {
  COMPOSITION_ENGINE,
  COMPILER_VERSION,
  HYPERFRAMES_PLAYER_VERSION,
  buildSrt,
  compileDocument,
  CompositionCompileError,
  collectTimelineIssues,
  resolveCueWindow,
  resolveTimeline,
  OUTPUT_FPS,
  type CompiledComposition,
  type CompositionVersionResolved,
  type ResolvedAssetKind,
  type ScenePlacement,
} from "@kakeai/video";
import {
  RENDITION_PURPOSE,
  characterStandingV1InputSchema,
  characterStandingV2InputSchema,
  characterStandingV3InputSchema,
  collectAssetReferences,
  computeContentWarnings,
  draftPreviewSchema,
  scriptVersionPreviewSchema,
  type AssetKindName,
  type AssetReference,
  type ContentDocument,
  type DraftPreview,
  type DraftPreviewRequest,
  type PreviewCueTiming,
  type SaveScriptVersionRequest,
  type ScriptVersion as ScriptVersionDto,
  type ScriptVersionPreview,
  type ScriptVersionSummary,
  type VisualCue,
  type Warning,
} from "@kakeai/contracts";
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { deserializeContent, serializeContent } from "../domain/content-json.ts";
import { toFaceSet, toScriptVersion, toScriptVersionSummary } from "../dto/mappers.ts";
import { ApiError } from "../http/errors.ts";
import { API_BASE_PATH } from "../http/security.ts";
import { resourceNotFound, validationError, type ValidationIssue } from "../http/validation.ts";
import type { DataDirectories } from "../storage/paths.ts";
import { resolveAssetContent } from "./assets.ts";
import { collectCompositionVersionIds, CompositionService } from "./compositions.ts";
import { ThemeResolver } from "./theme-resolver.ts";

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

export type FaceSetDetails = Prisma.FaceSetGetPayload<{
  include: { layers: true; expressions: true };
}>;

export interface LoadedReferences extends LoadedAssetReferences {
  faceSetById: Map<string, FaceSetDetails>;
}

export function collectFaceSetIds(content: ContentDocument): string[] {
  return [
    ...new Set(
      content.characters.flatMap((character) =>
        character.appearances.map((appearance) => appearance.faceSetId),
      ),
    ),
  ].filter((id): id is string => id !== null);
}

export async function loadFaceSets(
  client: PrismaClient | Prisma.TransactionClient,
  content: ContentDocument,
): Promise<Map<string, FaceSetDetails>> {
  const ids = collectFaceSetIds(content);
  const rows =
    ids.length === 0
      ? []
      : await client.faceSet.findMany({
          where: { id: { in: ids } },
          include: {
            layers: { orderBy: { position: "asc" } },
            expressions: { orderBy: { position: "asc" } },
          },
        });
  return new Map(rows.map((row) => [row.id, row]));
}

export async function loadLayerAssets(
  client: PrismaClient | Prisma.TransactionClient,
  faceSetById: Map<string, FaceSetDetails>,
): Promise<Map<string, AssetWithRenditions>> {
  const ids = [
    ...new Set(
      [...faceSetById.values()].flatMap((faceSet) => faceSet.layers.map((layer) => layer.assetId)),
    ),
  ];
  if (ids.length === 0) {
    return new Map();
  }
  const assets = await client.asset.findMany({
    where: { id: { in: ids } },
    include: { renditions: true },
  });
  return new Map(assets.map((asset) => [asset.id, asset]));
}

export function collectFaceLayerReferences(
  content: ContentDocument,
  faceSetById: Map<string, FaceSetDetails>,
): AssetReference[] {
  const references: AssetReference[] = [];
  const seen = new Set<string>();
  content.characters.forEach((character, characterIndex) => {
    character.appearances.forEach((appearance, appearanceIndex) => {
      if (appearance.faceSetId === null) {
        return;
      }
      const faceSet = faceSetById.get(appearance.faceSetId);
      if (faceSet === undefined) {
        return;
      }
      for (const layer of faceSet.layers) {
        if (seen.has(layer.assetId)) {
          continue;
        }
        seen.add(layer.assetId);
        references.push({
          assetId: layer.assetId,
          allowedKinds: ["image"],
          path: ["characters", characterIndex, "appearances", appearanceIndex, "faceSetId"],
        });
      }
    });
  });
  return references;
}

export async function loadAllReferences(
  client: PrismaClient | Prisma.TransactionClient,
  content: ContentDocument,
): Promise<LoadedReferences> {
  const { references, assetById } = await loadAssetReferences(client, content);
  const faceSetById = await loadFaceSets(client, content);
  const layerAssets = await loadLayerAssets(client, faceSetById);
  for (const [id, asset] of layerAssets) {
    if (!assetById.has(id)) {
      assetById.set(id, asset);
    }
  }
  return {
    references: [...references, ...collectFaceLayerReferences(content, faceSetById)],
    assetById,
    faceSetById,
  };
}

function standingCueTarget(cue: VisualCue): { characterId: string; appearanceId: string } | undefined {
  if (cue.template.id !== "character.standing") {
    return undefined;
  }
  for (const schema of [
    characterStandingV3InputSchema,
    characterStandingV2InputSchema,
    characterStandingV1InputSchema,
  ]) {
    const parsed = schema.safeParse(cue.input);
    if (parsed.success) {
      return { characterId: parsed.data.characterId, appearanceId: parsed.data.appearanceId };
    }
  }
  return undefined;
}

function readyDimensions(
  asset: AssetWithRenditions | undefined,
): { widthPx: number; heightPx: number } | undefined {
  if (
    asset === undefined ||
    asset.status !== "ready" ||
    asset.widthPx === null ||
    asset.heightPx === null
  ) {
    return undefined;
  }
  return { widthPx: asset.widthPx, heightPx: asset.heightPx };
}

export function assertFaceSetReferences(
  content: ContentDocument,
  faceSetById: Map<string, FaceSetDetails>,
  assetById: Map<string, AssetWithRenditions>,
): void {
  const issues: ValidationIssue[] = [];
  const characterById = new Map(content.characters.map((character) => [character.id, character]));
  content.characters.forEach((character, characterIndex) => {
    character.appearances.forEach((appearance, appearanceIndex) => {
      if (appearance.faceSetId === null) {
        return;
      }
      const faceSet = faceSetById.get(appearance.faceSetId);
      if (faceSet === undefined) {
        issues.push({
          path: ["characters", characterIndex, "appearances", appearanceIndex, "faceSetId"],
          code: "invalid_value",
          message: "表情セットが見つかりません。",
        });
        return;
      }
      const base = readyDimensions(assetById.get(appearance.assetId));
      const layerDims = faceSet.layers.map((layer) =>
        readyDimensions(assetById.get(layer.assetId)),
      );
      if (
        faceSet.layers.length > 0 &&
        (base === undefined || layerDims.some((dims) => dims === undefined))
      ) {
        issues.push({
          path: ["characters", characterIndex, "appearances", appearanceIndex, "faceSetId"],
          code: "invalid_value",
          message: "顔レイヤーの寸法を確認できません。",
        });
        return;
      }
      const mismatch =
        base !== undefined &&
        layerDims.some(
          (dims) =>
            dims !== undefined &&
            (dims.widthPx !== base.widthPx || dims.heightPx !== base.heightPx),
        );
      if (mismatch) {
        issues.push({
          path: ["characters", characterIndex, "appearances", appearanceIndex, "faceSetId"],
          code: "invalid_value",
          message: "顔レイヤーはベース画像と同じ寸法にしてください。",
        });
      }
    });
  });

  const characterIdBySpeakerId = new Map(
    content.speakers.map((speaker) => [speaker.id, speaker.characterId]),
  );
  content.scenes.forEach((scene, sceneIndex) => {
    scene.lines.forEach((line, lineIndex) => {
      if (line.expressionId === null || line.speakerId === null) {
        return;
      }
      const path: (string | number)[] = ["scenes", sceneIndex, "lines", lineIndex, "expressionId"];
      const characterId = characterIdBySpeakerId.get(line.speakerId);
      const character =
        characterId === null || characterId === undefined
          ? undefined
          : characterById.get(characterId);
      if (character === undefined) {
        issues.push({
          path,
          code: "invalid_value",
          message: "表情を指定する台詞にはキャラクターを持つ話者が必要です。",
        });
        return;
      }
      const appearanceIds = scene.visualCues
        .map(standingCueTarget)
        .filter(
          (target): target is { characterId: string; appearanceId: string } =>
            target !== undefined && target.characterId === character.id,
        )
        .map((target) => target.appearanceId);
      if (appearanceIds.length === 0) {
        return;
      }
      for (const appearanceId of appearanceIds) {
        const appearance = character.appearances.find((entry) => entry.id === appearanceId);
        const faceSet =
          appearance?.faceSetId === null || appearance?.faceSetId === undefined
            ? undefined
            : faceSetById.get(appearance.faceSetId);
        if (
          faceSet === undefined ||
          !faceSet.expressions.some((preset) => preset.id === line.expressionId)
        ) {
          issues.push({
            path,
            code: "invalid_value",
            message: "この表情は話者の立ち絵で利用できません。",
          });
          return;
        }
      }
    });
  });
  if (issues.length > 0) {
    throw validationError(issues);
  }
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
  const hasExpressions = content.scenes.some((scene) =>
    scene.lines.some((line) => line.expressionId !== null),
  );
  if (
    content.audioTakes.length === 0 &&
    collectAssetReferences(content).length === 0 &&
    collectFaceSetIds(content).length === 0 &&
    !hasExpressions
  ) {
    return;
  }
  const { references, assetById, faceSetById } = await loadAllReferences(client, content);
  assertAssetsAvailable(references, assetById);
  assertTakeDurations(content, assetById);
  assertFaceSetReferences(content, faceSetById, assetById);
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

export interface ScriptVersionSubtitles {
  filename: string;
  srt: string;
}

function subtitleFilename(title: string): string {
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
  const base = truncated.length === 0 ? "subtitles" : truncated;
  return `${base}.srt`;
}

export async function getScriptVersionSubtitles(
  prisma: PrismaClient,
  scriptVersionId: string,
): Promise<ScriptVersionSubtitles> {
  const row = await prisma.scriptVersion.findUnique({
    where: { id: scriptVersionId },
    include: { languageEdition: { include: { work: true } } },
  });
  if (row === null) {
    throw resourceNotFound("script_version", scriptVersionId);
  }
  let content: ContentDocument;
  try {
    content = deserializeContent(row.contentJson);
  } catch {
    throw new ApiError(500, "INTERNAL_ERROR", "保存済みの台本を解釈できません。");
  }
  let srt: string;
  try {
    srt = buildSrt(content);
  } catch (error) {
    if (error instanceof CompositionCompileError) {
      throw new ApiError(422, "RENDER_INPUT_INVALID", undefined, { issues: error.issues });
    }
    throw error;
  }
  return { filename: subtitleFilename(row.languageEdition.work.title), srt };
}

export function renderSourceDurationMs(asset: AssetWithRenditions): number | null {
  const rendition = asset.renditions.find((entry) => entry.purpose === RENDITION_PURPOSE);
  return rendition?.durationMs ?? asset.durationMs;
}

function previewCueTimings(content: ContentDocument, placement: ScenePlacement): PreviewCueTiming[] {
  const scene = content.scenes[placement.sceneIndex];
  if (scene === undefined) {
    return [];
  }
  const timings: PreviewCueTiming[] = [];
  scene.visualCues.forEach((cue, cueIndex) => {
    const cuePath: (string | number)[] = ["scenes", placement.sceneIndex, "visualCues", cueIndex];
    const window = resolveCueWindow(placement, cue, cuePath);
    if (window !== null) {
      timings.push({ cueId: cue.id, startMs: placement.startMs + window.startMs });
    }
  });
  return timings;
}

function buildPreviewTimeline(content: ContentDocument) {
  const timeline = resolveTimeline(content);
  return {
    totalDurationMs: timeline.totalDurationMs,
    fps: OUTPUT_FPS,
    scenes: timeline.scenes.map((placement) => ({
      sceneId: placement.sceneId,
      startMs: placement.startMs,
      durationMs: placement.durationMs,
      lines: placement.lines.map((line) => ({
        lineId: line.lineId,
        startMs: line.startMs,
        durationMs: line.durationMs,
      })),
      cues: previewCueTimings(content, placement),
    })),
  };
}

export type CompiledPreview = Omit<ScriptVersionPreview, "scriptVersionId">;

export interface CompilePreviewOptions {
  strictTakeDurations?: boolean;
}

export interface PreviewCompositionResolution {
  compositionVersionId: string;
  entryUrl: string;
  resolved: CompositionVersionResolved;
}

function compositionEntryUrl(versionId: string, entrypoint: string): string {
  const encodedPath = entrypoint
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${API_BASE_PATH}/compositions/versions/${encodeURIComponent(versionId)}/content/${encodedPath}`;
}

export async function resolvePreviewCompositions(
  prisma: PrismaClient,
  directories: DataDirectories,
  content: ContentDocument,
): Promise<PreviewCompositionResolution[]> {
  const compositionService = new CompositionService({ db: prisma, dataDir: directories.root });
  const resolutions: PreviewCompositionResolution[] = [];
  for (const versionId of collectCompositionVersionIds(content)) {
    let bundle;
    try {
      bundle = await compositionService.resolvePublishedBundle(versionId);
    } catch {
      throw new ApiError(422, "COMPOSITION_UNAVAILABLE", "参照先のCompositionVersionを利用できません。");
    }
    const entryUrl = compositionEntryUrl(bundle.version.id, bundle.version.manifest.entrypoint);
    resolutions.push({
      compositionVersionId: bundle.version.id,
      entryUrl,
      resolved: {
        id: bundle.version.id,
        runtimeCompositionId: bundle.version.manifest.runtimeCompositionId,
        entrypoint: entryUrl,
        previewUrl: entryUrl,
        bundleHash: bundle.version.bundleHash,
        storageKey: bundle.version.storageKey,
        manifest: bundle.version.manifest,
      },
    });
  }
  return resolutions;
}

export async function compilePreview(
  prisma: PrismaClient,
  directories: DataDirectories,
  content: ContentDocument,
  options: CompilePreviewOptions = {},
): Promise<CompiledPreview> {
  const { references, assetById, faceSetById } = await loadAllReferences(prisma, content);
  assertAssetsAvailable(references, assetById);
  assertFaceSetReferences(content, faceSetById, assetById);
  if (options.strictTakeDurations === true) {
    assertTakeDurations(content, assetById);
  }

  const themeResolver = new ThemeResolver(prisma);
  const resolvedTheme = await themeResolver.resolve(content.visualTheme.id, content.visualTheme.version);
  if (!resolvedTheme) {
    throw new ApiError(422, "PREVIEW_INPUT_INVALID", `Visual Themeが見つかりません: ${content.visualTheme.id}@${content.visualTheme.version}`);
  }

  const renderContentUrl = (assetId: string): string =>
    `${API_BASE_PATH}/assets/${encodeURIComponent(assetId)}/render-content`;

  const previewCompositions = await resolvePreviewCompositions(prisma, directories, content);
  const compositionByVersionId = new Map(
    previewCompositions.map((entry) => [entry.compositionVersionId, entry.resolved]),
  );

  let compiled: CompiledComposition;
  let timeline: ReturnType<typeof buildPreviewTimeline>;
  try {
    compiled = compileDocument({
      document: content,
      resolvedTheme,
      compositionResolver: (versionId) => {
        const found = compositionByVersionId.get(versionId);
        if (!found) {
          throw new Error(`CompositionVersionを解決できません: ${versionId}`);
        }
        return found;
      },
      faceSetResolver: (faceSetId) => {
        const row = faceSetById.get(faceSetId);
        if (row === undefined) {
          throw new CompositionCompileError([
            {
              path: ["faceSets", faceSetId],
              code: "unresolvable_face_set",
              message: "表情セットを解決できません。",
            },
          ]);
        }
        const dto = toFaceSet(row);
        return { id: dto.id, name: dto.name, layers: dto.layers, expressions: dto.expressions };
      },
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
    timeline = buildPreviewTimeline(content);
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

  return {
    compositionHtml: compiled.html,
    assets: previewAssets,
    compositions: compiled.compositionVersions.map((resolved) => ({
      compositionVersionId: resolved.id,
      entryUrl: resolved.previewUrl ?? compositionEntryUrl(resolved.id, resolved.manifest.entrypoint),
    })),
    renderer: {
      engine: COMPOSITION_ENGINE,
      compilerVersion: COMPILER_VERSION,
      playerVersion: HYPERFRAMES_PLAYER_VERSION,
    },
    timeline,
  };
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

  const preview = {
    scriptVersionId: row.id,
    ...(await compilePreview(prisma, directories, content)),
  };
  const parsed = scriptVersionPreviewSchema.safeParse(preview);
  if (!parsed.success) {
    throw new ApiError(500, "INTERNAL_ERROR", "プレビュー応答を生成できません。");
  }
  return parsed.data;
}

export async function createDraftPreview(
  prisma: PrismaClient,
  directories: DataDirectories,
  editionId: string,
  input: DraftPreviewRequest,
): Promise<DraftPreview> {
  const edition = await requireEdition(prisma, editionId);
  const { content } = input;
  if (content.locale !== edition.locale) {
    throw validationError([
      {
        path: ["content", "locale"],
        code: "invalid_value",
        message: `言語版のロケール(${edition.locale})と一致しません。`,
      },
    ]);
  }
  const draft = {
    source: { kind: "draft" as const },
    ...(await compilePreview(prisma, directories, content, { strictTakeDurations: true })),
  };
  const parsed = draftPreviewSchema.safeParse(draft);
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

  let transitionIssues: ReturnType<typeof collectTimelineIssues> = [];
  try {
    transitionIssues = collectTimelineIssues(content);
  } catch (error) {
    if (!(error instanceof CompositionCompileError)) {
      throw error;
    }
    const fatal = error.issues.filter((issue) => issue.code !== "fixed_duration_overflow");
    if (fatal.length > 0) {
      throw validationError(
        fatal.map((issue) => ({
          path: issue.path,
          code: issue.code,
          message: issue.message,
        })),
      );
    }
  }
  if (transitionIssues.length > 0) {
    throw validationError(
      transitionIssues.map((issue) => ({
        path: issue.path,
        code: issue.code,
        message: issue.message,
      })),
    );
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
        const themeResolver = new ThemeResolver(tx);
        const resolvedTheme = await themeResolver.resolve(
          content.visualTheme.id,
          content.visualTheme.version,
        );
        if (!resolvedTheme) {
          throw validationError([
            {
              path: ["visualTheme"],
              code: "invalid_value",
              message: `Visual Themeが見つかりません: ${content.visualTheme.id}@${content.visualTheme.version}`,
            },
          ]);
        }
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
