import type { LiveProgramCutIn, LiveProgramDocument } from "@kakeai/contracts";

export function addCutIn(
  document: LiveProgramDocument,
  cutIn: LiveProgramCutIn,
): LiveProgramDocument {
  if (document.cutIns.some((entry) => entry.id === cutIn.id)) {
    return document;
  }
  return { ...document, cutIns: [...document.cutIns, cutIn] };
}

export function cutInUsageCount(document: LiveProgramDocument, cutInId: string): number {
  return document.segments.filter(
    (segment) => segment.kind === "cut_in" && segment.cutInId === cutInId,
  ).length;
}

/** Removes an unreferenced CutIn. Referenced CutIns must keep their segment valid. */
export function removeCutIn(
  document: LiveProgramDocument,
  cutInId: string,
): LiveProgramDocument {
  if (cutInUsageCount(document, cutInId) > 0) {
    return document;
  }
  return {
    ...document,
    cutIns: document.cutIns.filter((entry) => entry.id !== cutInId),
  };
}
