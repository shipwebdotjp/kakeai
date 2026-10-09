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
import { bigIntToSafeNumber, toJob } from "../dto/mappers.ts";
import { ApiError } from "../http/errors.ts";
import { resourceNotFound } from "../http/validation.ts";
import {
  assertAssetsAvailable,
  assertTakeDurations,
  loadAssetReferences,
  renderSourceDurationMs,
} from "./script-versions.ts";

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

  const { references, assetById } = await loadAssetReferences(prisma, content);
  assertAssetsAvailable(references, assetById);
  assertTakeDurations(content, assetById);

  try {
    compileDocument({
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
          url: "",
          kind: kind as ResolvedAssetKind,
          durationMs: kind === "audio" ? renderSourceDurationMs(asset) : null,
        };
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
