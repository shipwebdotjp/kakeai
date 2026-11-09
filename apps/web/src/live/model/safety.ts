import type { LiveProgramDocument, LiveSafety } from "@kakeai/contracts";

export function defaultLiveSafety(fallbackCueId: string): LiveSafety {
  return {
    blockedTopics: [],
    persona: "親しみやすい解説キャラクター。",
    maxResponseChars: 180,
    maxResponseCues: 2,
    fallbackCueId,
  };
}

/**
 * Applies a partial safety update to the document's current safety value. The
 * caller must pass the updater's `document`, not a render-time snapshot.
 */
export function withSafetyPatch(
  document: LiveProgramDocument,
  patch: Partial<LiveSafety>,
  fallbackCueId: string,
): LiveProgramDocument {
  const current = document.safety ?? defaultLiveSafety(fallbackCueId);
  return { ...document, safety: { ...current, ...patch } };
}
