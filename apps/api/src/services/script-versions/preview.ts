import {
  assertTakeDurations,
  assertAssetsAvailable,
  assertFaceSetReferences,
  loadAllReferences,
  renderSourceDurationMs,
} from "./references";
import { assertInsertScenes, assertVideoPlayback } from "./validation";
import { requireEdition } from "./common";
import {
  COMPOSITION_ENGINE,
  COMPILER_VERSION,
  HYPERFRAMES_PLAYER_VERSION,
  compileDocument,
  CompositionCompileError,
  collectStillFrameRequests,
  deriveVideoPlaybackPlans,
  resolveCueWindow,
  resolveTimeline,
  OUTPUT_FPS,
  type CompiledComposition,
  type CompositionVersionResolved,
  type ResolvedAssetKind,
  type ScenePlacement,
} from "@kakeai/video";
import {
  draftPreviewSchema,
  scriptVersionPreviewSchema,
  type ContentDocument,
  type DraftPreview,
  type DraftPreviewRequest,
  type PreviewCueTiming,
  type PreviewTimeline,
  type ScriptVersionPreview,
} from "@kakeai/contracts";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { deserializeContent } from "../../domain/content-json.ts";
import { toFaceSet } from "../../dto/mappers.ts";
import { ApiError } from "../../http/errors.ts";
import { API_BASE_PATH } from "../../http/security.ts";
import { resourceNotFound, validationError } from "../../http/validation.ts";
import type { DataDirectories } from "../../storage/paths.ts";
import { resolveAssetContent } from "../assets.ts";
import {
  ensureStillFramePng,
  stillFrameCacheDir,
} from "../../media/still-frame.ts";
import {
  collectCompositionVersionIds,
  CompositionService,
} from "../compositions.ts";
import { ThemeResolver } from "../theme-resolver.ts";

