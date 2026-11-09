import type {
  LiveProgramCommentSegment,
  LiveProgramCue,
  LiveProgramCueSegment,
  LiveProgramDocument,
  LiveProgramSegment,
  LiveProgramCutInSegment,
  LiveCommentPolicy,
  LiveVisualRef,
} from "@kakeai/contracts";

export type LiveProgramCueSegmentKind = LiveProgramCueSegment["kind"];

export const DEFAULT_SCRIPT_SEGMENT_DURATION_MS = 300_000;
export const DEFAULT_CUT_IN_LABEL = "CutIn";
export const DEFAULT_SCRIPT_SEGMENT_LABEL = "新しいセグメント";

export interface NewCueSegmentInput {
  id: string;
  label?: string;
  targetDurationMs?: number;
  kind: LiveProgramCueSegmentKind;
}

export function createCueSegment(input: NewCueSegmentInput): LiveProgramCueSegment {
  return {
    id: input.id,
    kind: input.kind,
    label: input.label ?? DEFAULT_SCRIPT_SEGMENT_LABEL,
    targetDurationMs: input.targetDurationMs ?? DEFAULT_SCRIPT_SEGMENT_DURATION_MS,
    cues: [],
  };
}

export function createCommentSegment(input: {
  id: string;
  label?: string;
  targetDurationMs?: number;
  commentPolicy?: Partial<LiveCommentPolicy>;
}): LiveProgramCommentSegment {
  return {
    id: input.id,
    kind: "comment",
    label: input.label ?? "コメント",
    targetDurationMs: input.targetDurationMs ?? 300_000,
    ...(input.commentPolicy === undefined ? {} : { commentPolicy: input.commentPolicy }),
  };
}

export function createCutInSegment(input: {
  id: string;
  label?: string;
  cutInId: string;
}): LiveProgramCutInSegment {
  return {
    id: input.id,
    kind: "cut_in",
    label: input.label ?? DEFAULT_CUT_IN_LABEL,
    cutInId: input.cutInId,
  };
}

/** Inserts a segment before closing, or at an explicit index inside the spine. */
export function insertSegment(
  document: LiveProgramDocument,
  segment: LiveProgramSegment,
  index?: number,
): LiveProgramDocument {
  if (document.segments.some((entry) => entry.id === segment.id)) {
    return document;
  }
  const closingIndex = document.segments.findIndex((entry) => entry.kind === "closing");
  const fallbackIndex = closingIndex === -1 ? document.segments.length : closingIndex;
  // Index 0 is valid even when other segments exist: a draft missing its
  // opening can only be repaired by inserting one at the front.
  const minimum = 0;
  const maximum = Math.max(minimum, fallbackIndex);
  if (index !== undefined && (index < minimum || index > maximum)) {
    return document;
  }
  const bounded = index ?? maximum;
  const segments = [
    ...document.segments.slice(0, bounded),
    segment,
    ...document.segments.slice(bounded),
  ];
  return { ...document, segments };
}

export function addScriptSegment(
  document: LiveProgramDocument,
  input: { id: string; label?: string; targetDurationMs?: number; index?: number },
): LiveProgramDocument {
  return insertSegment(
    document,
    createCueSegment({ ...input, kind: "script" }),
    input.index,
  );
}

export function addCommentSegment(
  document: LiveProgramDocument,
  input: { id: string; label?: string; targetDurationMs?: number; index?: number },
): LiveProgramDocument {
  return insertSegment(
    document,
    createCommentSegment(input),
    input.index,
  );
}

export function addCutInSegment(
  document: LiveProgramDocument,
  input: { id: string; label?: string; cutInId: string; index?: number },
): LiveProgramDocument {
  return insertSegment(document, createCutInSegment(input), input.index);
}

/**
 * Removes a segment and every cue owned by it. A fallback cue never belongs to
 * a segment; if safety still points at a removed cue the validator surfaces it.
 */
