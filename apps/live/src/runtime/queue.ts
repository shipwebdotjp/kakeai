import type { LiveCue, LivePackageShow } from "@kakeai/contracts";

export interface CueEntry {
  cue: LiveCue;
  segmentIndex: number;
}

/**
 * Owns the per-segment cue arrays. Arrays are mutated in place because the
 * playout holds the current segment's array by reference; replacing the array
 * would detach the playout cursor.
 */
export class CueQueueStore {
  private readonly queues = new Map<number, LiveCue[]>();
  private readonly segmentIndexes: number[];

  constructor(show: LivePackageShow) {
    const cueById = new Map(show.cues.map((cue) => [cue.id, cue]));
    show.segments.forEach((segment, segmentIndex) => {
      if (!("cues" in segment)) {
        return;
      }
      const cues: LiveCue[] = [];
      for (const cueId of segment.cues) {
        const prepared = cueById.get(cueId);
        if (prepared === undefined) {
          continue;
        }
        cues.push({
          ...prepared,
          source: "prepared",
          status: "ready",
          commentId: null,
        });
      }
      this.queues.set(segmentIndex, cues);
    });
    this.segmentIndexes = [...this.queues.keys()].sort((a, b) => a - b);
  }

  forSegment(segmentIndex: number | null): LiveCue[] | null {
    if (segmentIndex === null) {
      return null;
    }
    return this.queues.get(segmentIndex) ?? null;
  }

  /** Cues from segments after `segmentIndex`, in spine order. */
  afterSegment(segmentIndex: number | null): LiveCue[] {
    const result: LiveCue[] = [];
    if (segmentIndex === null) {
      return result;
    }
    for (const index of this.segmentIndexes) {
      if (index > segmentIndex) {
        result.push(...(this.queues.get(index) ?? []));
      }
    }
    return result;
  }

  flatten(): LiveCue[] {
    return this.segmentIndexes.flatMap((index) => this.queues.get(index) ?? []);
  }

  find(cueId: string): CueEntry | null {
    for (const segmentIndex of this.segmentIndexes) {
      const cues = this.queues.get(segmentIndex) ?? [];
      const cue = cues.find((entry) => entry.id === cueId);
      if (cue !== undefined) {
        return { cue, segmentIndex };
      }
    }
    return null;
  }

  remove(cueId: string): LiveCue | null {
    for (const cues of this.queues.values()) {
      const index = cues.findIndex((cue) => cue.id === cueId);
      if (index >= 0) {
        const [removed] = cues.splice(index, 1);
        return removed ?? null;
      }
    }
    return null;
  }

  removeWhere(predicate: (cue: LiveCue) => boolean): LiveCue[] {
    const removed: LiveCue[] = [];
    for (const cues of this.queues.values()) {
      const kept: LiveCue[] = [];
      for (const cue of cues) {
        if (predicate(cue)) {
          removed.push(cue);
        } else {
          kept.push(cue);
        }
      }
      cues.splice(0, cues.length, ...kept);
    }
    return removed;
  }

  move(cueId: string, beforeCueId: string | null): boolean {
    for (const cues of this.queues.values()) {
      const from = cues.findIndex((cue) => cue.id === cueId);
      if (from < 0) {
        continue;
      }
      const to = beforeCueId === null ? cues.length : cues.findIndex((cue) => cue.id === beforeCueId);
      if (to < 0) {
        return false;
      }
      const [cue] = cues.splice(from, 1);
      if (cue === undefined) {
        return false;
      }
      const insertAt = from < to ? to - 1 : to;
      cues.splice(insertAt, 0, cue);
      return true;
    }
    return false;
  }
}
