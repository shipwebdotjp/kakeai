import type { LiveCue } from "@kakeai/contracts";

export interface PlayoutScheduler {
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
  now(): number;
}

export const defaultPlayoutScheduler: PlayoutScheduler = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle),
  now: () => Date.now(),
};

export type PlayoutEvent =
  | { type: "cue_started"; cue: LiveCue; attempt: number; startedAt: Date }
  | { type: "cue_finished"; cue: LiveCue; attempt: number; reason: "duration" | "event" }
  | { type: "queue_finished" };

/** Some generated cues can be enqueued before their measured duration exists. */
const FALLBACK_CUE_DURATION_MS = 1000;

/**
 * P2 playout: prepared cues advance after `durationMs` using a timer. P3
 * replaces the timer with `audio_ended` from the program stage; the interface
 * stays the same, so only the trigger changes.
 */
export class Playout {
  private cues: readonly LiveCue[] = [];
  private index = -1;
  private attempt = 1;
  private startedAtMs: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private paused = false;

  constructor(
    private readonly emit: (event: PlayoutEvent) => void,
    private readonly scheduler: PlayoutScheduler = defaultPlayoutScheduler,
  ) {}

  setQueue(cues: readonly LiveCue[]): void {
    this.clearTimer();
    this.cues = cues;
    this.index = -1;
    this.attempt = 1;
    this.startedAtMs = null;
    this.paused = false;
  }

  get current(): LiveCue | null {
    return this.cues[this.index] ?? null;
  }

  get currentAttempt(): number {
    return this.attempt;
  }

  get currentStartedAt(): Date | null {
    return this.startedAtMs === null ? null : new Date(this.startedAtMs);
  }

  get isPaused(): boolean {
    return this.paused;
  }

  start(): void {
    if (this.index >= 0) {
      return;
    }
    this.startNext();
  }

  private startNext(): void {
    this.index += 1;
    const cue = this.cues[this.index];
    if (cue === undefined) {
      this.emit({ type: "queue_finished" });
      return;
    }
    this.attempt = 1;
    this.startedAtMs = this.scheduler.now();
    this.schedule(cue, this.attempt);
    this.emit({
      type: "cue_started",
      cue,
      attempt: this.attempt,
      startedAt: new Date(this.startedAtMs),
    });
  }

  private schedule(cue: LiveCue, attempt: number): void {
    this.clearTimer();
    const rawDuration = cue.durationMs ?? FALLBACK_CUE_DURATION_MS;
    const duration =
      Number.isFinite(rawDuration) && rawDuration > 0
        ? Math.min(rawDuration, 24 * 60 * 60 * 1000)
        : FALLBACK_CUE_DURATION_MS;
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      if (this.current !== cue || this.attempt !== attempt || this.paused) {
        return;
      }
      this.finish("duration");
    }, duration);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.scheduler.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private finish(reason: "duration" | "event"): void {
    const cue = this.current;
    if (cue === null) {
      return;
    }
    this.clearTimer();
    const attempt = this.attempt;
    this.emit({ type: "cue_finished", cue, attempt, reason });
    this.startNext();
  }

  /** Program-stage `audio_ended` or an operator skip. */
  advance(): void {
    this.finish("event");
  }

  pause(): void {
    if (this.current === null || this.paused) {
      return;
    }
    this.paused = true;
    this.clearTimer();
  }

  /** Resumes the current attempt from the beginning. */
  resume(): void {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    const cue = this.current;
    if (cue === null) {
      return;
    }
    this.startedAtMs = this.scheduler.now();
    this.schedule(cue, this.attempt);
  }

  stop(): void {
    if (this.current === null) {
      return;
    }
    this.paused = true;
    this.clearTimer();
  }

  dispose(): void {
    this.clearTimer();
  }
}
