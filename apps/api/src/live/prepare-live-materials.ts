import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectAssetReferences,
  type ContentDocument,
  type LiveResolutionMaterial,
  type MaterialCard,
  type Scene,
  type VisualThemeDefinition,
} from "@kakeai/contracts";
import { createRenderJob, executeRenderJob } from "@hyperframes/producer";
import {
  assertStaticHtml,
  compileMaterialCardRaw,
  compileStaticMaterialCard,
  CompositionCompileError,
  type AssetResolver,
  type CompiledMaterialCard,
} from "@kakeai/video";
import { getSharedRasterizer, type Rasterizer } from "../media/rasterize.ts";
import { probeMedia, type MediaProbe } from "../media/probe.ts";
import { LiveExportError } from "./errors";
import { toLiveMediaType } from "./media-types";
import type { PackageWriter } from "./package-writer";
import type { ResolvedAssetFile } from "./resolved-assets";

const STATIC_MATERIAL_DURATION_MS = 4_000;
const MP4_DURATION_TOLERANCE_MS = 150;
const WIDTH = 1920;
const HEIGHT = 1080;
/** An inline data URL prefixes ~4/3 of the bytes; keep one image bounded. */
const MAX_INLINE_ASSET_BYTES = 15 * 1024 * 1024;
const UNSUPPORTED_TEMPLATES = new Set(["character.standing", "composition.full-bleed"]);

export interface RenderMp4Input {
  html: string;
  workDir: string;
  outputPath: string;
  durationMs: number;
}

export type RenderMp4 = (input: RenderMp4Input) => Promise<void>;

export interface PrepareLiveMaterialsDependencies {
  rasterizer?: Rasterizer;
  renderMp4?: RenderMp4;
  /** Base directory for MP4 scratch files. The worker passes the package temp dir. */
  workDir?: string;
  isCancelled?: () => Promise<boolean>;
}

function fail(message: string, id: string | null = null): never {
  throw new LiveExportError("LIVE_EXPORT_MATERIAL_FAILED", "material", message, id);
}

/**
 * A Live Material is a static scene snapshot. The snapshot's format decides
 * whether it becomes a PNG still, a script-less HTML card or a short MP4.
 */
function materialDocument(
  scene: Scene,
  theme: VisualThemeDefinition,
  durationMs: number,
): ContentDocument {
  return {
    schemaVersion: 1,
    locale: "ja-JP",
    template: { id: "explanation-scenes", version: 1 },
    visualTheme: { id: theme.id, version: theme.version },
    speakers: [],
    characters: [],
    audioTakes: [],
    audioCues: [],
    scenes: [
      {
        ...scene,
        timing: { mode: "fixed", durationMs },
        lines: [],
        visualCues: [...scene.visualCues],
        standingStates: [],
      } as Scene,
    ],
  };
}

function assetIdsFor(
  scene: Scene,
  theme: VisualThemeDefinition,
  durationMs: number,
): string[] {
  return [
    ...new Set(
      collectAssetReferences(materialDocument(scene, theme, durationMs)).map(
        (reference) => reference.assetId,
      ),
    ),
  ];
}

/**
 * Structural checks shared by Job creation and the worker. Missing snapshot
 * assets are reported before any rendering starts.
 */
export function validateLiveMaterialSnapshot(
  material: LiveResolutionMaterial,
  assetById: ReadonlyMap<string, { kind: string }>,
  theme: VisualThemeDefinition,
): void {
  const scene = material.scene;
  if (scene.lines.length > 0) {
    fail("素材カードの Scene にセリフがあります。", material.materialId);
  }
  if ((scene.standingStates ?? []).length > 0) {
    fail("素材カードの Scene に立ち絵状態があります。", material.materialId);
  }
  for (const cue of scene.visualCues) {
    if (cue.range.kind !== "scene") {
      fail("素材カードの VisualCue は range: scene だけを使えます。", material.materialId);
    }
    if (UNSUPPORTED_TEMPLATES.has(cue.template.id)) {
      fail(`素材カードでは ${cue.template.id} を使えません。`, material.materialId);
    }
  }
  for (const assetId of assetIdsFor(
    scene,
    theme,
    material.format === "mp4"
      ? material.durationMs
      : STATIC_MATERIAL_DURATION_MS,
  )) {
    const asset = assetById.get(assetId);
    if (asset === undefined) {
      fail(`素材カードの Asset が見つかりません: ${assetId}`, material.materialId);
    }
    if (asset.kind !== "image") {
      fail("素材カードに画像以外の Asset は使えません。", material.materialId);
    }
  }
}

