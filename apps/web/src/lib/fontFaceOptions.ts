import type { FontFace } from "@kakeai/contracts";

/** Upper bound on the options rendered for the "指定 Font Face" selector. */
export const FONT_FACE_OPTION_LIMIT = 50;

export function matchesFontFaceQuery(face: FontFace, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) {
    return true;
  }
  return (
    face.family.toLowerCase().includes(normalized) ||
    face.displayName.toLowerCase().includes(normalized) ||
    face.postScriptName.toLowerCase().includes(normalized)
  );
}

/**
 * Faces offered by the "指定 Font Face" selector. A face is identified by its
 * PostScript name, because several faces of one family share a family name and
 * the selector must not collapse them into a single option. The selected face
 * is always kept in the list so the selector cannot silently display a
 * different face when the search text or the option limit would hide it.
 */
export function selectableFontFaces(
  faces: readonly FontFace[],
  query: string,
  selectedPostScriptName: string | undefined,
  limit: number = FONT_FACE_OPTION_LIMIT,
): FontFace[] {
  const matched = faces.filter((face) => matchesFontFaceQuery(face, query)).slice(0, limit);
  return includeFontFace(matched, faces, selectedPostScriptName);
}

/**
 * Keeps `selectedPostScriptName` selectable in an already filtered option
 * list, so a `<select>` value always matches one of its options.
 */
export function includeFontFace(
  options: readonly FontFace[],
  faces: readonly FontFace[],
  selectedPostScriptName: string | undefined,
): FontFace[] {
  if (selectedPostScriptName === undefined || selectedPostScriptName.length === 0) {
    return [...options];
  }
  if (options.some((face) => face.postScriptName === selectedPostScriptName)) {
    return [...options];
  }
  const selected = faces.find((face) => face.postScriptName === selectedPostScriptName);
  return selected === undefined ? [...options] : [selected, ...options];
}
