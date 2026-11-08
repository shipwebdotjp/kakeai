import type { LivePackageCutIn, LiveSegment, StageEvent } from "@kakeai/contracts";
import {
  defaultPlayoutScheduler,
  type PlayoutScheduler,
} from "./playout.ts";
import { cutInWatchdogTimeoutMs } from "./watchdog.ts";

export type CutInEndReason = "ended" | "error" | "watchdog" | "skip" | "safe_mode";

export type CutInSegment = Extract<LiveSegment, { kind: "cut_in" }>;

/** One playback of a CutIn segment. Replays of the same CutIn make new occurrences. */
export interface CutInOccurrence {
  cutIn: LivePackageCutIn;
  segment: CutInSegment;
  segmentIndex: number;
  attempt: number;
  sequence: number;
  startedAt: Date;
}

export interface CutInRuntimeHost {
  /** Wall-clock milliseconds, matching the injected controller clock. */
  now(): number;
  /** Server-wide monotonic playback sequence, shared with the cue playout. */
  nextSequence(): number;
  onStarted(occurrence: CutInOccurrence): void;
  onFinished(
    occurrence: CutInOccurrence,
    reason: CutInEndReason,
    message?: string,
  ): void;
  scheduler?: PlayoutScheduler;
}

export type CutInEventResult =
  | { accepted: true }
  | { accepted: false; reason: string };

/**
 * Owns the currently playing CutIn independently of the cue playout. CutIn has
 * its own attempt/sequence identity and watchdog, so a failing video never
 * touches the prepared cue queue or pauses the show.
 *
 * Every callback runs after the runtime state has been cleared, because the
 * finish callback advances the spine and may start the next CutIn reentrantly.
 */
export class CutInRuntime {
  private readonly host: CutInRuntimeHost;
  private readonly scheduler: PlayoutScheduler;
  private readonly attempts = new Map<string, number>();
  private occurrence: CutInOccurrence | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private paused = false;

  constructor(host: CutInRuntimeHost) {
    this.host = host;
    this.scheduler = host.scheduler ?? defaultPlayoutScheduler;
  }

  get current(): CutInOccurrence | null {
    return this.occurrence;
  }