async function dataUrlForAsset(
  asset: ResolvedAssetFile,
  materialId: string,
): Promise<string> {
  let knownSize: number | null = null;
  try {
    knownSize = (await stat(asset.path)).size;
  } catch {
    // readFile below reports the missing file with its original error.
  }
  if (knownSize !== null && knownSize > MAX_INLINE_ASSET_BYTES) {
    fail(
      `素材カードに埋め込む画像が大きすぎます（上限 ${MAX_INLINE_ASSET_BYTES} バイト）: ${asset.path}`,
      materialId,
    );
  }
  const data = await readFile(asset.path);
  // Re-check after reading in case the file grew between stat and read.
  if (data.byteLength > MAX_INLINE_ASSET_BYTES) {
    fail(
      `素材カードに埋め込む画像が大きすぎます（上限 ${MAX_INLINE_ASSET_BYTES} バイト）: ${asset.path}`,
      materialId,
    );
  }
  return `data:${asset.mediaType};base64,${data.toString("base64")}`;
}

async function assetResolverFor(
  scene: Scene,
  theme: VisualThemeDefinition,
  durationMs: number,
  format: LiveResolutionMaterial["format"],
  assetById: Map<string, ResolvedAssetFile>,
  writer: PackageWriter,
  materialId: string,
): Promise<AssetResolver> {
  const resolved = new Map<string, { url: string; kind: "image"; durationMs: null }>();
  for (const assetId of assetIdsFor(scene, theme, durationMs)) {
    const asset = assetById.get(assetId);
    if (asset === undefined) {
      fail(`素材カードの Asset が見つかりません: ${assetId}`, materialId);
    }
    if (asset.kind !== "image") {
      fail("素材カードに画像以外の Asset は使えません。", materialId);
    }
    if (format === "html") {
      // HTML cards reference packaged files instead of inlining bytes. The
      // returned path is relative to `materials/card-NNNN.html`.
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
        url: await dataUrlForAsset(asset, materialId),
        kind: "image",
        durationMs: null,
      });
    }
  }
  return (assetId) => {
    const asset = resolved.get(assetId);
    if (asset === undefined) {
      fail(`素材カードの Asset を解決できません: ${assetId}`, materialId);
    }
    return asset;
  };
}

async function defaultRenderMp4(input: RenderMp4Input): Promise<void> {
  await writeFile(join(input.workDir, "index.html"), input.html, "utf8");
  const job = createRenderJob({ fps: 30, format: "mp4", quality: "standard" });
  await executeRenderJob(job, input.workDir, input.outputPath);
}

