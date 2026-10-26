import {
  applyToDocument,
  buildStructuralDocument,
  buildStructuralOrNull,
  emptyResult,
  hasValidTransferTargets,
  removeCueFromValues,
  type StructuralAsset,
  type StructuralEditResult,
} from "./common";
import type { ContentDocument } from "@kakeai/contracts";
import { type DocumentFormValues } from "../form";

export function removeCueStructural(
  base: ContentDocument,
  values: DocumentFormValues,
  sceneId: string,
  cueId: string,
  assets: readonly StructuralAsset[] = [],
): StructuralEditResult | null {
  let document: ContentDocument;
  try {
    document = buildStructuralDocument(base, values);
  } catch (error) {
    const withoutCue = removeCueFromValues(values, sceneId, cueId);
    try {
      const fallbackDocument = buildStructuralDocument(base, withoutCue);
      return {
        values: withoutCue,
        document: fallbackDocument,
        result: emptyResult(fallbackDocument),
      };
    } catch {
      throw error;
    }
  }
  const scene = document.scenes.find((entry) => entry.id === sceneId);
  if (scene === undefined) {
    return null;
  }
  if (!scene.visualCues.some((cue) => cue.id === cueId)) {
    // 未確定Cueは正本文書に存在しないため、フォームからのみ除去する。
    return {
      values: removeCueFromValues(values, sceneId, cueId),
      document,
      result: emptyResult(document),
    };
  }
  return applyToDocument(
    document,
    values,
    [{ op: "cue.remove", sceneId, cueId }],
    assets,
  );
}

export function moveCueStructural(
  base: ContentDocument,
  values: DocumentFormValues,
  sceneId: string,
  cueId: string,
  toSceneId: string,
  assets: readonly StructuralAsset[] = [],
): StructuralEditResult | null {
  if (sceneId === toSceneId) {
    return null;
  }
  const document = buildStructuralOrNull(base, values);
  if (document === null) {
    return null;
  }
  const source = document.scenes.find((entry) => entry.id === sceneId);
  if (
    source === undefined ||
    !document.scenes.some((entry) => entry.id === toSceneId) ||
    !source.visualCues.some((cue) => cue.id === cueId)
  ) {
    return null;
  }
  return applyToDocument(
    document,
    values,
    [{ op: "cue.move", sceneId, cueId, toSceneId }],
    assets,
  );
}

export function copyCueStructural(
  base: ContentDocument,
  values: DocumentFormValues,
  sceneId: string,
  cueId: string,
  toSceneIds: readonly string[],
  assets: readonly StructuralAsset[] = [],
): StructuralEditResult | null {
  const document = buildStructuralOrNull(base, values);
  if (document === null) {
    return null;
  }
  const scene = document.scenes.find((entry) => entry.id === sceneId);
  if (scene === undefined) {
    return null;
  }
  if (!scene.visualCues.some((cue) => cue.id === cueId)) {
    return null;
  }
  if (!hasValidTransferTargets(document, sceneId, toSceneIds)) {
    return null;
  }
  return applyToDocument(
    document,
    values,
    [{ op: "cue.copy", sceneId, cueId, toSceneIds: [...toSceneIds] }],
    assets,
  );
}
