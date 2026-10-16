import {
  characterStandingV1InputSchema,
  type ContentDocument,
  type SnapshotFaceSet,
} from "@kakeai/contracts";
import type { AssetResolver } from "../resolver";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlAttribute } from "../escape";
import { OUTPUT_WIDTH } from "../meta";
import type { ExpressionTarget, RenderedCue, RenderContext } from "../render-context";
import { resolveCueMedia } from "./shared";

const STANDING_BASE_WIDTH_PX = 480;
const STANDING_EDGE_MARGIN = 0.03;
const STANDING_Y = 0.86;

export function standingPosition(
  side: "left" | "right",
  scale: number,
): { x: number; y: number } {
  const halfWidth = (STANDING_BASE_WIDTH_PX * scale) / 2 / OUTPUT_WIDTH;
  const x =
    side === "left"
      ? STANDING_EDGE_MARGIN + halfWidth
      : 1 - STANDING_EDGE_MARGIN - halfWidth;
  return { x, y: STANDING_Y };
}

function resolveStandingAppearance(
  characterId: string,
  appearanceId: string,
  document: ContentDocument,
  path: (string | number)[],
  assetResolver: AssetResolver,
): { src: string; assetId: string } {
  const character = document.characters.find((entry) => entry.id === characterId);
  const appearance = character?.appearances.find((entry) => entry.id === appearanceId);
  if (appearance === undefined) {
    throw new CompositionCompileError([
      { path, code: "unknown_appearance", message: "立ち絵の参照を解決できません。" },
    ]);
  }
  const media = resolveCueMedia(appearance.assetId, assetResolver, path);
  if (media.kind !== "image") {
    throw new CompositionCompileError([
      { path, code: "invalid_asset_kind", message: "立ち絵には画像素材を指定してください。" },
    ]);
  }
  return { src: escapeHtmlAttribute(media.url), assetId: appearance.assetId };
}



function resolveFaceLayerImage(
  faceSet: SnapshotFaceSet,
  layerId: string | null,
  context: RenderContext,
): { html: string; src: string; assetId: string } | null {
  if (layerId === null) {
    return null;
  }
  const layer = faceSet.layers.find((entry) => entry.id === layerId);
  if (layer === undefined) {
    throw new CompositionCompileError([
      { path: context.path, code: "unknown_face_layer", message: "顔レイヤーを解決できません。" },
    ]);
  }
  const media = resolveCueMedia(layer.assetId, context.assetResolver, context.path);
  if (media.kind !== "image") {
    throw new CompositionCompileError([
      { path: context.path, code: "invalid_asset_kind", message: "顔レイヤーには画像素材を指定してください。" },
    ]);
  }
  return {
    html: `<img class="kakeai-face" src="${escapeHtmlAttribute(media.url)}" alt="">`,
    src: escapeHtmlAttribute(media.url),
    assetId: layer.assetId,
  };
}