async function prepareOne(
  material: LiveResolutionMaterial,
  theme: VisualThemeDefinition,
  assetById: Map<string, ResolvedAssetFile>,
  writer: PackageWriter,
  index: number,
  dependencies: PrepareLiveMaterialsDependencies,
): Promise<MaterialCard> {
  const durationMs =
    material.format === "mp4" ? material.durationMs : STATIC_MATERIAL_DURATION_MS;
  const document = materialDocument(material.scene, theme, durationMs);
  const assetResolver = await assetResolverFor(
    material.scene,
    theme,
    durationMs,
    material.format,
    assetById,
    writer,
    material.materialId,
  );
  let compiled: CompiledMaterialCard;
  try {
    compiled = (material.format === "html"
      ? compileStaticMaterialCard
      : compileMaterialCardRaw)({
      document,
      sceneId: material.scene.id,
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
        material.materialId,
      );
    }
    throw error;
  }

  const fileBase = `materials/card-${String(index + 1).padStart(4, "0")}`;
  if (material.format === "png") {
    const rasterizer = dependencies.rasterizer ?? getSharedRasterizer();
    const png = await rasterizer.renderPng(compiled.html, WIDTH, HEIGHT);
    const file = `${fileBase}.png`;
    await writer.writeBuffer(file, png, {
      mediaType: "image/png",
      kind: "material",
      durationMs: null,
      width: WIDTH,
      height: HEIGHT,
      hasAudio: false,
    });
    return {
      id: material.materialId,
      kind: "image",
      file,
      hasAudio: false,
      focus: true,
      width: WIDTH,
      height: HEIGHT,
    };
  }

  if (material.format === "html") {
    const html = compiled.html;
    assertStaticHtml(html, material.scene.id);
    const file = `${fileBase}.html`;
    await writer.writeText(file, html, {
      mediaType: "text/html",
      kind: "material",
      durationMs: null,
      width: WIDTH,
      height: HEIGHT,
      hasAudio: false,
    });
    return {
      id: material.materialId,
      kind: "html",
      file,
      hasAudio: false,
      focus: true,
      width: WIDTH,
      height: HEIGHT,
    };
  }

  const scratchBase = dependencies.workDir ?? tmpdir();
  await mkdir(scratchBase, { recursive: true });
  const workDir = await mkdtemp(join(scratchBase, "material-"));
  try {
    const outputPath = join(workDir, "output.mp4");
    const renderMp4 = dependencies.renderMp4 ?? defaultRenderMp4;
    try {
      await renderMp4({
        html: compiled.html,
        workDir,
        outputPath,
        durationMs,
      });
    } catch (error) {
      if (error instanceof LiveExportError) {
        throw error;
      }
      fail(
        `MP4 素材カードのレンダーに失敗しました: ${material.materialId} (${error instanceof Error ? error.message : String(error)})`,
        material.materialId,
      );
    }

    let probe: MediaProbe;
    try {
      probe = await probeMedia(outputPath, "video", "video/mp4");
    } catch {
      fail("MP4 素材カードの情報を取得できませんでした。", material.materialId);
    }
    if (probe.audioCodec !== null) {
      fail("MP4 素材カードに音声が含まれています。", material.materialId);
    }
    if (probe.widthPx !== WIDTH || probe.heightPx !== HEIGHT) {
      fail(
        `MP4 素材カードの寸法が ${WIDTH}x${HEIGHT} ではありません。`,
        material.materialId,
      );
    }
    if (probe.durationMs === null || probe.durationMs <= 0) {
      fail("MP4 素材カードの尺を取得できませんでした。", material.materialId);
    }
    if (Math.abs(probe.durationMs - durationMs) > MP4_DURATION_TOLERANCE_MS) {
      fail(
        `MP4 素材カードの尺が要求と一致しません: ${probe.durationMs}ms / ${durationMs}ms`,
        material.materialId,
      );
    }
    const file = `${fileBase}.mp4`;
    await writer.copyFile(outputPath, file, {
      mediaType: "video/mp4",
      kind: "material",
      durationMs: probe.durationMs,
      width: WIDTH,
      height: HEIGHT,
      hasAudio: false,
    });
    return {
      id: material.materialId,
      kind: "video",
      file,
      hasAudio: false,
      focus: true,
      width: WIDTH,
      height: HEIGHT,
      durationMs: probe.durationMs,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Renders every program-owned Live Material from its own snapshot. Work and
 * Scene ids are intentionally never consulted. MP4 scratch work happens under
 * `dependencies.workDir` and is removed before the package is verified.
 */
export async function prepareLiveMaterialCards(
  materials: readonly LiveResolutionMaterial[],
  theme: VisualThemeDefinition,
  assetById: Map<string, ResolvedAssetFile>,
  writer: PackageWriter,
  dependencies: PrepareLiveMaterialsDependencies = {},
): Promise<MaterialCard[]> {
  const isCancelled = dependencies.isCancelled ?? (async () => false);
  const cards: MaterialCard[] = [];
  for (const [index, material] of materials.entries()) {
    if (await isCancelled()) {
      throw new LiveExportError("LIVE_EXPORT_FAILED", "output", "書き出しがキャンセルされました。");
    }
    validateLiveMaterialSnapshot(material, assetById, theme);
    cards.push(
      await prepareOne(material, theme, assetById, writer, index, dependencies),
    );
  }
  return cards;
}
