import {
  characterStandingV1,
  characterStandingV2,
  type ContentDocument,
} from "@kakeai/contracts";
import type { AssetResolver } from "../resolver";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlAttribute } from "../escape";
import { resolveCueMedia, type RenderedMedia } from "./shared";

export const STANDING_LAYOUT = {
  left: { x: 0.27, y: 0.86 },
  right: { x: 0.73, y: 0.86 },
} as const;

const STANDING_BASE_WIDTH_PX = 480;

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

export function renderCharacterStandingV1(
  input: unknown,
  path: (string | number)[],
  document: ContentDocument,
  assetResolver: AssetResolver,
  mediaElementId: string,
): RenderedMedia {
  const parsed = characterStandingV1.inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path, code: "invalid_input", message: "character.standing の入力が不正です。" },
    ]);
  }
  const { characterId, appearanceId, x, y, scale } = parsed.data;
  const { src, assetId } = resolveStandingAppearance(
    characterId,
    appearanceId,
    document,
    path,
    assetResolver,
  );
  const widthPx = Math.round(STANDING_BASE_WIDTH_PX * scale);
  return {
    html: `<img id="${mediaElementId}" class="kakeai-standing" src="${src}" style="left:${x * 100}%;top:${y * 100}%;width:${widthPx}px;" alt="">`,
    assetIds: [assetId],
  };
}

export function renderCharacterStandingV2(
  input: unknown,
  path: (string | number)[],
  document: ContentDocument,
  assetResolver: AssetResolver,
  mediaElementId: string,
): RenderedMedia {
  const parsed = characterStandingV2.inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path, code: "invalid_input", message: "character.standing の入力が不正です。" },
    ]);
  }
  const { characterId, appearanceId, side, scale } = parsed.data;
  const { src, assetId } = resolveStandingAppearance(
    characterId,
    appearanceId,
    document,
    path,
    assetResolver,
  );
  const layout = STANDING_LAYOUT[side];
  const widthPx = Math.round(STANDING_BASE_WIDTH_PX * scale);
  return {
    html: `<div class="kakeai-standingv2" style="left:${layout.x * 100}%;top:${layout.y * 100}%;"><img id="${mediaElementId}" class="kakeai-standingimg" src="${src}" style="width:${widthPx}px;" alt=""></div>`,
    assetIds: [assetId],
  };
}
