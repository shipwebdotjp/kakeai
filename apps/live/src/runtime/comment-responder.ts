import type { CommentCandidate } from "@kakeai/contracts";
import type { CommentSourceScheduler } from "../comments/source.ts";

export type CommentCornerRespondOutcome = "done" | "stopped";

/**
 * Boundary between the comment corner and the response it displays. P4 only
 * holds the card for `cornerHoldMs`. P5 replaces the hold with a generated
 * response and TTS without changing the corner loop.
 */
export interface CommentCornerResponder {
  respond(candidate: CommentCandidate): Promise<CommentCornerRespondOutcome>;
  pause(): void;
  resume(): void;
  /** Cancels the current response; the pending `respond` resolves `stopped`. */
  stop(): void;
}

export interface HoldCommentCornerResponderOptions {
  holdMs: number;
  scheduler: CommentSourceScheduler;
  now: () => number;
}

/**
 * P4 responder: show the card for a fixed duration. Pausing preserves the
 * remaining hold so resuming does not restart the card from zero.
 */
export class HoldCommentCornerResponder implements CommentCornerResponder {
  private readonly holdMs: number;
  private readonly scheduler: CommentSourceScheduler;
  private readonly now: () => number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private resolve: ((outcome: CommentCornerRespondOutcome) => void) | null = null;
  private remainingMs = 0;
  private startedAtMs: number | null = null;

  constructor(options: HoldCommentCornerResponderOptions) {
    this.holdMs = Math.max(0, Math.floor(options.holdMs));
    this.scheduler = options.scheduler;
    this.now = options.now;
  }

  respond(_candidate: CommentCandidate): Promise<CommentCornerRespondOutcome> {
    this.stop();
    return new Promise<CommentCornerRespondOutcome>((resolve) => {
      this.resolve = resolve;
      this.remainingMs = this.holdMs;
      this.start();
    });
  }

  pause(): void {
    if (this.resolve === null || this.startedAtMs === null) {
      return;
    }
    this.clearTimer();
    this.remainingMs = Math.max(0, this.remainingMs - (this.now() - this.startedAtMs));
    this.startedAtMs = null;
  }

  resume(): void {
    if (this.resolve === null || this.timer !== null || this.startedAtMs !== null) {
      return;
    }
    this.start();
  }

  stop(): void {
    this.finish("stopped");
  }

  private start(): void {
    if (this.resolve === null) {
      return;
    }
    if (this.remainingMs <= 0) {
      this.finish("done");
      return;
    }
    this.startedAtMs = this.now();
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      this.finish("done");
    }, this.remainingMs);
  }

  private finish(outcome: CommentCornerRespondOutcome): void {
    this.clearTimer();
    this.startedAtMs = null;
    this.remainingMs = 0;
    const resolve = this.resolve;
    this.resolve = null;
    resolve?.(outcome);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.scheduler.clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
