import { NORMAL_EXPRESSION_ID } from "@kakeai/contracts";
import type {
  LiveCharacter,
  LiveCharacterAppearance,
  LiveCharacterSheet,
  LiveFaceSet,
  LiveFaceSetLayer,
  LiveSide,
} from "@kakeai/contracts";

export interface FaceExpressionLayers {
  brow: LiveFaceSetLayer | null;
  eye: LiveFaceSetLayer | null;
  mouth: LiveFaceSetLayer | null;
}

export interface CharacterFaceSelection {
  character: LiveCharacter;
  appearance: LiveCharacterAppearance;
  faceSet: LiveFaceSet | null;
  layers: FaceExpressionLayers;
}

const EMPTY_LAYERS: FaceExpressionLayers = Object.freeze({
  brow: null,
  eye: null,
  mouth: null,
});

/**
 * Picks the appearance for a stage expression. An unknown expression reuses
 * `normal`, which every character is guaranteed to have by the sheet schema.
 */
export function pickAppearance(
  character: LiveCharacter,
  expression: string,
): LiveCharacterAppearance {
  return (
    character.appearances.find((appearance) => appearance.expression === expression) ??
    character.appearances.find(
      (appearance) => appearance.expression === NORMAL_EXPRESSION_ID,
    ) ??
    character.appearances[0]!
  );
}

/** Resolves the pinned Face Set revision referenced by an appearance. */
export function pickFaceSet(
  sheet: LiveCharacterSheet,
  appearance: LiveCharacterAppearance,
): LiveFaceSet | null {
  if (appearance.faceSetId === null) {
    return null;
  }
  const version = appearance.faceSetVersion ?? 1;
  return (
    sheet.faceSets.find(
      (faceSet) => faceSet.id === appearance.faceSetId && faceSet.version === version,
    ) ?? null
  );
}

/**
 * Maps an Expression Preset's brow/eye/mouth layer ids onto the Face Set's
 * package layers. Unknown expressions fall back to `normal`.
 */
export function pickExpressionLayers(
  faceSet: LiveFaceSet | null,
  expression: string,
): FaceExpressionLayers {
  if (faceSet === null) {
    return EMPTY_LAYERS;
  }
  const preset =
    faceSet.expressions.find((entry) => entry.id === expression) ??
    faceSet.expressions.find((entry) => entry.id === NORMAL_EXPRESSION_ID) ??
    null;
  if (preset === null) {
    return EMPTY_LAYERS;
  }
  const layerById = new Map(faceSet.layers.map((layer) => [layer.id, layer]));
  return {
    brow: preset.browLayerId === null ? null : (layerById.get(preset.browLayerId) ?? null),
    eye: preset.eyeLayerId === null ? null : (layerById.get(preset.eyeLayerId) ?? null),
    mouth: preset.mouthLayerId === null ? null : (layerById.get(preset.mouthLayerId) ?? null),
  };
}

export function findCharacter(
  sheet: LiveCharacterSheet,
  side: LiveSide,
): LiveCharacter | null {
  return sheet.characters.find((character) => character.side === side) ?? null;
}

/** Full stage-side selection for one character and expression. */
export function selectCharacterFace(
  sheet: LiveCharacterSheet,
  side: LiveSide,
  expression: string,
): CharacterFaceSelection | null {
  const character = findCharacter(sheet, side);
  if (character === null) {
    return null;
  }
  const appearance = pickAppearance(character, expression);
  const faceSet = pickFaceSet(sheet, appearance);
  return {
    character,
    appearance,
    faceSet,
    layers: pickExpressionLayers(faceSet, expression),
  };
}
