import { randomUUID } from "node:crypto";
import { createRenderJob, executeRenderJob } from "@hyperframes/producer";
import { collectAssetReferences } from "@kakeai/contracts";
import {
  assertStaticHtml,
  compileMaterialCardRaw,
  compileStaticMaterialCard,
  CompositionCompileError,
  type AssetResolver,
  type CompiledMaterialCard,
} from "@kakeai/video";
import { readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ContentDocument,
  LiveMaterialInput,
  LiveShowProfile,
  MaterialCard,
  Scene,
  VisualThemeDefinition,
} from "@kakeai/contracts";
import type { AppConfig } from "../config.ts";
import { getSharedRasterizer, type Rasterizer } from "../media/rasterize.ts";
import { probeMedia, type MediaProbe } from "../media/probe.ts";
import { LiveExportError } from "./errors";
import { toLiveMediaType } from "./media-types";
import type { PackageWriter } from "./package-writer";
import type { ResolvedAssetFile } from "./profile-resolution";

export interface RenderMp4Input {
  html: string;
  workDir: string;
  outputPath: string;
  durationMs: number;
}

export type RenderMp4 = (input: RenderMp4Input) => Promise<void>;

export interface PrepareMaterialsDependencies {
  rasterizer?: Rasterizer;
  renderMp4?: RenderMp4;
  isCancelled?: () => Promise<boolean>;
}

export interface PreparedMaterials {
  materials: MaterialCard[];
  warnings: string[];
}

function fail(message: string, id: string | null = null): never {
  throw new LiveExportError("LIVE_EXPORT_MATERIAL_FAILED", "material", message, id);
}

const UNSUPPORTED_TEMPLATES = new Set(["character.standing", "composition.full-bleed"]);

/**
 * Structural validation shared by Job creation and the worker. It rejects the
 * cases v1 cards cannot represent before any expensive rendering starts.
 */
export function validateMaterialScene(
  material: LiveMaterialInput,
  content: ContentDocument,
  assetById: ReadonlyMap<string, { kind: string }>,
): void {
  const scene = content.scenes.find((entry) => entry.id === material.sceneId);
  if (scene === undefined) {
    fail(`素材 Scene が見つかりません: ${material.sceneId}`, material.sceneId);
  }
  if (scene.lines.length > 0) {
    fail("素材カードの Scene にセリフがあります。", material.id);
  }
  if ((scene.standingStates ?? []).length > 0) {
    fail("素材カードの Scene に立ち絵状態があります。", material.id);
  }
  if (
    content.audioCues.some(
      (cue) => cue.range.kind === "scene" && cue.range.sceneId === scene.id,
    )
  ) {
    fail("素材カードの Scene に音声キューがあります。", material.id);
  }
  for (const cue of scene.visualCues) {
    if (cue.range.kind !== "scene") {
      fail("素材カードの VisualCue は range: scene だけを使えます。", material.id);
    }
    if (UNSUPPORTED_TEMPLATES.has(cue.template.id)) {
      fail(`素材カードでは ${cue.template.id} を使えません。`, material.id);
    }
  }
  const document = cardDocument(content, scene, material.durationMs);
  for (const reference of collectAssetReferences(document)) {
    const asset = assetById.get(reference.assetId);
    if (asset === undefined) {
      fail(`素材カードの Asset が見つかりません: ${reference.assetId}`, material.id);
    }
    if (asset.kind !== "image") {
      fail("素材カードに画像以外の Asset は使えません。", material.id);
    }
  }
}

export function validateMaterialScenes(
  profile: LiveShowProfile,
  content: ContentDocument,
  assetById: ReadonlyMap<string, { kind: string }>,
): void {
  for (const material of profile.materials) {
    validateMaterialScene(material, content, assetById);
  }
}

async function defaultRenderMp4(input: RenderMp4Input): Promise<void> {
  await writeFile(join(input.workDir, "index.html"), input.html, "utf8");
  const job = createRenderJob({ fps: 30, format: "mp4", quality: "standard" });
  await executeRenderJob(job, input.workDir, input.outputPath);
}

