import { canonicalJson } from "./canonical-json.ts";
import { sha256Hex } from "./hash.ts";

interface FaceSetLayerHashInput {
  id: string;
  part: string;
  assetId: string;
  blinkLayerId: string | null;
  speakingLayerId: string | null;
  position: number;
}

interface FaceSetExpressionHashInput {
  id: string;
  name: string;
  browLayerId: string | null;
  eyeLayerId: string | null;
  mouthLayerId: string | null;
  position: number;
}

export interface FaceSetRevisionHashInput {
  faceSetId: string;
  versionNumber: number;
  layers: readonly FaceSetLayerHashInput[];
  expressions: readonly FaceSetExpressionHashInput[];
}

/**
 * Hashes the immutable part of a Face Set revision. Both version finalization
 * and export use this so a snapshot hash can be re-checked without trusting
 * mutable display fields.
 */
export function faceSetRevisionHash(faceSet: FaceSetRevisionHashInput): string {
  return sha256Hex(
    canonicalJson({
      id: faceSet.faceSetId,
      version: faceSet.versionNumber,
      layers: [...faceSet.layers]
        .sort(
          (left, right) =>
            left.position - right.position ||
            (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
        )
        .map((layer) => ({
          id: layer.id,
          part: layer.part,
          assetId: layer.assetId,
          blinkLayerId: layer.blinkLayerId,
          speakingLayerId: layer.speakingLayerId,
          position: layer.position,
        })),
      expressions: [...faceSet.expressions]
        .sort(
          (left, right) =>
            left.position - right.position ||
            (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
        )
        .map((expression) => ({
          id: expression.id,
          name: expression.name,
          browLayerId: expression.browLayerId,
          eyeLayerId: expression.eyeLayerId,
          mouthLayerId: expression.mouthLayerId,
          position: expression.position,
        })),
    }),
  );
}
