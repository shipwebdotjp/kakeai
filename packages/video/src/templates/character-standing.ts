import {
  characterStandingV1InputSchema,
  characterStandingV2InputSchema,
  type ContentDocument,
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