export function buildPreviewTimeline(
  content: ContentDocument,
): PreviewTimeline {
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

function previewCueTimings(
  content: ContentDocument,
  placement: ScenePlacement,
): PreviewCueTiming[] {
  const scene = content.scenes[placement.sceneIndex];
  if (scene === undefined) {
    return [];
  }
  const timings: PreviewCueTiming[] = [];
  scene.visualCues.forEach((cue, cueIndex) => {
    const cuePath: (string | number)[] = [
      "scenes",
      placement.sceneIndex,
      "visualCues",
      cueIndex,
    ];
    const window = resolveCueWindow(placement, cue, cuePath);
    if (window !== null) {
      timings.push({
        cueId: cue.id,
        startMs: placement.startMs + window.startMs,
      });
    }
  });
  return timings;
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
  const compositionService = new CompositionService({
    db: prisma,
    dataDir: directories.root,
  });
  const resolutions: PreviewCompositionResolution[] = [];
  for (const versionId of collectCompositionVersionIds(content)) {
    let bundle;
    try {
      bundle = await compositionService.resolvePublishedBundle(versionId);
    } catch {
      throw new ApiError(
        422,
        "COMPOSITION_UNAVAILABLE",
        "参照先のCompositionVersionを利用できません。",
      );
    }
    const entryUrl = compositionEntryUrl(
      bundle.version.id,
      bundle.version.manifest.entrypoint,
    );
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
  const { references, assetById, faceSetById } = await loadAllReferences(
    prisma,
    content,
  );
  assertAssetsAvailable(references, assetById);
  assertInsertScenes(content, assetById);
  assertVideoPlayback(content, assetById);
  assertFaceSetReferences(content, faceSetById, assetById);
  if (options.strictTakeDurations === true) {
    assertTakeDurations(content, assetById);
  }

  const themeResolver = new ThemeResolver(prisma);
  const resolvedTheme = await themeResolver.resolve(
    content.visualTheme.id,
    content.visualTheme.version,
  );
  if (!resolvedTheme) {
    throw new ApiError(
      422,
      "PREVIEW_INPUT_INVALID",
      `Visual Themeが見つかりません: ${content.visualTheme.id}@${content.visualTheme.version}`,
    );
  }

  const renderContentUrl = (assetId: string): string =>
    `${API_BASE_PATH}/assets/${encodeURIComponent(assetId)}/render-content`;

  const previewCompositions = await resolvePreviewCompositions(
    prisma,
    directories,
    content,
  );
  const compositionByVersionId = new Map(
    previewCompositions.map((entry) => [
      entry.compositionVersionId,
      entry.resolved,
    ]),
  );

  let compiled: CompiledComposition;
  let timeline: ReturnType<typeof buildPreviewTimeline>;
  try {
    const resolveAssetDurationMs = (assetId: string): number | null => {
      const asset = assetById.get(assetId);
      return asset === undefined ? null : renderSourceDurationMs(asset);
    };
    const playbackPlans = deriveVideoPlaybackPlans(content, {
      resolveAssetDurationMs,
    });
    const stillCacheDir = stillFrameCacheDir(directories.tmp);
    for (const request of collectStillFrameRequests(playbackPlans.plans)) {
      if (!assetById.has(request.assetId)) {
        continue;
      }
      const location = await resolveAssetContent(
        prisma,
        directories,
        request.assetId,
        true,
      );
      await ensureStillFramePng(
        { filePath: location.path, sha256: location.sha256 },
        request.sourceMs,
        stillCacheDir,
      );
    }
    compiled = compileDocument({
      document: content,
      resolvedTheme,
      videoPlaybackPlans: playbackPlans.byPath,
      stillResolver: (assetId, sourceMs) =>
        `${API_BASE_PATH}/assets/${encodeURIComponent(assetId)}/frame?ms=${sourceMs}`,
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
        return {
          id: dto.id,
          name: dto.name,
          layers: dto.layers,
          expressions: dto.expressions,
        };
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
          durationMs: kind === "image" ? null : renderSourceDurationMs(asset),
        };
      },
    });
    timeline = buildPreviewTimeline(content);
  } catch (error) {
    if (error instanceof CompositionCompileError) {
      throw new ApiError(422, "PREVIEW_INPUT_INVALID", undefined, {
        issues: error.issues,
      });
    }
    throw error;
  }

  const previewAssets = await Promise.all(
    compiled.assetIds.map(async (assetId) => {
      const location = await resolveAssetContent(
        prisma,
        directories,
        assetId,
        true,
      );
      return {
        assetId,
        contentUrl: renderContentUrl(assetId),
        sha256: location.sha256,
      };
    }),
  );

  return {
    compositionHtml: compiled.html,
    assets: previewAssets,
    compositions: compiled.compositionVersions.map((resolved) => ({
      compositionVersionId: resolved.id,
      entryUrl:
        resolved.previewUrl ??
        compositionEntryUrl(resolved.id, resolved.manifest.entrypoint),
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
  const row = await prisma.scriptVersion.findUnique({
    where: { id: scriptVersionId },
  });
  if (row === null) {
    throw resourceNotFound("script_version", scriptVersionId);
  }
  let content: ContentDocument;
  try {
    content = deserializeContent(row.contentJson);
  } catch {
    throw new ApiError(
      500,
      "INTERNAL_ERROR",
      "保存済みの台本を解釈できません。",
    );
  }

  const preview = {
    scriptVersionId: row.id,
    ...(await compilePreview(prisma, directories, content)),
  };
  const parsed = scriptVersionPreviewSchema.safeParse(preview);
  if (!parsed.success) {
    throw new ApiError(
      500,
      "INTERNAL_ERROR",
      "プレビュー応答を生成できません。",
    );
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
    ...(await compilePreview(prisma, directories, content, {
      strictTakeDurations: true,
    })),
  };
  const parsed = draftPreviewSchema.safeParse(draft);
  if (!parsed.success) {
    throw new ApiError(
      500,
      "INTERNAL_ERROR",
      "プレビュー応答を生成できません。",
    );
  }
  return parsed.data;
}
