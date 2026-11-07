import type { LiveCue } from "@kakeai/contracts";

export interface DiscardResult {
  removed: LiveCue[];
  index: number;
  currentRemoved: boolean;
}

export interface RemoveResult {
  found: boolean;
  removed: boolean;
  index: number;
  currentRemoved: boolean;
}

export interface MoveResult {
  moved: boolean;
  index: number;
}

/**
 * Inserts after the current cue, or at the end when the queue has not started.
 * `index === cues.length` is the explicit "queue finished" cursor, so the
 * insertion point is clamped instead of growing past the end.
 */
export function insertAfterCurrent(
  cues: LiveCue[],
  index: number,
  inserts: LiveCue[],
): void {
  if (inserts.length === 0) {
    return;
  }
  const at = index < 0 ? cues.length : Math.min(index + 1, cues.length);
  cues.splice(at, 0, ...inserts);
}

/** Removes generated/manual cues while preserving the cursor position. */
export function discardGenerated(cues: LiveCue[], index: number): DiscardResult {
  const removed: LiveCue[] = [];
  let newIndex = index;
  let currentRemoved = false;
  const kept: LiveCue[] = [];
  for (let position = 0; position < cues.length; position += 1) {
    const cue = cues[position];
    if (cue === undefined) {
      continue;
    }
    if (cue.source === "generated" || cue.source === "manual") {
      removed.push(cue);
      if (position < index) {
        newIndex -= 1;
      } else if (position === index) {
        currentRemoved = true;
      }
      continue;
    }
    kept.push(cue);
  }
  if (removed.length === 0) {
    return { removed, index, currentRemoved: false };
  }
  cues.splice(0, cues.length, ...kept);
  // `cues.length` is the valid "one past the last cue" finished cursor.
  return {
    removed,
    index: index < 0 ? -1 : Math.min(newIndex, cues.length),
    currentRemoved,
  };
}

export function removeCueFromQueue(
  cues: LiveCue[],
  index: number,
  cueId: string,
): RemoveResult {
  const position = cues.findIndex((cue) => cue.id === cueId);
  if (position < 0) {
    return { found: false, removed: false, index, currentRemoved: false };
  }
  const cue = cues[position];
  if (cue === undefined || cue.status === "playing") {
    return { found: true, removed: false, index, currentRemoved: false };
  }
  cues.splice(position, 1);
  if (position < index) {
    return { found: true, removed: true, index: index - 1, currentRemoved: false };
  }
  return {
    found: true,
    removed: true,
    index,
    currentRemoved: position === index,
  };
}

export function moveCueInQueue(
  cues: LiveCue[],
  index: number,
  cueId: string,
  beforeCueId: string | null,
): MoveResult {
  const from = cues.findIndex((cue) => cue.id === cueId);
  if (from < 0 || beforeCueId === cueId) {
    return { moved: false, index };
  }
  const to = beforeCueId === null ? cues.length : cues.findIndex((cue) => cue.id === beforeCueId);
  if (to < 0) {
    return { moved: false, index };
  }
  const currentId = cues[index]?.id ?? null;
  const [cue] = cues.splice(from, 1);
  if (cue === undefined) {
    return { moved: false, index };
  }
  const insertAt = from < to ? to - 1 : to;
  cues.splice(insertAt, 0, cue);
  if (currentId === null) {
    return { moved: true, index };
  }
  return {
    moved: true,
    index: cues.findIndex((entry) => entry.id === currentId),
  };
}
