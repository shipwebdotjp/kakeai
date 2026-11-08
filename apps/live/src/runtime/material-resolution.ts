/**
 * Resolves the material shown for a cue. A cue override wins; an omitted value
 * inherits the containing segment's default, and null deliberately hides the
 * centre card. This is the only place the three-way rule is expressed.
 */
export function resolveCueMaterialId(
  segmentMaterial: string | undefined,
  cueMaterialId: string | null | undefined,
): string | null {
  if (cueMaterialId !== undefined) {
    return cueMaterialId;
  }
  return segmentMaterial ?? null;
}
