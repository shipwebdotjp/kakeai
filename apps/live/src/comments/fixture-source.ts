import type {
  CommentEvent,
  CommentSourceStatus,
  LiveFixtureComment,
} from "@kakeai/contracts";
import {
  CommentSourceBase,
  realCommentScheduler,
  type CommentSourceScheduler,
} from "./source.ts";

export interface FixtureCommentSourceOptions {
  comments: readonly LiveFixtureComment[];
  now?: () => Date;
  scheduler?: CommentSourceScheduler;
  /** Initial playback speed; 2 is twice as fast, 0.5 is half speed. */
  initialSpeed?: number;
}

interface FixtureEntry {
  comment: LiveFixtureComment;
  index: number;
}

function assertSpeed(speed: number): void {
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new Error("fixture の速度は 0 より大きい数で指定してください。");
  }
}

/**
 * Replays fixture comments relative to the start time. `atMs` is logical show
 * time, so changing the speed changes only the wall-clock delay. No timers run
 * after `stop()` until `start()` (or `reset()` and then `start()`) is called.
 */
export class FixtureCommentSource extends CommentSourceBase {
  private readonly comments: readonly FixtureEntry[];
  private readonly now: () => Date;
  private readonly scheduler: CommentSourceScheduler;
  private speed: number;
  private state: CommentSourceStatus["state"] = "idle";
  private cursor = 0;
  private generation = 1;
  private elapsedBaseMs = 0;
  private activeStartedAtMs: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastEmittedAt: string | null = null;

  constructor(options: FixtureCommentSourceOptions) {
    super();
    for (const comment of options.comments) {
      if (!Number.isFinite(comment.atMs) || comment.atMs < 0) {
        throw new Error(`fixture の atMs が不正です: ${String(comment.atMs)}`);
      }
    }
    this.comments = options.comments
      .map((comment, index) => ({ comment, index }))
      .sort((left, right) => left.comment.atMs - right.comment.atMs || left.index - right.index);
    this.now = options.now ?? (() => new Date());
    this.scheduler = options.scheduler ?? realCommentScheduler;
    this.speed = options.initialSpeed ?? 1;
    assertSpeed(this.speed);
  }

  getState(): CommentSourceStatus["state"] {
    return this.state;
  }

  getSpeed(): number {
    return this.speed;
  }

  start(): void {
    if (this.state === "polling") {
      return;
    }
    if (this.state === "stopped") {
      // After stop, start resumes from the current cursor. reset() is needed
      // to replay from the beginning.
      this.state = "polling";
      this.activeStartedAtMs = this.now().getTime();
      this.emitStatus();
      this.scheduleNext();
      return;
    }
    this.state = "polling";
    this.activeStartedAtMs = this.now().getTime();
    this.emitStatus();
    this.scheduleNext();
  }

  stop(): void {
    if (this.state === "stopped" || this.state === "idle") {
      this.state = "stopped";
      this.emitStatus();
      return;
    }
    this.commitElapsed();
    this.activeStartedAtMs = null;
    this.clearTimer();
    this.state = "stopped";
    this.emitStatus();
  }

  /** Rewinds to the first comment and returns to `idle`. Speed is preserved. */
  reset(): void {
    this.clearTimer();
    this.cursor = 0;
    this.generation += 1;
    this.elapsedBaseMs = 0;
    this.activeStartedAtMs = null;
    this.lastEmittedAt = null;
    this.state = "idle";
    this.emitStatus();
  }

  setSpeed(speed: number): void {
    assertSpeed(speed);
    this.commitElapsed();
    this.speed = speed;
    if (this.state === "polling") {
      this.scheduleNext();
    }
    this.emitStatus();
  }

  getStatus(): CommentSourceStatus {
    return {
      kind: "fixture",
      state: this.state,
      liveChatId: null,
      pollingIntervalMs: 0,
      lastPolledAt: this.lastEmittedAt,
      lastError: null,
      quota: null,
      authExpiresAt: null,
      needsReauth: false,
    };
  }

  private elapsedMs(): number {
    if (this.activeStartedAtMs === null) {
      return this.elapsedBaseMs;
    }
    return this.elapsedBaseMs + (this.now().getTime() - this.activeStartedAtMs) * this.speed;
  }

  private commitElapsed(): void {
    this.elapsedBaseMs = this.elapsedMs();
    if (this.activeStartedAtMs !== null) {
      this.activeStartedAtMs = this.now().getTime();
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.scheduler.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    this.clearTimer();
    if (this.state !== "polling") {
      return;
    }
    const next = this.comments[this.cursor];
    if (next === undefined) {
      return;
    }
    const delayMs = Math.max(0, (next.comment.atMs - this.elapsedMs()) / this.speed);
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      // Move logical time to at least the scheduled point so a fake scheduler
      // that does not advance `now` still emits the comment at the right time.
      this.elapsedBaseMs = Math.max(this.elapsedBaseMs, next.comment.atMs);
      this.activeStartedAtMs = this.now().getTime();
      this.fireDueComments();
    }, delayMs);
  }

  private fireDueComments(): void {
    if (this.state !== "polling") {
      return;
    }
    const elapsed = this.elapsedMs();
    let emitted = false;
    while (this.cursor < this.comments.length) {
      const entry = this.comments[this.cursor]!;
      if (entry.comment.atMs > elapsed) {
        break;
      }
      this.cursor += 1;
      this.emitComment(this.toCommentEvent(entry));
      emitted = true;
    }
    if (emitted) {
      this.lastEmittedAt = this.now().toISOString();
      this.emitStatus();
    }
    this.scheduleNext();
  }

  private toCommentEvent(entry: FixtureEntry): CommentEvent {
    const receivedAt = this.now().toISOString();
    return {
      id: `fixture-g${this.generation}-${entry.index + 1}`,
      authorName: entry.comment.author,
      text: entry.comment.text,
      publishedAt: receivedAt,
      receivedAt,
      kind: entry.comment.kind,
    };
  }
}
