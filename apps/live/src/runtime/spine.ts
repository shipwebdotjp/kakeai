import type { LivePackageShow, LiveSegment, StagePhase } from "@kakeai/contracts";
import type { Playout } from "./playout.ts";
import type { CueQueueStore } from "./queue.ts";
import { phaseForSegment, shouldStartCommentCorner } from "./segments.ts";

export interface SpineHost {
  readonly show: LivePackageShow;
  readonly queues: CueQueueStore;
  readonly playout: Playout;
  phase(): StagePhase;
  currentSegmentIndex(): number | null;
  currentSegment(): LiveSegment | null;
  setCurrentSegmentIndex(index: number | null): void;
  setPhase(phase: StagePhase): void;
  isSafeMode(): boolean;
  isEndRequested(): boolean;
  clearEndRequested(): void;
  remainingMs(): number;
  enterPostShow(): void;
  hasCommentCorner(): boolean;
  startCommentCorner(segment: Extract<LiveSegment, { kind: "comment" }>): void;
}

/** Walks the spine: segments, comment-corner boundaries and closing. */
export class Spine {
  constructor(private readonly host: SpineHost) {}

  enterSegment(startIndex: number): void {
    for (let index = startIndex; index < this.host.show.segments.length; index += 1) {
      const segment = this.host.show.segments[index];
      if (segment === undefined) {
        continue;
      }
      if (segment.kind === "comment") {
        if (this.host.isSafeMode()) {
          continue;
        }
        if (
          !shouldStartCommentCorner(
            this.host.remainingMs(),
            this.host.show.playout.closingReserveMs,
          )
        ) {
          this.enterClosing();
          return;
        }
        if (!this.host.hasCommentCorner()) {
          continue;
        }
        // The corner owns its comments and calls `finishCorner` when done; it
        // may finish synchronously when there are no comments.
        this.host.setCurrentSegmentIndex(index);
        this.host.setPhase("comment");
        this.host.startCommentCorner(segment);
        return;
      }
      const cues = this.host.queues.forSegment(index);
      if (cues === null || cues.length === 0) {
        continue;
      }
      this.host.setCurrentSegmentIndex(index);
      this.host.setPhase(
        this.host.isSafeMode() ? "safe_mode" : phaseForSegment(segment),
      );
      this.host.playout.setQueue(cues);
      this.host.playout.start();
      return;
    }
    this.host.enterPostShow();
  }

  enterClosing(): void {
    const index = this.host.show.segments.findIndex((segment) => segment.kind === "closing");
    if (index === -1) {
      this.host.enterPostShow();
      return;
    }
    const segment = this.host.show.segments[index];
    const cues = this.host.queues.forSegment(index);
    if (segment === undefined || cues === null || cues.length === 0) {
      this.host.enterPostShow();
      return;
    }
    this.host.clearEndRequested();
    this.host.setCurrentSegmentIndex(index);
    this.host.setPhase(this.host.isSafeMode() ? "safe_mode" : "closing");
    this.host.playout.setQueue(cues);
    this.host.playout.start();
  }

  handleQueueFinished(): void {
    if (this.host.phase() === "post_show") {
      return;
    }
    const segment = this.host.currentSegment();
    if (segment?.kind === "closing") {
      this.host.enterPostShow();
      return;
    }
    if (this.host.isEndRequested()) {
      this.host.clearEndRequested();
      this.enterClosing();
      return;
    }
    this.enterSegment((this.host.currentSegmentIndex() ?? -1) + 1);
  }
}
