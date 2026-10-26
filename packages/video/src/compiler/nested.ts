import {
  type ContentDocument,
  type NestedVisual,
  type VisualThemeDefinition,
} from "@kakeai/contracts";
import type {
  CompositionVersionResolver,
  CompositionVersionResolved,
} from "../composition-resolver";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlAttribute } from "../escape";
import type {
  AssetResolver,
  FaceSetResolver,
  StillResolver,
} from "../resolver";
import { type RenderScope } from "../scope";
import type {
  RenderedCue,
  RenderContext,
  CueTiming,
  LineInterval,
} from "../render-context";
import { type VideoPlaybackPlan } from "../video-playback";
import { neutralVisualSkin } from "../skins/neutral";
import type { ResolvedVisualSkin } from "../skins/types";
import {
  focalPointStyle,
  renderVideoPlaybackSegments,
  requireVideoPlaybackPlan,
  assertVideoMedia,
  resolveCueMedia,
} from "../templates/shared";

function renderNestedMedia(
  node: NestedVisual & { kind: "media" },
  context: RenderContext,
): RenderedCue {
  const media = resolveCueMedia(
    node.assetId,
    context.assetResolver,
    context.path,
  );
  const id = context.scope.id("media");
  const fit = node.fit === "contain" ? "contain" : "cover";
  const style = `object-fit:${fit};${focalPointStyle(node.focalPoint)}`;
  if (node.videoPlayback !== undefined) {
    assertVideoMedia(media, context.path);
    const html = renderVideoPlaybackSegments({
      idPrefix: id,
      plan: requireVideoPlaybackPlan(context),
      videoUrl: media.url,
      className: "kakeai-nestedmedia",
      style,
      stillResolver: context.stillResolver,
      path: context.path,
    });
    return { html, assetIds: [node.assetId], animation: [] };
  }
  if (media.kind === "video") {
    return {
      html: `<video id="${id}" class="kakeai-nestedmedia" src="${escapeHtmlAttribute(media.url)}" style="${style}" muted playsinline preload="auto" data-media-start="0"></video>`,
      assetIds: [node.assetId],
      animation: [],
    };
  }
  return {
    html: `<img id="${id}" class="kakeai-nestedmedia" src="${escapeHtmlAttribute(media.url)}" style="${style}" alt="">`,
    assetIds: [node.assetId],
    animation: [],
  };
}

export function dispatchTemplate(
  key: string,
  input: unknown,
  context: RenderContext,
): RenderedCue & { compositionVersion?: CompositionVersionResolved } {
  const renderer =
    context.skin.templateRenderers.get(key) ??
    neutralVisualSkin.templateRenderers.get(key);
  if (renderer === undefined) {
    throw new CompositionCompileError([
      {
        path: [...context.path, "template"],
        code: "unknown_template",
        message: `未対応のVisualTemplateです: ${key}`,
      },
    ]);
  }
  return renderer(input, context);
}

export function makeContext(
  document: ContentDocument,
  theme: VisualThemeDefinition,
  skin: ResolvedVisualSkin,
  assetResolver: AssetResolver,
  scope: RenderScope,
  path: (string | number)[],
  faceSetResolver?: FaceSetResolver,
  cueTiming?: CueTiming,
  lineIntervals?: LineInterval[],
  compositionResolver?: CompositionVersionResolver,
  collectComposition?: (resolved: CompositionVersionResolved) => void,
  videoPlaybackPlans?: ReadonlyMap<string, VideoPlaybackPlan>,
  stillResolver?: StillResolver,
): RenderContext {
  const context: RenderContext = {
    document,
    theme,
    skin,
    assetResolver,
    faceSetResolver,
    compositionResolver,
    collectComposition,
    scope,
    path,
    cueTiming,
    lineIntervals,
    videoPlaybackPlans,
    stillResolver,
    renderNested: (node, nestedScope, nestedPath) =>
      renderNestedVisual(
        node,
        makeContext(
          document,
          theme,
          skin,
          assetResolver,
          nestedScope,
          nestedPath,
          faceSetResolver,
          cueTiming,
          lineIntervals,
          compositionResolver,
          collectComposition,
          videoPlaybackPlans,
          stillResolver,
        ),
      ),
  };
  return context;
}

function renderNestedComposition(
  node: NestedVisual & { kind: "composition" },
  context: RenderContext,
): RenderedCue & { compositionVersion?: CompositionVersionResolved } {
  if (!context.compositionResolver) {
    throw new CompositionCompileError([
      {
        path: context.path,
        code: "missing_composition_resolver",
        message: "CompositionVersionResolver が設定されていません",
      },
    ]);
  }
  let resolved: CompositionVersionResolved;
  try {
    resolved = context.compositionResolver(node.compositionVersionId);
  } catch (err) {
    throw new CompositionCompileError([
      {
        path: [...context.path, "compositionVersionId"],
        code: "unknown_composition_version",
        message: `CompositionVersion を解釈できません: ${(err as Error).message}`,
      },
    ]);
  }
  context.collectComposition?.(resolved);
  const width = resolved.manifest.width;
  const height = resolved.manifest.height;
  const durationMs = resolved.manifest.durationMs;
  if (
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(height) ||
    height <= 0 ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  ) {
    throw new CompositionCompileError([
      {
        path: [...context.path, "compositionVersionId"],
        code: "invalid_composition_manifest",
        message: "CompositionVersion の寸法または尺が不正です",
      },
    ]);
  }
  const zoom = node.zoom ?? 1;
  const posX = node.position?.x ?? 0.5;
  const posY = node.position?.y ?? 0.5;
  const base =
    node.fit === "contain"
      ? `min(tan(atan2(100cqw,${width}px)),tan(atan2(100cqh,${height}px)))`
      : `max(tan(atan2(100cqw,${width}px)),tan(atan2(100cqh,${height}px)))`;
  const scale = zoom === 1 ? base : `calc(${base} * ${zoom})`;
  const slotId = context.scope.id("compslot");
  const zoomId = context.scope.id("compzoom");
  const hostId = context.scope.id("comp-host");
  const src = resolved.previewUrl ?? resolved.entrypoint;
  return {
    html: `<div id="${slotId}" class="kakeai-compslot" style="--kakeai-cw:${width}px;--kakeai-ch:${height}px;--kakeai-s:${scale};--kakeai-posx:${posX};--kakeai-posy:${posY}"><div id="${zoomId}" class="kakeai-compzoom"><div id="${hostId}" class="kakeai-compchild" data-composition-id="${escapeHtmlAttribute(resolved.runtimeCompositionId)}" data-composition-src="${escapeHtmlAttribute(src)}" data-width="${width}" data-height="${height}"></div></div></div>`,
    assetIds: [],
    animation: [],
    compositionVersion: resolved,
    nestedCompositionWindows: [{ targetId: zoomId, durationMs }],
  };
}

export function renderNestedVisual(
  node: NestedVisual,
  context: RenderContext,
): RenderedCue {
  if (node.kind === "media") {
    return renderNestedMedia(node, context);
  }
  if (node.kind === "composition") {
    return renderNestedComposition(node, context);
  }
  return dispatchTemplate(
    `${node.template.id}@${node.template.version}`,
    node.input,
    context,
  );
}
