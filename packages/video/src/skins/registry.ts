import type { VisualSkinRef } from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import { handmadePaperSkin } from "./handmade-paper";
import { neutralVisualSkin } from "./neutral";
import type { ResolvedVisualSkin } from "./types";

function skinRefKey(ref: VisualSkinRef): string {
  return `${ref.id}@${ref.version}`;
}

export const visualSkinRendererRegistry: ReadonlyMap<string, ResolvedVisualSkin> = new Map([
  [skinRefKey(neutralVisualSkin.ref), neutralVisualSkin],
  [skinRefKey(handmadePaperSkin.ref), handmadePaperSkin],
]);

export function getResolvedVisualSkin(ref: VisualSkinRef): ResolvedVisualSkin | undefined {
  return visualSkinRendererRegistry.get(skinRefKey(ref));
}

export function resolveVisualSkin(ref: VisualSkinRef): ResolvedVisualSkin {
  const skin = getResolvedVisualSkin(ref);
  if (skin === undefined) {
    throw new CompositionCompileError([
      {
        path: ["skin"],
        code: "unknown_skin",
        message: `未対応のVisual Skinです: ${skinRefKey(ref)}`,
      },
    ]);
  }
  return skin;
}

export function listResolvedVisualSkins(): ResolvedVisualSkin[] {
  return [...visualSkinRendererRegistry.values()];
}