export function renderCharacterStanding(input: unknown, context: RenderContext): RenderedCue {
  const parsed = characterStandingV1InputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path: context.path, code: "invalid_input", message: "character.standing の入力が不正です。" },
    ]);
  }
  const { characterId, appearanceId, side, scale } = parsed.data;
  const { src, assetId } = resolveStandingAppearance(
    characterId,
    appearanceId,
    context.document,
    context.path,
    context.assetResolver,
  );
  const layout = standingPosition(side, scale);
  const widthPx = Math.round(STANDING_BASE_WIDTH_PX * scale);
  const leftPercent = Math.round(layout.x * 10000) / 100;
  const topPercent = Math.round(layout.y * 10000) / 100;
  const character = context.document.characters.find((entry) => entry.id === characterId);
  const appearance = character?.appearances.find((entry) => entry.id === appearanceId);
  const faceSetId = appearance?.faceSetId ?? null;
  if (faceSetId === null) {
    const id = context.scope.id("img");
    return {
      html: `<div class="kakeai-standingv2" style="left:${leftPercent}%;top:${topPercent}%;"><img id="${id}" class="kakeai-standingimg" src="${src}" style="width:${widthPx}px;" alt=""></div>`,
      assetIds: [assetId],
      animation: [],
      motionTargetId: id,
    };
  }
  if (context.faceSetResolver === undefined) {
    throw new CompositionCompileError([
      { path: context.path, code: "unknown_face_set", message: "表情セットを解決できません。" },
    ]);
  }
  let faceSet: SnapshotFaceSet;
  try {
    faceSet = context.faceSetResolver(faceSetId);
  } catch {
    throw new CompositionCompileError([
      { path: context.path, code: "unknown_face_set", message: "表情セットを解決できません。" },
    ]);
  }
  const assetIds = [assetId];
  const track = (id: string): void => {
    if (!assetIds.includes(id)) {
      assetIds.push(id);
    }
  };
  if (!faceSet.expressions.some((preset) => preset.id === "normal")) {
    throw new CompositionCompileError([
      { path: context.path, code: "missing_normal_expression", message: "表情セットに normal が必要です。" },
    ]);
  }
  const layerHtml = (layerId: string | null): string => {
    const resolved = resolveFaceLayerImage(faceSet, layerId, context);
    if (resolved === null) {
      return "";
    }
    track(resolved.assetId);
    return resolved.html;
  };
  const partHtml = (
    layerId: string | null,
    part: "eye" | "mouth",
    groupIndex: number,
    target: ExpressionTarget,
  ): string => {
    if (layerId === null) {
      return "";
    }
    const base = resolveFaceLayerImage(faceSet, layerId, context);
    if (base === null) {
      return "";
    }
    track(base.assetId);
    const baseLayer = faceSet.layers.find((entry) => entry.id === layerId);
    const variantLayerId =
      baseLayer === undefined ? null : part === "eye" ? baseLayer.blinkLayerId : baseLayer.speakingLayerId;
    if (variantLayerId === null) {
      return base.html;
    }
    const variant = resolveFaceLayerImage(faceSet, variantLayerId, context);
    if (variant === null) {
      return base.html;
    }
    track(variant.assetId);
    const baseElementId = context.scope.id(`face-${groupIndex}-${part}-base`);
    const variantElementId = context.scope.id(`face-${groupIndex}-${part}`);
    if (part === "eye") {
      target.eyeBlinkId = variantElementId;
      target.eyeBaseId = baseElementId;
    } else {
      target.mouthSpeakingId = variantElementId;
      target.mouthBaseId = baseElementId;
    }
    return `<img id="${baseElementId}" class="kakeai-face" src="${base.src}" alt=""><img id="${variantElementId}" class="kakeai-face" src="${variant.src}" style="opacity:0;" alt="">`;
  };
  const expressionTargets: ExpressionTarget[] = [];
  const groups = faceSet.expressions.map((preset, index) => {
    const elementId = context.scope.id(`face-${index}`);
    const target: ExpressionTarget = { presetId: preset.id, elementId };
    expressionTargets.push(target);
    const hidden = preset.id === "normal" ? "" : ` style="opacity:0;"`;
    const brow = layerHtml(preset.browLayerId);
    const eye = partHtml(preset.eyeLayerId, "eye", index, target);
    const mouth = partHtml(preset.mouthLayerId, "mouth", index, target);
    return `<div id="${elementId}" class="kakeai-facegroup"${hidden}>${brow}${eye}${mouth}</div>`;
  });
  const foreground = faceSet.layers
    .filter((layer) => layer.part === "foreground")
    .map((layer) => layerHtml(layer.id))
    .join("");
  const wrapperId = context.scope.id("wrap");
  return {
    html: `<div id="${wrapperId}" class="kakeai-standingv2" style="left:${leftPercent}%;top:${topPercent}%;"><img class="kakeai-standingimg" src="${src}" style="width:${widthPx}px;" alt="">${groups.join("")}${foreground}</div>`,
    assetIds,
    animation: [],
    motionTargetId: wrapperId,
    expressionTargets,
  };
}