function cardDocument(content: ContentDocument, scene: Scene, durationMs: number): ContentDocument {
  return {
    ...content,
    scenes: [
      {
        ...scene,
        timing: { mode: "fixed", durationMs },
        lines: [],
        visualCues: [...scene.visualCues],
        standingStates: [],
      } as Scene,
    ],
    audioTakes: [],
    audioCues: [],
    characters: [],
    speakers: [],
  };
}

async function dataUrlForAsset(asset: ResolvedAssetFile): Promise<string> {
  const mediaType = toLiveMediaType(asset.mediaType, asset.assetId);
  const data = await readFile(asset.path);
  return `data:${mediaType};base64,${data.toString("base64")}`;
}

async function prepareAssetsForCard(
  content: ContentDocument,
  scene: Scene,
  durationMs: number,
  format: LiveMaterialInput["format"],
  assetById: Map<string, ResolvedAssetFile>,
  writer: PackageWriter,
): Promise<AssetResolver> {
  const document = cardDocument(content, scene, durationMs);
  const ids = [...new Set(collectAssetReferences(document).map((reference) => reference.assetId))];
  const resolved = new Map<string, { url: string; kind: "image"; durationMs: null }>();
  for (const assetId of ids) {
    const asset = assetById.get(assetId);
    if (asset === undefined) {
      fail(`素材カードの Asset が見つかりません: ${assetId}`, assetId);
    }
    if (asset.kind !== "image") {
      fail(`素材カードに画像以外の Asset は使えません: ${assetId}`, assetId);
    }
    if (format === "html") {
      const relativePath = await writer.writeAsset(asset.path, {
        mediaType: toLiveMediaType(asset.mediaType, assetId),
        kind: "asset",
        durationMs: null,
        width: asset.widthPx,
        height: asset.heightPx,
        hasAudio: false,
      });
      resolved.set(assetId, {
        url: `../${relativePath}`,
        kind: "image",
        durationMs: null,
      });
    } else {
      resolved.set(assetId, {
        url: await dataUrlForAsset(asset),
        kind: "image",
        durationMs: null,
      });
    }
  }
  return (assetId) => {
    const asset = resolved.get(assetId);
    if (asset === undefined) {
      fail(`素材カードの Asset を解決できません: ${assetId}`, assetId);
    }
    return asset;
  };
}