  get hasCurrent(): boolean {
    return this.occurrence !== null;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Starts a new occurrence for a `cut_in` spine segment. */
  start(
    segmentIndex: number,
    segment: CutInSegment,
    cutIn: LivePackageCutIn,
  ): CutInOccurrence {
    if (this.occurrence !== null) {
      // A running occurrence must be finished, skipped, cancelled or cleared
      // first; silently replacing it would strand its watchdog bookkeeping and
      // drop the previous occurrence without a finish callback.
      throw new Error(`CutIn already playing: ${this.occurrence.cutIn.id}`);
    }
    this.clearWatchdog();
    const attempt = (this.attempts.get(segment.id) ?? 0) + 1;
    this.attempts.set(segment.id, attempt);
    const occurrence: CutInOccurrence = {
      cutIn,
      segment,
      segmentIndex,
      attempt,
      sequence: this.host.nextSequence(),
      startedAt: new Date(this.host.now()),
    };
    this.occurrence = occurrence;
    this.paused = false;
    this.scheduleWatchdog(occurrence);
    try {
      this.host.onStarted(occurrence);
    } catch (error) {
      // A throwing publisher must not leave a ghost occurrence or a watchdog
      // that advances the spine later.
      this.cancel();
      throw error;
    }
    return occurrence;
  }

  /**
   * Accepts only an event matching the current occurrence exactly. Late events
   * from a previous attempt or a replaced program stage are ignored.
   */
  handleStageEvent(event: StageEvent): CutInEventResult {
    if (this.paused) {
      return { accepted: false, reason: "paused" };
    }
    const occurrence = this.occurrence;
    if (occurrence === null) {
      return { accepted: false, reason: "no_current" };
    }
    if (event.cutInId !== occurrence.cutIn.id) {
      return { accepted: false, reason: "cutInId_mismatch" };
    }
    if (event.segmentId !== occurrence.segment.id) {
      return { accepted: false, reason: "segmentId_mismatch" };
    }
    if (event.attempt !== occurrence.attempt) {
      return { accepted: false, reason: "attempt_mismatch" };
    }
    if (event.sequence !== occurrence.sequence) {
      return { accepted: false, reason: "sequence_mismatch" };
    }
    if (event.kind === "cut_in_ended") {
      this.finish("ended");
      return { accepted: true };
    }
    if (event.kind === "cut_in_error") {
      this.finish(
        "error",
        event.error ?? `CutIn の再生に失敗しました: ${occurrence.cutIn.id}`,
      );
      return { accepted: true };
    }
    return { accepted: false, reason: "unsupported_kind" };
  }

  /** Stops the video but retains the occurrence so `resume` can replay it. */
  pause(): void {
    if (this.occurrence === null) {
      return;
    }
    this.paused = true;
    this.clearWatchdog();
  }

  /** `stop` behaves like `pause`: the CutIn restarts from the beginning later. */
  stop(): void {
    this.pause();
  }

  /**
   * Replays the retained occurrence from the beginning with a new attempt and
   * sequence, so a stage cannot confuse it with the paused attempt.
   */
  resume(): CutInOccurrence | null {
    const retained = this.occurrence;
    if (retained === null || !this.paused) {
      return null;
    }
    const attempt = retained.attempt + 1;
    this.attempts.set(retained.segment.id, attempt);
    const occurrence: CutInOccurrence = {
      cutIn: retained.cutIn,
      segment: retained.segment,
      segmentIndex: retained.segmentIndex,
      attempt,
      sequence: this.host.nextSequence(),
      startedAt: new Date(this.host.now()),
    };
    this.occurrence = occurrence;
    this.paused = false;
    this.scheduleWatchdog(occurrence);
    try {
      this.host.onStarted(occurrence);
    } catch (error) {
      // A throwing publisher must not leave a ghost occurrence or a watchdog
      // that advances the spine later.
      this.cancel();
      throw error;
    }
    return occurrence;
  }

  /** Operator skip while an occurrence is playing. */
  skip(): boolean {
    return this.finish("skip");
  }

  /** Stops the CutIn when safe mode starts and advances the spine once. */
  finishForSafeMode(): boolean {
    return this.finish("safe_mode");
  }

  /** Clears without a finish callback (post_show, end while paused). */
  cancel(): void {
    this.clearWatchdog();
    this.occurrence = null;
    this.paused = false;
  }

  /** Alias of `cancel` for generic controller teardown; no finish callback. */
  clear(): void {
    this.cancel();
  }

  /** Releases timers and state at controller shutdown; no finish callback. */
  dispose(): void {
    this.cancel();
  }

  private finish(reason: CutInEndReason, message?: string): boolean {
    const occurrence = this.occurrence;
    if (occurrence === null) {
      return false;
    }
    // Clear first: the callback advances the spine and can start the next
    // CutIn or another cue before this call returns.
    this.clearWatchdog();
    this.occurrence = null;
    this.paused = false;
    this.host.onFinished(occurrence, reason, message);
    return true;
  }

  private scheduleWatchdog(occurrence: CutInOccurrence): void {
    this.clearWatchdog();
    const attempt = occurrence.attempt;
    const sequence = occurrence.sequence;
    this.watchdog = this.scheduler.setTimeout(() => {
      this.watchdog = null;
      if (
        this.paused ||
        this.occurrence === null ||
        this.occurrence.attempt !== attempt ||
        this.occurrence.sequence !== sequence
      ) {
        return;
      }
      this.finish(
        "watchdog",
        `CutIn の終了イベントが時間内に届きませんでした: ${occurrence.cutIn.id}`,
      );
    }, cutInWatchdogTimeoutMs(occurrence.cutIn.durationMs));
  }

  private clearWatchdog(): void {
    if (this.watchdog !== null) {
      this.scheduler.clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }
}
