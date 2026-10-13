import {
  characterStandingV1InputSchema,
  characterStandingV2InputSchema,
  characterStandingV3InputSchema,
  type ContentDocument,
  type SnapshotFaceSet,
} from "@kakeai/contracts";
import type { AssetResolver } from "../resolver";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlAttribute } from "../escape";
import { OUTPUT_WIDTH } from "../meta";
import type { RenderedCue, RenderContext } from "../render-context";
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

export function renderCharacterStandingV1(input: unknown, context: RenderContext): RenderedCue {
  const parsed = characterStandingV1InputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path: context.path, code: "invalid_input", message: "character.standing の入力が不正です。" },
    ]);
  }
  const { characterId, appearanceId, x, y, scale } = parsed.data;
  const { src, assetId } = resolveStandingAppearance(
    characterId,
    appearanceId,
    context.document,
    context.path,
    context.assetResolver,
  );
  const id = context.scope.id("img");
  const widthPx = Math.round(STANDING_BASE_WIDTH_PX * scale);
  return {
    html: `<img id="${id}" class="kakeai-standing" src="${src}" style="left:${x * 100}%;top:${y * 100}%;width:${widthPx}px;" alt="">`,
    assetIds: [assetId],
    animation: [],
  };
}

export function renderCharacterStandingV2(input: unknown, context: RenderContext): RenderedCue {
  const parsed = characterStandingV2InputSchema.safeParse(input);
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
  const id = context.scope.id("img");
  const widthPx = Math.round(STANDING_BASE_WIDTH_PX * scale);
  const leftPercent = Math.round(layout.x * 10000) / 100;
  const topPercent = Math.round(layout.y * 10000) / 100;
  return {
    html: `<div class="kakeai-standingv2" style="left:${leftPercent}%;top:${topPercent}%;"><img id="${id}" class="kakeai-standingimg" src="${src}" style="width:${widthPx}px;" alt=""></div>`,
    assetIds: [assetId],
    animation: [],
    motionTargetId: id,
  };
}

function resolveFaceLayerImage(
  faceSet: SnapshotFaceSet,
  layerId: string | null,
  context: RenderContext,
): { html: string; assetId: string } | null {
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
    assetId: layer.assetId,
  };
}

export function renderCharacterStandingV3(input: unknown, context: RenderContext): RenderedCue {
  const parsed = characterStandingV3InputSchema.safeParse(input);
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
  const expressionTargets: { presetId: string; elementId: string }[] = [];
  const groups = faceSet.expressions.map((preset, index) => {
    const elementId = context.scope.id(`face-${index}`);
    expressionTargets.push({ presetId: preset.id, elementId });
    const hidden = preset.id === "normal" ? "" : ` style="opacity:0;"`;
    return `<div id="${elementId}" class="kakeai-facegroup"${hidden}>${layerHtml(preset.browLayerId)}${layerHtml(preset.eyeLayerId)}${layerHtml(preset.mouthLayerId)}</div>`;
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
