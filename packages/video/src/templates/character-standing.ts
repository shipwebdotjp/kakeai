import { characterStandingV1, type ContentDocument } from "@kakeai/contracts";
import type { AssetResolver } from "../resolver";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlAttribute } from "../escape";
import { resolveCueMedia, type RenderedMedia } from "./shared";

export function renderCharacterStanding(
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
  const character = document.characters.find((entry) => entry.id === characterId);
  const appearance = character?.appearances.find((entry) => entry.id === appearanceId);
  if (appearance === undefined) {
    throw new CompositionCompileError([
      { path, code: "unknown_appearance", message: "立ち絵の参照を解決できません。" },
    ]);
  }
  const media = resolveCueMedia(appearance.assetId, assetResolver);
  const src = escapeHtmlAttribute(media.url);
  const widthPx = Math.round(480 * scale);
  return {
    html: `<img id="${mediaElementId}" class="kakeai-standing" src="${src}" style="left:${x * 100}%;top:${y * 100}%;width:${widthPx}px;" alt="">`,
    assetIds: [appearance.assetId],
  };
}
