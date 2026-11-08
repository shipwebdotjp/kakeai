import type { LiveCue } from "@kakeai/contracts";
import type { Playout } from "./playout.ts";
import type { CueQueueStore } from "./queue.ts";

export interface ResponsePlaybackHost {
  readonly queues: CueQueueStore;
  readonly playout: Playout;
  currentSegmentIndex(): number | null;
  publishPreload(): void;
  publish(): void;
}

/**
 * Owns the comment-corner response queue. A comment segment has no prepared
 * cue array, so the generated cues are installed as the segment queue and
 * handed to the playout by reference. `queue_finished` for this queue does not
 * advance the spine; the responder waits for all cue ids and then ends the
 * response.
 *
 * The serial makes stale waits harmless: a wait from an earlier response can
 * finish after a newer response started, but only the matching serial clears
 * the active flag.
 */
export class ResponsePlayback {
  private serial = 0;
  private active = false;

  constructor(private readonly host: ResponsePlaybackHost) {}

  get isActive(): boolean {
    return this.active;
  }

  start(cues: LiveCue[]): number {
    const segmentIndex = this.host.currentSegmentIndex();
    this.serial += 1;
    if (segmentIndex === null || cues.length === 0) {
      // Do not leak a previous active flag into the next spine queue.
      this.active = false;
      return this.serial;
    }
    this.active = true;
    this.host.queues.setForSegment(segmentIndex, cues);
    const installed = this.host.queues.forSegment(segmentIndex) ?? cues;
    this.host.playout.setQueue(installed);
    this.host.playout.start();
    this.host.publishPreload();
    this.host.publish();
    return this.serial;
  }

  /** Ends only the response that started with `serial`. */
  end(serial: number): void {
    if (serial === this.serial) {
      this.active = false;
    }
  }

  /** Forces the current response to stop before a new one starts. */
  cancel(): void {
    this.serial += 1;
    this.active = false;
  }

  /** `true` once for the `queue_finished` that belongs to a response queue. */
  consumeQueueFinished(): boolean {
    if (!this.active) {
      return false;
    }
    this.active = false;
    return true;
  }
}
