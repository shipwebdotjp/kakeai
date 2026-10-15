import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import {
  COMPILER_VERSION,
  COMPOSITION_ENGINE,
  compileDocument,
  CompositionCompileError,
  type ResolvedAssetKind,
} from "@kakeai/video";
import {
  RENDITION_PURPOSE,
  SNAPSHOT_SCHEMA_VERSION,
  renderJobSnapshotSchema,
  type ContentDocument,
  type Job as JobDto,
  type RenderJobSnapshot,
} from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { deserializeContent } from "../domain/content-json.ts";
import { bigIntToSafeNumber, toFaceSet, toJob } from "../dto/mappers.ts";
import { ApiError } from "../http/errors.ts";
import { resourceNotFound } from "../http/validation.ts";
import {
  assertAssetsAvailable,
  assertFaceSetReferences,
  assertTakeDurations,
  loadAllReferences,
  renderSourceDurationMs,
} from "./script-versions.ts";
import { collectCompositionVersionIds, CompositionService } from "./compositions.ts";
import { ThemeResolver } from "./theme-resolver.ts";
import { FontCatalogService, getSharedFontCatalogService } from "./font-catalog.ts";

const require = createRequire(import.meta.url);

let cachedProducerVersion: string | undefined;
let producerVersionResolved = false;

export function getProducerVersion(): string | undefined {
  if (!producerVersionResolved) {
    producerVersionResolved = true;
    try {
      const packageJson = JSON.parse(
        readFileSync(require.resolve("@hyperframes/producer/package.json"), "utf8"),
      ) as { version?: unknown };
      if (typeof packageJson.version === "string") {
        cachedProducerVersion = packageJson.version;
      }
    } catch {
      cachedProducerVersion = undefined;
    }
  }
  return cachedProducerVersion;
}

export async function createRenderJob(
  prisma: PrismaClient,
  scriptVersionId: string,
  fontCatalogService: FontCatalogService = getSharedFontCatalogService(),
): Promise<JobDto> {
  const row = await prisma.scriptVersion.findUnique({
    where: { id: scriptVersionId },
    include: { languageEdition: { select: { id: true, workId: true } } },
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

  const themeResolver = new ThemeResolver(prisma);
  const resolvedThemeDefinition = await themeResolver.resolve(
    content.visualTheme.id,
    content.visualTheme.version,
  );
  if (!resolvedThemeDefinition) {
    throw new ApiError(422, "RENDER_INPUT_INVALID", `Visual Themeが見つかりません: ${content.visualTheme.id}@${content.visualTheme.version}`);
  }

  const fontDiagnostics = await fontCatalogService.diagnoseTheme(resolvedThemeDefinition);

  const { references, assetById, faceSetById } = await loadAllReferences(prisma, content);
  assertAssetsAvailable(references, assetById);
  assertTakeDurations(content, assetById);
  assertFaceSetReferences(content, faceSetById, assetById);

  const snapshotFaceSets: RenderJobSnapshot["faceSets"] = [...faceSetById.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((faceSet) => {
      const dto = toFaceSet(faceSet);
      return { id: dto.id, name: dto.name, layers: dto.layers, expressions: dto.expressions };
    });

  const compositionService = new CompositionService({ db: prisma, dataDir: "" });
  const snapshotCompositions: RenderJobSnapshot["compositionVersions"] = [];

  for (const compVerId of collectCompositionVersionIds(content)) {
    let compVer;
    try {
      compVer = await compositionService.getVersionById(compVerId);
    } catch {
      throw new ApiError(422, "RENDER_INPUT_INVALID", `Composition version not found: ${compVerId}`);
    }
    snapshotCompositions.push({
      id: compVer.id,
      bundleHash: compVer.bundleHash,
      storageKey: compVer.storageKey,
      manifest: compVer.manifest,
    });
  }

  try {
    compileDocument({
      document: content,
      resolvedTheme: resolvedThemeDefinition,
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
          url: "",
          kind: kind as ResolvedAssetKind,
          durationMs: kind === "image" ? null : renderSourceDurationMs(asset),
        };
      },
      compositionResolver: (versionId) => {
        const found = snapshotCompositions.find((c) => c.id === versionId);
        if (!found) {
          throw new CompositionCompileError([
            {
              path: ["compositions", versionId],
              code: "unresolvable_composition",
              message: "CompositionVersionを解決できません。",
            },
          ]);
        }
        return {
          id: found.id,
          runtimeCompositionId: found.manifest.runtimeCompositionId,
          entrypoint: found.manifest.entrypoint,
          bundleHash: found.bundleHash,
          storageKey: found.storageKey,
          manifest: found.manifest,
        };
      },
      faceSetResolver: (faceSetId) => {
        const found = snapshotFaceSets.find((faceSet) => faceSet.id === faceSetId);
        if (!found) {
          throw new CompositionCompileError([
            {
              path: ["faceSets", faceSetId],
              code: "unresolvable_face_set",
              message: "表情セットを解決できません。",
            },
          ]);
        }
        return found;
      },
    });
  } catch (error) {
    if (error instanceof CompositionCompileError) {
      throw new ApiError(422, "RENDER_INPUT_INVALID", undefined, { issues: error.issues });
    }
    throw error;
  }

  const snapshotAssets: RenderJobSnapshot["assets"] = [
    ...new Set(references.map((reference) => reference.assetId)),
  ].map((assetId) => {
    const asset = assetById.get(assetId);
    if (asset === undefined) {
      throw new ApiError(500, "INTERNAL_ERROR", "素材を解決できません。");
    }
    const rendition = asset.renditions.find((entry) => entry.purpose === RENDITION_PURPOSE);
    const source = rendition ?? asset;
    return {
      assetId: asset.id,
      renditionId: rendition?.id ?? null,
      sha256: source.sha256,
      mediaType: source.mediaType,
      byteSize: bigIntToSafeNumber(source.byteSize),
      durationMs: renderSourceDurationMs(asset),
      widthPx: source.widthPx,
      heightPx: source.heightPx,
    };
  });

  const producerVersion = getProducerVersion();
  const snapshot = renderJobSnapshotSchema.parse({
    snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
    kind: "render",
    scriptVersionId: row.id,
    versionNumber: row.versionNumber,
    content,
    assets: snapshotAssets,
    compositionVersions: snapshotCompositions,
    faceSets: snapshotFaceSets,
    themeDefinition: resolvedThemeDefinition,
    fontDiagnostics,
    template: { id: content.template.id, version: content.template.version },
    output: { width: 1920, height: 1080, fps: 30, format: "mp4" },
    renderer: {
      engine: COMPOSITION_ENGINE,
      compilerVersion: COMPILER_VERSION,
      ...(producerVersion === undefined ? {} : { producerVersion }),
    },
  });

  const created = await prisma.job.create({
    data: {
      kind: "render",
      status: "queued",
      workId: row.languageEdition.workId,
      languageEditionId: row.languageEdition.id,
      scriptVersionId: row.id,
      snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
      inputSnapshotJson: JSON.stringify(snapshot),
    },
    include: { artifacts: true },
  });
  return toJob(created);
}
