import type { LiveCue, LivePreloadCue } from "@kakeai/contracts";
import {
  checkAudioEvent,
  type AudioEventResult,
  type PlayoutAudioEvent,
} from "./audio-event.ts";
import { estimateSegmentBuffer, type SegmentBufferEstimate } from "./buffer.ts";
import { collectPreloadCues } from "./preload.ts";
import {
  discardGenerated,
  insertAfterCurrent,
  moveCueInQueue,
  removeCueFromQueue,
} from "./queue-edits.ts";
import { watchdogTimeoutMs } from "./watchdog.ts";

export type { AudioEventRejection, AudioEventResult, PlayoutAudioEvent } from "./audio-event.ts";

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

export type CueEndReason = "audio_ended" | "skip" | "audio_error" | "watchdog";

export type PlayoutEvent =
  | {
      type: "cue_started";
      cue: LiveCue;
      attempt: number;
      sequence: number;
      startedAt: Date;
      preload: LivePreloadCue[];
    }
  | {
      type: "cue_finished";
      cue: LiveCue;
      attempt: number;
      sequence: number;
      status: "done" | "skipped" | "failed";
      reason: CueEndReason;
    }
  | { type: "cue_skipped"; cue: LiveCue; reason: "not_ready" | "operator" }
  | {
      type: "failure";
      cue: LiveCue;
      attempt: number;
      sequence: number;
      reason: "audio_error" | "watchdog";
      message: string;
      consecutiveFailures: number;
      suspended: boolean;
    }
  | { type: "thinking"; cue: LiveCue }
  | { type: "queue_finished" };

export interface PlayoutOptions {
  maxThinkingMs: number;
  minBufferMs: number;
  emit: (event: PlayoutEvent) => void;
  /** Cues from later spine segments, used to preload across a segment boundary. */
  followingCues?: () => readonly LiveCue[];
  scheduler?: PlayoutScheduler;
}

const THINKING_POLL_MS = 100;
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Event-driven playout. A cue advances only when the program stage reports
 * `audio_ended` for the current `cueId`/`attempt`/`sequence`, or when its
 * watchdog fires. The controller owns phases and segments; this class owns the
 * current segment queue, the per-cue attempt, the server-wide playback
 * sequence and the bounded "thinking" wait.
 */
export class Playout {
  private readonly emit: (event: PlayoutEvent) => void;
  private readonly scheduler: PlayoutScheduler;
  private readonly maxThinkingMs: number;
  private readonly minBufferMs: number;
  private readonly followingCues: () => readonly LiveCue[];
  private queue: LiveCue[] = [];
  private index = -1;
  private attempt = 0;
  private readonly attempts = new Map<string, number>();
  private startedAtMs: number | null = null;
  private currentSequence: number | null = null;
  private sequenceCounter = 0;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private thinkingTimer: ReturnType<typeof setTimeout> | null = null;
  private paused = false;
  private thinking = false;
  private queueFinished = false;
  private consecutiveFailures = 0;

  constructor(options: PlayoutOptions) {
    this.emit = options.emit;
    this.scheduler = options.scheduler ?? defaultPlayoutScheduler;
    this.maxThinkingMs = options.maxThinkingMs;
    this.minBufferMs = options.minBufferMs;
    this.followingCues = options.followingCues ?? (() => []);
  }

  setQueue(cues: LiveCue[]): void {
    this.clearTimers();
    this.queue = cues;
    this.index = -1;
    this.attempt = 0;
    this.startedAtMs = null;
    this.currentSequence = null;
    this.paused = false;
    this.thinking = false;
    this.queueFinished = false;
  }

  get current(): LiveCue | null {
    return this.queue[this.index] ?? null;
  }

  get currentIndex(): number {
    return this.index;
  }

  get currentAttempt(): number {
    return this.attempt;
  }

  get currentSequenceValue(): number | null {
    return this.currentSequence;
  }

