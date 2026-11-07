import type { LiveCue, LivePackageShow, LivePreloadCue, StagePhase } from "@kakeai/contracts";
import type { RunLogEventInput } from "../runs/run-store.ts";
import type { SegmentBufferEstimate } from "./buffer.ts";
import type { Playout } from "./playout.ts";
import type { CueQueueStore } from "./queue.ts";

export type LiveCuePatch = Partial<
  Pick<LiveCue, "caption" | "speech" | "expression" | "audio" | "durationMs" | "status">
>;

/** Playout owns these transitions; the operator/TTS may only set preparatory states. */
const PLAYOUT_OWNED_STATUSES: ReadonlySet<LiveCue["status"]> = new Set([
  "playing",
  "done",
  "skipped",
]);

export interface CueControlHost {
  readonly show: LivePackageShow;
  readonly queues: CueQueueStore;
  readonly playout: Playout;
  phase(): StagePhase;
  currentSegmentIndex(): number | null;
  log(input: RunLogEventInput): void;
  publish(): void;
  publishPreload(): void;
}

/** P4/P5-facing cue edits, kept separate from command and phase handling. */
export class CueControl {
  constructor(private readonly host: CueControlHost) {}

  getPreloadCues(): LivePreloadCue[] {
    return this.host.playout.getPreloadCues();
  }

  getBufferEstimate(): SegmentBufferEstimate {
    return this.host.playout.getBufferEstimate(
      this.host.queues.find(this.host.show.safety.fallbackCueId) !== null,
    );
  }

  enqueueGeneratedCues(cues: LiveCue[]): void {
    if (this.host.currentSegmentIndex() === null || cues.length === 0) {
      return;
    }
    const existingIds = new Set(this.host.queues.flatten().map((cue) => cue.id));
    const fresh: LiveCue[] = [];
    for (const cue of cues) {
      if (existingIds.has(cue.id)) {
        continue;
      }
      existingIds.add(cue.id);
      fresh.push(cue);
    }
    if (fresh.length === 0) {
      return;
    }
    this.host.playout.insertAfterCurrent(fresh);
    for (const cue of fresh) {
      this.host.log({
        type: "cue_generated",
        cueId: cue.id,
        commentId: cue.commentId,
        data: { source: cue.source, status: cue.status },
      });
    }
    this.host.publishPreload();
    this.host.publish();
  }

  updateCue(cueId: string, patch: LiveCuePatch): boolean {
    const entry = this.host.queues.find(cueId);
    // Terminal cues are immutable; `failed` may be set while a cue is still
    // preparing (TTS failure), but once playout has ended it, it stays ended.
    if (entry === null || !["draft", "preparing", "ready"].includes(entry.cue.status)) {
      return false;
    }
    if (patch.status !== undefined && PLAYOUT_OWNED_STATUSES.has(patch.status)) {
      return false;
    }
    const cue = entry.cue;
    if (patch.caption !== undefined) cue.caption = patch.caption;
    if (patch.speech !== undefined) cue.speech = patch.speech;
    if (patch.expression !== undefined) cue.expression = patch.expression;
    if (patch.audio !== undefined) cue.audio = patch.audio;
    if (patch.durationMs !== undefined) cue.durationMs = patch.durationMs;
    if (patch.status !== undefined) cue.status = patch.status;
    this.host.log({
      type: "cue_edited",
      cueId,
      data: { fields: Object.keys(patch).sort() },
    });
    this.host.publishPreload();
    this.host.publish();
    return true;
  }

  removeCue(cueId: string): boolean {
    const entry = this.host.queues.find(cueId);
    if (entry === null) {
      return false;
    }
    if (!["draft", "preparing", "ready"].includes(entry.cue.status)) {
      return false;
    }
    const removed =
      this.host.currentSegmentIndex() === entry.segmentIndex
        ? this.host.playout.removeCue(cueId)
        : this.host.queues.remove(cueId) !== null;
    if (!removed) {
      return false;
    }
    this.host.log({ type: "cue_deleted", cueId, data: { reason: "operator" } });
    this.host.publishPreload();
    this.host.publish();
    return true;
  }

  moveCue(cueId: string, beforeCueId: string | null): boolean {
    const entry = this.host.queues.find(cueId);
    // Reordering is limited to settled cues. Deletion is also allowed while
    // preparing, but moving a cue that is still being fitted has no use.
    if (
      entry === null ||
      beforeCueId === cueId ||
      !["draft", "ready"].includes(entry.cue.status)
    ) {
      return false;
    }
    if (beforeCueId !== null) {
      const target = this.host.queues.find(beforeCueId);
      if (
        target === null ||
        target.segmentIndex !== entry.segmentIndex ||
        !["draft", "ready"].includes(target.cue.status)
      ) {
        return false;
      }
    }
    const moved =
      this.host.currentSegmentIndex() === entry.segmentIndex
        ? this.host.playout.moveCue(cueId, beforeCueId)
        : this.host.queues.move(cueId, beforeCueId);
    if (!moved) {
      return false;
    }
    this.host.log({
      type: "cue_edited",
      cueId,
      data: { movedBefore: beforeCueId },
    });
    this.host.publishPreload();
    this.host.publish();
    return true;
  }

  getCue(cueId: string): LiveCue | null {
    const entry = this.host.queues.find(cueId);
    return entry === null ? null : { ...entry.cue };
  }

  getUpcomingCues(limit: number): LiveCue[] {
    if (!Number.isFinite(limit) || limit <= 0) {
      return [];
    }
    if (this.host.phase() === "post_show" || this.host.phase() === "error") {
      return [];
    }
    const flat = this.host.queues.flatten();
    const currentId = this.host.playout.current?.id ?? null;
    const currentPosition =
      currentId === null ? -1 : flat.findIndex((cue) => cue.id === currentId);
    if (currentId !== null && currentPosition < 0) {
      return [];
    }
    return flat
      .slice(currentPosition + 1)
      .filter(
        (cue) => cue.status !== "done" && cue.status !== "skipped" && cue.status !== "failed",
      )
      .slice(0, Math.floor(limit))
      .map((cue) => ({ ...cue }));
  }
}
