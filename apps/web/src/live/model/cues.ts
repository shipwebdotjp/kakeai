import type {
  LiveProgramCue,
  LiveProgramDocument,
} from "@kakeai/contracts";
import { isCueSegment } from "./visual";

export const DEFAULT_CUE_CAPTION = "新しいキュー";
export const DEFAULT_CUE_SPEECH = "あたらしい きゅー";
export const DEFAULT_CUE_EXPRESSION = "normal";
export const LIVE_CUE_EXPRESSION_OPTIONS = [
  "normal",
  "smile",
  "surprised",
  "sad",
  "angry",
] as const;

export interface NewCueInput {
  id: string;
  speaker?: "left" | "right";
  caption?: string;
  speech?: string;
  expression?: string;
  audioAssetId?: string;
}

export function createCue(input: NewCueInput): LiveProgramCue {
  return {
    id: input.id,
    speaker: input.speaker ?? "left",
    caption: input.caption ?? DEFAULT_CUE_CAPTION,
    speech: input.speech ?? DEFAULT_CUE_SPEECH,
    expression: input.expression ?? DEFAULT_CUE_EXPRESSION,
    ...(input.audioAssetId === undefined ? {} : { audioAssetId: input.audioAssetId }),
  };
}

export type CueTextPatch = Partial<
  Pick<LiveProgramCue, "speaker" | "caption" | "speech" | "expression" | "audioAssetId">
>;

/**
 * Updates cue text/audio fields only. Visual inheritance is edited through
 * `setCueVisual` because `undefined` there means "inherit", not "leave alone".
 */
export function updateCue(
  document: LiveProgramDocument,
  cueId: string,
  patch: CueTextPatch,
): LiveProgramDocument {
  return {
    ...document,
    cues: document.cues.map((cue) => {
      if (cue.id !== cueId) {
        return cue;
      }
      const next: LiveProgramCue = { ...cue };
      if (patch.speaker !== undefined) {
        next.speaker = patch.speaker;
      }
      if (patch.caption !== undefined) {
        next.caption = patch.caption;
      }
      if (patch.speech !== undefined) {
        next.speech = patch.speech;
      }
      if (patch.expression !== undefined) {
        next.expression = patch.expression;
      }
      // Presence is the signal: text-only patches must keep an existing asset.
      if ("audioAssetId" in patch) {
        if (patch.audioAssetId === undefined) {
          delete next.audioAssetId;
        } else {
          next.audioAssetId = patch.audioAssetId;
        }
      }
      return next;
    }),
  };
}

/** Appends a cue to a cue segment. Returns the document unchanged for other kinds. */
export function addCueToSegment(
  document: LiveProgramDocument,
  segmentId: string,
  cue: LiveProgramCue,
  index?: number,
): LiveProgramDocument {
  const segment = document.segments.find((entry) => entry.id === segmentId);
  if (segment === undefined || !isCueSegment(segment)) {
    return document;
  }
  if (document.cues.some((entry) => entry.id === cue.id)) {
    return document;
  }
  const requested = index ?? segment.cues.length;
  const bounded = Math.min(Math.max(requested, 0), segment.cues.length);
  const cueIds = [...segment.cues.slice(0, bounded), cue.id, ...segment.cues.slice(bounded)];
  return {
    ...document,
    segments: document.segments.map((entry) =>
      entry.id === segmentId ? { ...segment, cues: cueIds } : entry,
    ),
    cues: [...document.cues, cue],
  };
}

export function removeCue(document: LiveProgramDocument, cueId: string): LiveProgramDocument {
  // The safety fallback must keep resolving; removing it here would leave a
  // dangling reference that the schema only reports after the damage is done.
  if (document.safety?.fallbackCueId === cueId) {
    return document;
  }
  return {
    ...document,
    segments: document.segments.map((segment) => {
      if (!isCueSegment(segment)) {
        return segment;
      }
      return { ...segment, cues: segment.cues.filter((id) => id !== cueId) };
    }),
    cues: document.cues.filter((cue) => cue.id !== cueId),
  };
}

export function moveCue(
  document: LiveProgramDocument,
  segmentId: string,
  cueId: string,
  direction: -1 | 1,
): LiveProgramDocument {
  const segment = document.segments.find((entry) => entry.id === segmentId);
  if (segment === undefined || !isCueSegment(segment)) {
    return document;
  }
  const index = segment.cues.indexOf(cueId);
  if (index === -1) {
    return document;
  }
  const target = index + direction;
  if (target < 0 || target >= segment.cues.length) {
    return document;
  }
  const cueIds = [...segment.cues];
  const current = cueIds[index]!;
  cueIds[index] = cueIds[target]!;
  cueIds[target] = current;
  return {
    ...document,
    segments: document.segments.map((entry) =>
      entry.id === segmentId ? { ...segment, cues: cueIds } : entry,
    ),
  };
}

export function findCue(
  document: LiveProgramDocument,
  cueId: string,
): LiveProgramCue | null {
  return document.cues.find((cue) => cue.id === cueId) ?? null;
}

export function findSegmentOfCue(
  document: LiveProgramDocument,
  cueId: string,
): LiveProgramDocument["segments"][number] | null {
  return (
    document.segments.find(
      (segment) => isCueSegment(segment) && segment.cues.includes(cueId),
    ) ?? null
  );
}

/** Cues that no segment owns, excluding the dedicated fallback cue. */
export function orphanCues(document: LiveProgramDocument): LiveProgramCue[] {
  const owned = new Set<string>();
  for (const segment of document.segments) {
    if (isCueSegment(segment)) {
      for (const cueId of segment.cues) {
        owned.add(cueId);
      }
    }
  }
  const fallbackCueId = document.safety?.fallbackCueId;
  return document.cues.filter((cue) => !owned.has(cue.id) && cue.id !== fallbackCueId);
}