  get currentStartedAt(): Date | null {
    return this.startedAtMs === null ? null : new Date(this.startedAtMs);
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get isThinking(): boolean {
    return this.thinking;
  }

  get isQueueFinished(): boolean {
    return this.queueFinished;
  }

  get failureCount(): number {
    return this.consecutiveFailures;
  }

  start(): void {
    if (this.index >= 0 || this.paused || this.queueFinished) {
      return;
    }
    this.advanceToNext();
  }

  handleAudioEnded(event: PlayoutAudioEvent): AudioEventResult {
    const check = this.checkAudioEvent(event);
    if (!check.accepted) {
      return check;
    }
    this.consecutiveFailures = 0;
    this.finishCurrent("done", "audio_ended");
    return { accepted: true };
  }

  handleAudioError(event: PlayoutAudioEvent, message?: string): AudioEventResult {
    const check = this.checkAudioEvent(event);
    if (!check.accepted) {
      return check;
    }
    this.failCurrent(
      "audio_error",
      message ?? `音声の再生に失敗しました: ${event.cueId ?? "unknown"}`,
    );
    return { accepted: true };
  }

  /** Operator skip: the current cue is dropped and the next one starts. */
  skipCurrent(): boolean {
    const cue = this.current;
    if (cue === null) {
      return false;
    }
    const started = this.startedAtMs !== null;
    if (this.paused) {
      this.clearTimers();
      this.thinking = false;
      if (started) {
        const attempt = this.attempt;
        const sequence = this.currentSequence;
        if (sequence === null) {
          return false;
        }
        this.startedAtMs = null;
        this.currentSequence = null;
        this.attempt = 0;
        cue.status = "skipped";
        this.emit({
          type: "cue_finished",
          cue,
          attempt,
          sequence,
          status: "skipped",
          reason: "skip",
        });
      } else {
        cue.status = "skipped";
        this.emit({ type: "cue_skipped", cue, reason: "operator" });
      }
      this.index += 1;
      return true;
    }
    if (started) {
      if (this.currentSequence === null) {
        return false;
      }
      this.finishCurrent("skipped", "skip");
      return true;
    }
    this.clearTimers();
    this.thinking = false;
    cue.status = "skipped";
    this.currentSequence = null;
    this.attempt = 0;
    this.emit({ type: "cue_skipped", cue, reason: "operator" });
    this.advanceToNext();
    return true;
  }

  pause(): void {
    if (this.paused) {
      return;
    }
    this.paused = true;
    this.clearTimers();
    this.thinking = false;
  }

  /** Resumes the current attempt from the beginning with a new sequence. */
  resume(): void {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    if (this.current === null) {
      if (this.queueFinished) {
        return;
      }
      if (this.index >= this.queue.length) {
        this.finishQueue();
        return;
      }
      this.beginCurrent();
      return;
    }
    if (this.startedAtMs !== null) {
      this.startCue(this.current, this.attempt);
      return;
    }
    this.beginCurrent();
  }

  stop(): void {
    this.paused = true;
    this.clearTimers();
    this.thinking = false;
  }

  /** Inserts generated/manual cues right after the current cue. */
  insertAfterCurrent(cues: LiveCue[]): void {
    insertAfterCurrent(this.queue, this.index, cues);
  }

  /**
   * Removes generated/manual cues. Used by `stop` and `safe_mode`: prepared
   * cues are never removed. When the current cue disappears the cursor moves
   * to the next prepared cue.
   */
  discardGeneratedCues(options: { continuePlaying?: boolean } = {}): LiveCue[] {
    const result = discardGenerated(this.queue, this.index);
    this.index = result.index;
    if (!result.currentRemoved) {
      return result.removed;
    }
    this.clearTimers();
    this.thinking = false;
    this.startedAtMs = null;
    this.currentSequence = null;
    this.attempt = 0;
    if (options.continuePlaying === true && !this.paused) {
      if (this.current === null) {
        this.finishQueue();
      } else {
        this.beginCurrent();
      }
    }
    return result.removed;
  }

  /** Removes a cue that has not started playing. */
  removeCue(cueId: string): boolean {
    const result = removeCueFromQueue(this.queue, this.index, cueId);
    this.index = result.index;
    if (result.currentRemoved) {
      this.clearTimers();
      this.thinking = false;
      this.startedAtMs = null;
      this.currentSequence = null;
      this.attempt = 0;
      if (!this.paused) {
        if (this.current === null) {
          this.finishQueue();
        } else {
          this.beginCurrent();
        }
      }
    }
    return result.removed;
  }

  moveCue(cueId: string, beforeCueId: string | null): boolean {
    const result = moveCueInQueue(this.queue, this.index, cueId, beforeCueId);
    this.index = result.index;
    return result.moved;
  }

  getPreloadCues(): LivePreloadCue[] {
    return collectPreloadCues(this.queue, this.index, this.followingCues());
  }

  getBufferEstimate(hasFallback: boolean): SegmentBufferEstimate {
    return estimateSegmentBuffer({
      cues: this.queue,
      currentIndex: this.index,
      currentRemainingMs: this.currentRemainingMs(),
      minBufferMs: this.minBufferMs,
      hasFallback,
    });
  }

  dispose(): void {
    this.clearTimers();
  }

  private currentRemainingMs(): number {
    const duration = this.current?.durationMs ?? null;
    if (duration === null) {
      return 0;
    }
    if (this.startedAtMs === null || this.paused) {
      return duration;
    }
    return Math.max(0, duration - (this.scheduler.now() - this.startedAtMs));
  }

  private checkAudioEvent(event: PlayoutAudioEvent): AudioEventResult {
    return checkAudioEvent(
      {
        paused: this.paused,
        thinking: this.thinking,
        currentCueId: this.current?.id ?? null,
        started: this.startedAtMs !== null,
        attempt: this.attempt,
        sequence: this.currentSequence,
      },
      event,
    );
  }

  private advanceToNext(): void {
    this.index += 1;
    this.beginCurrent();
  }

  private beginCurrent(): void {
    if (this.paused) {
      return;
    }
    for (;;) {
      const cue = this.current;
      if (cue === null) {
        this.finishQueue();
        return;
      }
      this.startedAtMs = null;
      this.currentSequence = null;
      this.attempt = 0;
      if (cue.status === "done" || cue.status === "skipped" || cue.status === "failed") {
        this.index += 1;
        continue;
      }
      if (cue.status === "ready" && cue.audio !== null) {
        this.startCue(cue, this.nextAttempt(cue));
        return;
      }
      if (this.maxThinkingMs <= 0) {
        this.skipBeforeStart(cue, "not_ready");
        this.index += 1;
        continue;
      }
      this.beginThinking(cue);
      return;
    }
  }

  private beginThinking(cue: LiveCue): void {
    this.clearTimers();
    this.thinking = true;
    this.emit({ type: "thinking", cue });
    const deadline = this.scheduler.now() + this.maxThinkingMs;
    const check = (): void => {
      this.thinkingTimer = null;
      if (this.paused || this.current !== cue || !this.thinking) {
        return;
      }
      if (cue.status === "ready" && cue.audio !== null) {
        this.thinking = false;
        this.startCue(cue, this.nextAttempt(cue));
        return;
      }
      const now = this.scheduler.now();
      if (now >= deadline) {
        this.thinking = false;
        this.skipBeforeStart(cue, "not_ready");
        this.advanceToNext();
        return;
      }
      const delay = Math.min(THINKING_POLL_MS, Math.max(1, deadline - now));
      this.thinkingTimer = this.scheduler.setTimeout(check, delay);
    };
    const firstDelay = Math.min(THINKING_POLL_MS, Math.max(1, this.maxThinkingMs));
    this.thinkingTimer = this.scheduler.setTimeout(check, firstDelay);
  }

  private skipBeforeStart(cue: LiveCue, reason: "not_ready" | "operator"): void {
    cue.status = "skipped";
    this.currentSequence = null;
    this.attempt = 0;
    this.emit({ type: "cue_skipped", cue, reason });
  }

  private nextAttempt(cue: LiveCue): number {
    const next = (this.attempts.get(cue.id) ?? 0) + 1;
    this.attempts.set(cue.id, next);
    return next;
  }

  private startCue(cue: LiveCue, attempt: number): void {
    this.clearTimers();
    this.thinking = false;
    this.attempt = attempt;
    this.startedAtMs = this.scheduler.now();
    this.sequenceCounter += 1;
    this.currentSequence = this.sequenceCounter;
    cue.status = "playing";
    this.scheduleWatchdog(cue, attempt, this.currentSequence);
    this.emit({
      type: "cue_started",
      cue,
      attempt,
      sequence: this.currentSequence,
      startedAt: new Date(this.startedAtMs),
      preload: this.getPreloadCues(),
    });
  }

  private scheduleWatchdog(cue: LiveCue, attempt: number, sequence: number): void {
    this.clearWatchdog();
    this.watchdog = this.scheduler.setTimeout(() => {
      this.watchdog = null;
      if (
        this.paused ||
        this.current !== cue ||
        this.attempt !== attempt ||
        this.currentSequence !== sequence
      ) {
        return;
      }
      this.failCurrent(
        "watchdog",
        `音声の終了イベントが時間内に届きませんでした: ${cue.id}`,
      );
    }, watchdogTimeoutMs(cue.durationMs));
  }

  private finishCurrent(status: "done" | "skipped", reason: CueEndReason): void {
    const cue = this.current;
    if (cue === null) {
      return;
    }
    const attempt = this.attempt;
    const sequence = this.currentSequence;
    if (sequence === null) {
      return;
    }
    this.clearTimers();
    this.thinking = false;
    this.startedAtMs = null;
    this.currentSequence = null;
    this.attempt = 0;
    cue.status = status;
    this.emit({ type: "cue_finished", cue, attempt, sequence, status, reason });
    this.advanceToNext();
  }

  private failCurrent(reason: "audio_error" | "watchdog", message: string): void {
    const cue = this.current;
    if (cue === null) {
      return;
    }
    const attempt = this.attempt;
    const sequence = this.currentSequence;
    if (sequence === null) {
      return;
    }
    this.clearTimers();
    this.thinking = false;
    this.startedAtMs = null;
    this.currentSequence = null;
    this.attempt = 0;
    cue.status = "failed";
    this.consecutiveFailures += 1;
    const suspended = this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;
    this.emit({
      type: "cue_finished",
      cue,
      attempt,
      sequence,
      status: "failed",
      reason,
    });
    this.emit({
      type: "failure",
      cue,
      attempt,
      sequence,
      reason,
      message,
      consecutiveFailures: this.consecutiveFailures,
      suspended,
    });
    this.index += 1;
    if (suspended) {
      this.paused = true;
      return;
    }
    this.beginCurrent();
  }

  private finishQueue(): void {
    if (this.queueFinished) {
      return;
    }
    this.queueFinished = true;
    this.clearTimers();
    this.thinking = false;
    this.startedAtMs = null;
    this.currentSequence = null;
    this.attempt = 0;
    this.emit({ type: "queue_finished" });
  }

  private clearWatchdog(): void {
    if (this.watchdog !== null) {
      this.scheduler.clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }

  private clearThinking(): void {
    if (this.thinkingTimer !== null) {
      this.scheduler.clearTimeout(this.thinkingTimer);
      this.thinkingTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearWatchdog();
    this.clearThinking();
  }
}