export function removeSegment(
  document: LiveProgramDocument,
  segmentId: string,
): LiveProgramDocument {
  const target = document.segments.find((segment) => segment.id === segmentId);
  if (target === undefined) {
    return document;
  }
  const removedCueIds = new Set(
    target.kind === "opening" || target.kind === "script" || target.kind === "closing"
      ? target.cues
      : [],
  );
  // A dedicated fallback cue may have been (incorrectly) placed in a segment.
  // Keep it as an orphan so safety.fallbackCueId does not become dangling.
  if (document.safety !== undefined) {
    removedCueIds.delete(document.safety.fallbackCueId);
  }
  return {
    ...document,
    segments: document.segments.filter((segment) => segment.id !== segmentId),
    cues: document.cues.filter((cue) => !removedCueIds.has(cue.id)),
  };
}

/**
 * Swaps adjacent segments. The UI disables moving opening/closing; this helper
 * only performs the requested index swap so validation reports illegal shapes.
 */
export function moveSegment(
  document: LiveProgramDocument,
  segmentId: string,
  direction: -1 | 1,
): LiveProgramDocument {
  const index = document.segments.findIndex((segment) => segment.id === segmentId);
  if (index === -1) {
    return document;
  }
  const target = index + direction;
  if (target < 0 || target >= document.segments.length) {
    return document;
  }
  const segments = [...document.segments];
  const current = segments[index]!;
  segments[index] = segments[target]!;
  segments[target] = current;
  return { ...document, segments };
}

export type CueSegmentPatch = {
  label?: string;
  targetDurationMs?: number;
  commentPolicy?: Partial<LiveCommentPolicy>;
  visual?: LiveVisualRef;
  cutInId?: string;
};

/**
 * Applies only the fields valid for the segment kind. `visual: undefined`
 * removes the field, while an object sets it. CutIn segments carry no visual.
 */
export function patchSegment(
  document: LiveProgramDocument,
  segmentId: string,
  patch: CueSegmentPatch,
): LiveProgramDocument {
  return {
    ...document,
    segments: document.segments.map((segment) => {
      if (segment.id !== segmentId) {
        return segment;
      }
      const base = {
        ...(patch.label === undefined ? {} : { label: patch.label }),
        ...(patch.targetDurationMs === undefined
          ? {}
          : { targetDurationMs: patch.targetDurationMs }),
      };
      if (segment.kind === "cut_in") {
        return {
          ...segment,
          ...(patch.label === undefined ? {} : { label: patch.label }),
          ...(patch.cutInId === undefined ? {} : { cutInId: patch.cutInId }),
        };
      }
      if (segment.kind === "comment") {
        const next: LiveProgramCommentSegment = {
          ...segment,
          ...base,
          ...(patch.commentPolicy === undefined
            ? {}
            : { commentPolicy: patch.commentPolicy }),
        };
        if (!("visual" in patch)) {
          return next;
        }
        if (patch.visual === undefined) {
          const { visual: _removed, ...rest } = next;
          return rest;
        }
        return { ...next, visual: patch.visual };
      }
      const next: LiveProgramCueSegment = { ...segment, ...base };
      if (!("visual" in patch)) {
        return next;
      }
      if (patch.visual === undefined) {
        const { visual: _removed, ...rest } = next;
        return rest;
      }
      return { ...next, visual: patch.visual };
    }),
  };
}

export function cueSegment(document: LiveProgramDocument, segmentId: string): LiveProgramCueSegment | null {
  const segment = document.segments.find((entry) => entry.id === segmentId);
  if (segment === undefined) {
    return null;
  }
  if (segment.kind === "opening" || segment.kind === "script" || segment.kind === "closing") {
    return segment;
  }
  return null;
}

export function cuesOfSegment(
  document: LiveProgramDocument,
  segment: LiveProgramCueSegment,
): LiveProgramCue[] {
  const byId = new Map(document.cues.map((cue) => [cue.id, cue]));
  return segment.cues.flatMap((cueId) => {
    const cue = byId.get(cueId);
    return cue === undefined ? [] : [cue];
  });
}
