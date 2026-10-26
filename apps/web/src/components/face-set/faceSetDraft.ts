import type { FaceSet } from "@kakeai/contracts";

interface DraftLayer {
  id: string;
  part: string;
  assetId: string | null;
  blinkLayerId: string | null;
  speakingLayerId: string | null;
}

interface DraftExpression {
  id: string;
  name: string;
  browLayerId: string | null;
  eyeLayerId: string | null;
  mouthLayerId: string | null;
}

/**
 * Whether saving the draft would create a new revision. A name-only change
 * keeps the version, so the editor can label the button accurately.
 */
export function faceSetContentChanged(
  entry: FaceSet,
  draft: { layers: readonly DraftLayer[]; expressions: readonly DraftExpression[] },
): boolean {
  if (entry.layers.length !== draft.layers.length) {
    return true;
  }
  if (
    entry.layers.some((layer, index) => {
      const next = draft.layers[index];
      return (
        next === undefined ||
        layer.id !== next.id ||
        layer.part !== next.part ||
        layer.assetId !== next.assetId ||
        layer.blinkLayerId !== next.blinkLayerId ||
        layer.speakingLayerId !== next.speakingLayerId
      );
    })
  ) {
    return true;
  }
  if (entry.expressions.length !== draft.expressions.length) {
    return true;
  }
  return entry.expressions.some((preset, index) => {
    const next = draft.expressions[index];
    return (
      next === undefined ||
      preset.id !== next.id ||
      preset.name !== next.name ||
      preset.browLayerId !== next.browLayerId ||
      preset.eyeLayerId !== next.eyeLayerId ||
      preset.mouthLayerId !== next.mouthLayerId
    );
  });
}