async function prepareOne(
  material: LiveMaterialInput,
  content: ContentDocument,
  theme: VisualThemeDefinition,
  assetById: Map<string, ResolvedAssetFile>,
  writer: PackageWriter,
  config: AppConfig,
  index: number,
  dependencies: PrepareMaterialsDependencies,
): Promise<MaterialCard> {
  const scene = content.scenes.find((entry) => entry.id === material.sceneId);
  if (scene === undefined) {
    fail(`素材 Scene が見つかりません: ${material.sceneId}`, material.sceneId);
  }
  if ((scene.standingStates ?? []).length > 0) {
    fail("素材カードの Scene に立ち絵状態があります。", material.sceneId);
  }
  if (scene.lines.length > 0) {
    fail("素材カードの Scene にセリフがあります。", material.sceneId);
  }

  const durationMs = material.format === "mp4" ? material.durationMs : 4000;
  const assetResolver = await prepareAssetsForCard(
    content,
    scene,
    durationMs,
    material.format,
    assetById,
    writer,
  );

  let compiled: CompiledMaterialCard;
  try {
    compiled = (material.format === "html" ? compileStaticMaterialCard : compileMaterialCardRaw)({
      document: content,
      sceneId: material.sceneId,
      theme,
      durationMs,
      assetResolver,
    });
  } catch (error) {
    if (error instanceof CompositionCompileError) {
      throw new LiveExportError(
        "LIVE_EXPORT_MATERIAL_FAILED",
        "material",
        error.issues.map((issue) => issue.message).join(" / "),
        material.id,
      );
    }
    throw error;
  }

  const fileBase = `materials/card-${String(index + 1).padStart(4, "0")}`;
  if (material.format === "png") {
    const rasterizer = dependencies.rasterizer ?? getSharedRasterizer();
    const png = await rasterizer.renderPng(compiled.html, 1920, 1080);
    const file = `${fileBase}.png`;
    await writer.writeBuffer(file, png, {
      mediaType: "image/png",
      kind: "material",
      durationMs: null,
      width: 1920,
      height: 1080,
      hasAudio: false,
    });
    return {
      id: material.id,
      kind: "image",
      file,
      hasAudio: false,
      focus: material.focus,
      width: 1920,
      height: 1080,
    };
  }

  if (material.format === "html") {
    const html = compiled.html;
    assertStaticHtml(html, material.sceneId);
    const file = `${fileBase}.html`;
    await writer.writeText(file, html, {
      mediaType: "text/html",
      kind: "material",
      durationMs: null,
      width: 1920,
      height: 1080,
      hasAudio: false,
    });
    return {
      id: material.id,
      kind: "html",
      file,
      hasAudio: false,
      focus: material.focus,
      width: 1920,
      height: 1080,
    };
  }

  const workDir = join(config.directories.tmp, `live-card-${randomUUID()}`);
  const htmlPath = join(workDir, "index.html");
  const outputPath = join(workDir, "output.mp4");
  try {
    await mkdir(workDir, { recursive: true });
    await writeFile(htmlPath, compiled.html, "utf8");
    const renderMp4 = dependencies.renderMp4 ?? defaultRenderMp4;
    await renderMp4({
      html: compiled.html,
      workDir,
      outputPath,
      durationMs,
    });
    let probe: MediaProbe;
    try {
      probe = await probeMedia(outputPath, "video", "video/mp4");
    } catch {
      fail("MP4 素材カードの情報を取得できませんでした。", material.id);
    }
    if (probe.audioCodec !== null) {
      fail("MP4 素材カードに音声が含まれています。", material.id);
    }
    if (probe.widthPx !== 1920 || probe.heightPx !== 1080) {
      fail("MP4 素材カードの寸法が 1920x1080 ではありません。", material.id);
    }
    if (probe.durationMs === null) {
      fail("MP4 素材カードの尺を取得できませんでした。", material.id);
    }
    if (Math.abs(probe.durationMs - durationMs) > 150) {
      fail(
        `MP4 素材カードの尺が要求と一致しません: ${probe.durationMs}ms / ${durationMs}ms`,
        material.id,
      );
    }
    const file = `${fileBase}.mp4`;
    await writer.copyFile(outputPath, file, {
      mediaType: "video/mp4",
      kind: "material",
      durationMs: probe.durationMs,
      width: 1920,
      height: 1080,
      hasAudio: false,
    });
    return {
      id: material.id,
      kind: "video",
      file,
      hasAudio: false,
      focus: material.focus,
      width: 1920,
      height: 1080,
      durationMs: probe.durationMs,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function prepareMaterials(
  profile: LiveShowProfile,
  content: ContentDocument,
  theme: VisualThemeDefinition,
  assetById: Map<string, ResolvedAssetFile>,
  writer: PackageWriter,
  config: AppConfig,
  dependencies: PrepareMaterialsDependencies = {},
): Promise<PreparedMaterials> {
  validateMaterialScenes(profile, content, assetById);
  const isCancelled = dependencies.isCancelled ?? (async () => false);
  const warnings: string[] = [];
  const materials: MaterialCard[] = [];
  for (const [index, material] of profile.materials.entries()) {
    if (await isCancelled()) {
      throw new LiveExportError("LIVE_EXPORT_FAILED", "output", "書き出しがキャンセルされました。");
    }
    materials.push(
      await prepareOne(
        material,
        content,
        theme,
        assetById,
        writer,
        config,
        index,
        dependencies,
      ),
    );
  }
  return { materials, warnings };
}
