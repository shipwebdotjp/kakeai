import type {
  CommentSourceKind,
  ConsoleSnapshot,
  LiveCharacterSheet,
  LiveCommand,
  LiveCue,
  LiveGenerationStatus,
  LivePackageCutIn,
  LivePackageShow,
  LivePreloadCue,
  LiveSegment,
  LiveStageConnection,
  LiveNoticeLevel,
  StageClock,
  StageEvent,
  StageLease,
  StagePhase,
  StageState,
  StageVisualState,
} from "@kakeai/contracts";
import type { RunLogEventInput, RunStore } from "../runs/run-store.ts";
import type { GeneratedCueCommands } from "../director/generation-service.ts";
import type { SegmentBufferEstimate } from "./buffer.ts";
import { CommentRuntime } from "./comment-runtime.ts";
import { dispatchLiveCommand, type CommandResult } from "./command-dispatch.ts";
import { PhaseCommands } from "./controller-commands.ts";
import type { LiveControllerChange, LiveControllerOptions } from "./controller-types.ts";
import { ControllerView } from "./controller-view.ts";
import { CueControl, type LiveCuePatch } from "./control-queue.ts";
import {
  CutInRuntime,
  type CutInEndReason,
  type CutInOccurrence,
} from "./cut-in-runtime.ts";
import { handleCueCommand, type CueCommandHooks } from "./cue-commands.ts";
import { StageLeaseManager, type StageConnectOptions } from "./lease.ts";
import { Playout, type PlayoutEvent, type PlayoutScheduler } from "./playout.ts";
import { dispatchPlayoutEvent } from "./playout-events.ts";
import { CueQueueStore } from "./queue.ts";
import { ResponsePlayback } from "./response-playback.ts";
import { ACTIVE_PHASES } from "./segments.ts";
import { Spine } from "./spine.ts";
import { handleProgramStageEvent } from "./stage-events.ts";
import { buildShowMeta, computeClock } from "./state.ts";
import { resolveEffectiveVisual, StageVisualTracker } from "./visual-resolution.ts";

export type { LiveCuePatch } from "./control-queue.ts";
export type { LiveControllerChange, LiveControllerOptions } from "./controller-types.ts";
export type { CommandResult } from "./command-dispatch.ts";

/** Card failure text is display/log data, so keep it bounded and deduped. */
const CARD_ERROR_MESSAGE_LIMIT = 500;
const CARD_ERROR_NOTICE_LIMIT = 100;

/**
 * Single owner of live state. Stages only render `StageState` and report audio
 * events; every phase, segment and cue transition happens here. Playout is
 * event-driven: a timer is only a watchdog or the bounded "thinking" poll.
 */
export class LiveController {
  readonly runId: string;
  private readonly show: LivePackageShow;
  private readonly characters: LiveCharacterSheet;
  private readonly startAt: string | null;
  private readonly commentSourceKind: CommentSourceKind;
  private readonly runStore: RunStore | undefined;
  private readonly now: () => Date;
  private readonly leases: StageLeaseManager;
  private readonly listeners = new Set<(change: LiveControllerChange) => void>();
  private readonly playout: Playout;
  private readonly cutInRuntime: CutInRuntime;
  private readonly queues: CueQueueStore;
  private readonly cueControl: CueControl;
  private readonly spine: Spine;
  private readonly comments: CommentRuntime;
  private readonly view: ControllerView;
  private readonly responsePlayback: ResponsePlayback;
  private readonly phaseCommands: PhaseCommands;
  private readonly visualTracker = new StageVisualTracker();
  private readonly cardErrorNotices = new Set<string>();
  private readonly cutInById = new Map<string, LivePackageCutIn>();
  /** One server-wide counter for cue and CutIn playback instructions. */
  private sequenceCounter = 0;
  private readonly nextSequence = (): number => {
    this.sequenceCounter += 1;
    return this.sequenceCounter;
  };
  private generation: LiveGenerationStatus | null = null;
  private generatedCueCommands: GeneratedCueCommands | null = null;
  private readonly cueCommandHooks: CueCommandHooks;
  private phase: StagePhase = "pre_show";
  private phaseBeforePause: StagePhase | null = null;
  private currentSegmentIndex: number | null = null;
  private showStartedAtMs: number | null = null;
  private finalClock: StageClock | null = null;
  private endRequested = false;
  private safeMode = false;
  private finished = false;

  constructor(options: LiveControllerOptions) {
    this.runId = options.runId;
    this.show = options.show;
    this.characters = options.characters;
    this.startAt = options.startAt ?? null;
    this.commentSourceKind = options.commentSourceKind ?? "youtube";
    this.runStore = options.runStore;
    this.now = options.now ?? (() => new Date());
    this.comments = new CommentRuntime(options.comments, {
      publish: () => this.publish(),
      finishCorner: () => {
        this.comments.clearStageComment();
        this.setGeneration(null);
        this.responsePlayback.cancel();
        if (this.currentSegmentIndex !== null) {
          this.queues.setForSegment(this.currentSegmentIndex, []);
        }
        this.spine.handleQueueFinished();
      },
      isEndRequested: () => this.endRequested,
      isSafeMode: () => this.safeMode,
      notice: (level, message) => this.notice(level, message),
    });
    this.leases = new StageLeaseManager(options.runId, {
      now: this.now,
      ...(options.leaseTtlMs === undefined ? {} : { ttlMs: options.leaseTtlMs }),
      onProgramExpired: () => {
        this.handleProgramLeaseLost(
          "program ステージのリースが失効しました。コンソールから program を引き継いでください。",
        );
      },
    });
    this.queues = new CueQueueStore(this.show);
    this.playout = new Playout({
      maxThinkingMs: this.show.playout.maxThinkingMs,
      minBufferMs: this.show.playout.minBufferMs,
      emit: (event) => this.handlePlayoutEvent(event),
      followingCues: () => this.queues.afterSegment(this.currentSegmentIndex),
      nextSequence: () => this.nextSequence(),
      ...(options.playoutScheduler === undefined
        ? {}
        : { scheduler: options.playoutScheduler }),
    });
    this.cutInRuntime = new CutInRuntime({
      now: () => this.now().getTime(),
      nextSequence: () => this.nextSequence(),
      onStarted: (occurrence) => this.handleCutInStarted(occurrence),
      onFinished: (occurrence, reason, message) =>
        this.handleCutInFinished(occurrence, reason, message),
      ...(options.playoutScheduler === undefined
        ? {}
        : { scheduler: options.playoutScheduler }),
    });
    this.responsePlayback = new ResponsePlayback({
      queues: this.queues,
      playout: this.playout,
      currentSegmentIndex: () => this.currentSegmentIndex,
      publishPreload: () => this.publishPreload(),
      publish: () => this.publish(),
    });
    this.view = new ControllerView({
      runId: this.runId,
      show: this.show,
      startAt: this.startAt,
      commentSourceKind: this.commentSourceKind,
      characters: this.characters,
      playout: this.playout,
      queues: this.queues,
      leases: this.leases,
      comments: this.comments,
      phase: () => this.phase,
      segment: () => this.segment(),
      segmentLabel: (segment) => this.segmentLabel(segment),
      resolveVisual: (segment, cue) => this.resolveVisual(segment, cue),
      cutIn: () => this.cutInRuntime.current,
      clock: () =>
        this.finalClock ?? computeClock(this.show, this.showStartedAtMs, this.now().getTime()),
      generation: () => this.generation,
    });
    this.cueControl = new CueControl({
      show: this.show,
      queues: this.queues,
      playout: this.playout,
      phase: () => this.phase,
      currentSegmentIndex: () => this.currentSegmentIndex,
      log: (input) => this.log(input),
      publish: () => this.publish(),
      publishPreload: () => this.publishPreload(),
      playCorrectionQueue: (cues) => this.playCorrectionResponse(cues),
    });
    this.cueCommandHooks = {
      editGeneratedCue: (cueId, patch) =>
        this.generatedCueCommands?.editGeneratedCue(cueId, patch) ??
        this.reject("生成レスの編集が設定されていません。"),
      regenerateGeneratedCue: (cueId) =>
        this.generatedCueCommands?.regenerateGeneratedCue(cueId) ??
        this.reject("生成レスの再生成が設定されていません。"),
      playCorrection: (cueId) =>
        this.cueControl.playCorrection(cueId)
          ? { ok: true }
          : this.reject("訂正できる準備済みキューがありません。"),
    };
    this.spine = new Spine({
      show: this.show,
      queues: this.queues,
      playout: this.playout,
      phase: () => this.phase,
      currentSegmentIndex: () => this.currentSegmentIndex,
      currentSegment: () => this.segment(),
      setCurrentSegmentIndex: (index) => {
        this.currentSegmentIndex = index;
      },
      setPhase: (phase) => this.setPhase(phase),
      isSafeMode: () => this.safeMode,
      isEndRequested: () => this.endRequested,
      clearEndRequested: () => {
        this.endRequested = false;
      },
      remainingMs: () => this.remainingMs(),
      enterPostShow: () => this.enterPostShow(),
      hasCommentCorner: () => this.comments.enabled,
      startCommentCorner: (segment) => this.comments.startCorner(segment),
      startCutIn: (index, segment) => this.startCutIn(index, segment),
    });
    for (const cutIn of this.show.cutIns) {
      this.cutInById.set(cutIn.id, cutIn);
    }
    this.phaseCommands = new PhaseCommands({
      phase: () => this.phase,
      setPhase: (phase) => this.setPhase(phase),
      showStartedAtMs: () => this.showStartedAtMs,
      beginShow: (atMs) => {
        this.showStartedAtMs = atMs;
        this.finalClock = null;
        this.endRequested = false;
      },
      phaseBeforePause: () => this.phaseBeforePause,
      setPhaseBeforePause: (phase) => {
        this.phaseBeforePause = phase;
      },
      endRequested: () => this.endRequested,
      setEndRequested: (value) => {
        this.endRequested = value;
      },
      safeMode: () => this.safeMode,
      setSafeMode: (value) => {
        this.safeMode = value;
      },
      now: this.now,
      comments: this.comments,
      spine: this.spine,
      playout: this.playout,
      cutIn: this.cutInRuntime,
      queues: this.queues,
      currentSegment: () => this.segment(),
      log: (input) => this.log(input),
      notice: (level, message) => this.notice(level, message),
      reject: (message) => this.reject(message),
      publish: () => this.publish(),
      publishPreload: () => this.publishPreload(),
      clearGeneration: () => {
        this.setGeneration(null);
      },
      cancelResponse: () => this.responsePlayback.cancel(),
      enterPostShow: () => this.enterPostShow(),
    });
  }

  subscribe(listener: (change: LiveControllerChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(change: LiveControllerChange): void {
    for (const listener of this.listeners) {
      listener(change);
    }
  }

  private publish(): void {
    this.emit({ type: "state", state: this.getState() });
    this.emit({ type: "snapshot", snapshot: this.getSnapshot() });
  }

  private publishSnapshot(): void {
    this.emit({ type: "snapshot", snapshot: this.getSnapshot() });
  }

  private publishPreload(): void {
    this.emit({ type: "preload", cues: this.playout.getPreloadCues() });
  }

  private notice(level: LiveNoticeLevel, message: string): void {
    this.emit({ type: "notice", level, message });
  }

  private log(input: RunLogEventInput): void {
    if (this.runStore === undefined) {
      return;
    }
    const event = this.runStore.appendEvent(input);
    this.emit({ type: "event", event });
  }

  private setPhase(next: StagePhase): void {
    if (this.phase === next) {
      return;
    }
    const from = this.phase;
    this.phase = next;
    this.log({ type: "phase_changed", data: { from, to: next } });
  }

  private segment(): LiveSegment | null {
    if (this.currentSegmentIndex === null) {
      return null;
    }
    return this.show.segments[this.currentSegmentIndex] ?? null;
  }

  private resolveVisual(
    segment: LiveSegment | null,
    cue: LiveCue | null,
  ): StageVisualState | null {
    const visual = resolveEffectiveVisual(
      {
        cards: this.show.cards,
        materials: this.show.materials,
      },
      segment,
      cue,
    );
    // The tracker owns the server-wide visual sequence, so repeated builds of
    // the same state keep the same sequence.
    return this.visualTracker.update(visual);
  }

  private segmentLabel(segment: LiveSegment | null): { id: string; label: string } | null {
    return segment === null ? null : { id: segment.id, label: segment.label };
  }

  private startCutIn(
    index: number,
    segment: Extract<LiveSegment, { kind: "cut_in" }>,
  ): boolean {
    const cutIn = this.cutInById.get(segment.cutInId);
    if (cutIn === undefined) {
      return false;
    }
    // Starting while another occurrence is active would throw inside the
    // runtime after the mutation below; refuse before touching index/phase.
    if (this.cutInRuntime.hasCurrent) {
      return false;
    }
    // Set the segment and phase before `start`, because its `onStarted`
    // callback publishes state; a missing CutIn must not change either.
    this.currentSegmentIndex = index;
    this.setPhase("cut_in");
    this.cutInRuntime.start(index, segment, cutIn);
    return true;
  }

  private handleCutInStarted(occurrence: CutInOccurrence): void {
    this.runStore?.appendCue({
      event: "cut_in_started",
      cutInId: occurrence.cutIn.id,
      segmentId: occurrence.segment.id,
      label: occurrence.segment.label,
      status: "playing",
      attempt: occurrence.attempt,
      sequence: occurrence.sequence,
    });
    this.log({
      type: "cut_in_started",
      cutInId: occurrence.cutIn.id,
      segmentId: occurrence.segment.id,
      data: { attempt: occurrence.attempt, sequence: occurrence.sequence },
    });
    this.publish();
  }

  private handleCutInFinished(
    occurrence: CutInOccurrence,
    reason: CutInEndReason,
    message?: string,
  ): void {
    const failed = reason === "error" || reason === "watchdog";
    const failureMessage =
      message ?? `CutIn の再生に失敗しました: ${occurrence.cutIn.id}`;
    if (failed) {
      this.runStore?.appendError(failureMessage);
      this.log({
        type: "cut_in_failed",
        cutInId: occurrence.cutIn.id,
        segmentId: occurrence.segment.id,
        data: {
          reason,
          attempt: occurrence.attempt,
          sequence: occurrence.sequence,
          message: failureMessage,
        },
      });
      // A failing CutIn never pauses the show: log and move on.
      this.notice("warning", failureMessage);
    } else {
      this.log({
        type: "cut_in_finished",
        cutInId: occurrence.cutIn.id,
        segmentId: occurrence.segment.id,
        data: {
          reason,
          attempt: occurrence.attempt,
          sequence: occurrence.sequence,
        },
      });
    }
    this.publish();
    this.spine.handleQueueFinished();
  }

  private remainingMs(): number {
    return computeClock(this.show, this.showStartedAtMs, this.now().getTime()).remainingMs;
  }

  getState(): StageState { return this.view.getState(); }
  getSnapshot(): ConsoleSnapshot { return this.view.getSnapshot(); }

  /** Control-plane view: the show may be running while the app is merely ready. */
  getLifecycle(): { phase: StagePhase; started: boolean; ended: boolean } {
    return {
      phase: this.phase,
      started: this.showStartedAtMs !== null,
      ended: this.phase === "post_show",
    };
  }

  getShowMeta() { return buildShowMeta(this.show); }
  getStageConnections(): LiveStageConnection[] { return this.leases.list(); }
  touchPreviewStage(sessionId: string): StageLease | null { return this.leases.touchPreview(sessionId); }
  getStageLease(sessionId: string): StageLease | null { return this.leases.leaseOf(sessionId); }

  getPreloadCues(): LivePreloadCue[] { return this.cueControl.getPreloadCues(); }
  getBufferEstimate(): SegmentBufferEstimate { return this.cueControl.getBufferEstimate(); }

  connectStage(sessionId: string, options: StageConnectOptions = {}): { lease: StageLease; state: StageState } {
    const lease = this.leases.connect(sessionId, options);
    this.publishSnapshot();
    return { lease, state: this.getState() };
  }

  disconnectStage(sessionId: string): void {
    const role = this.leases.roleOf(sessionId);
    this.leases.disconnect(sessionId);
    if (role === "program") {
      this.handleProgramLeaseLost(
        "program ステージが切断されました。コンソールから program を引き継いでください。",
      );
      return;
    }
    this.publishSnapshot();
  }

  private handleProgramLeaseLost(message: string): void {
    if (!ACTIVE_PHASES.has(this.phase)) {
      this.publishSnapshot();
      return;
    }
    this.phaseBeforePause = this.phase;
    this.setPhase("paused");
    this.playout.pause();
    this.cutInRuntime.pause();
    this.comments.pause();
    this.notice("warning", message);
    this.publish();
  }

  handleCommand(command: LiveCommand): CommandResult {
    return dispatchLiveCommand(
      {
        comments: this.comments,
        start: () => this.phaseCommands.start(),
        end: () => this.phaseCommands.end(),
        pause: () => this.phaseCommands.pause(),
        resume: () => this.phaseCommands.resume(),
        stop: () => this.phaseCommands.stop(),
        enterSafeMode: () => this.phaseCommands.enterSafeMode(),
        skipCue: () => this.phaseCommands.skipCue(),
        skipCutIn: () => this.phaseCommands.skipCutIn(),
        takeover: (sessionId) => this.takeover(sessionId),
        cueCommand: (cueCommand) => {
          const result = handleCueCommand(this.cueControl, cueCommand, this.cueCommandHooks);
          return result.ok ? result : this.reject(result.message);
        },
        reject: (message) => this.reject(message),
      },
      command,
    );
  }

  private reject(message: string): CommandResult {
    this.notice("warning", message);
    return { ok: false, message };
  }

  private takeover(sessionId: string): CommandResult {
    const result = this.leases.takeover(sessionId);
    if (!result.ok) {
      return this.reject("program を引き継ぐステージが見つかりません。");
    }
    this.notice("info", "program ステージを引き継ぎました。");
    this.publishSnapshot();
    return { ok: true };
  }

  handleStageEvent(sessionId: string, event: StageEvent): void {
    handleProgramStageEvent(
      {
        runId: this.runId,
        leases: this.leases,
        playout: this.playout,
        cutIn: this.cutInRuntime,
        cardError: (cardError) => this.handleCardError(cardError),
        logIgnored: (ignored, reason) => this.logIgnoredStageEvent(ignored, reason),
      },
      sessionId,
      event,
    );
  }

  /**
   * A card failure never stops the show. The stage already deduplicates per
   * card/state/reason; this second guard covers reconnects and session churn.
   */
  private handleCardError(event: StageEvent): void {
    const rawMessage =
      event.error?.trim() ||
      `カードの表示に失敗しました: ${event.cardId ?? "(unknown)"}/${event.stateId ?? "(unknown)"}`;
    const message =
      rawMessage.length > CARD_ERROR_MESSAGE_LIMIT
        ? rawMessage.slice(0, CARD_ERROR_MESSAGE_LIMIT)
        : rawMessage;
    const key = `${event.cardId ?? ""}:${event.stateId ?? ""}:${message}`;
    if (this.cardErrorNotices.has(key)) {
      return;
    }
    this.cardErrorNotices.add(key);
    // Bound the dedupe memory: a flapping renderer can produce an unlimited
    // number of distinct messages. Evict the oldest insertion first.
    if (this.cardErrorNotices.size > CARD_ERROR_NOTICE_LIMIT) {
      const oldest = this.cardErrorNotices.values().next().value;
      if (oldest !== undefined) {
        this.cardErrorNotices.delete(oldest);
      }
    }
    const data = {
      message,
      cardId: event.cardId ?? null,
      stateId: event.stateId ?? null,
      visualSequence: event.sequence,
    };
    this.runStore?.appendError(message);
    this.log({ type: "error", cueId: event.cueId, data });
    this.notice("warning", message);
  }

  private logIgnoredStageEvent(event: StageEvent, reason: string): void {
    this.runStore?.appendCue({
      event: "stage_event_ignored",
      kind: event.kind,
      cueId: event.cueId,
      ...(event.cutInId === undefined ? {} : { cutInId: event.cutInId }),
      ...(event.segmentId === undefined ? {} : { segmentId: event.segmentId }),
      attempt: event.attempt,
      sequence: event.sequence,
      reason,
    });
  }

  private handlePlayoutEvent(event: PlayoutEvent): void {
    dispatchPlayoutEvent(
      {
        runStore: this.runStore,
        segmentId: () => this.segment()?.id ?? null,
        log: (input) => this.log(input),
        notice: (level, message) => this.notice(level, message),
        publish: () => this.publish(),
        emitPreload: (cues) => this.emit({ type: "preload", cues }),
        pauseForFailure: () => this.pauseForFailure(),
        handleQueueFinished: () => {
          if (this.responsePlayback.consumeQueueFinished()) {
            return;
          }
          this.spine.handleQueueFinished();
        },
      },
      event,
    );
  }

  private pauseForFailure(): void {
    if (this.phase !== "paused") {
      this.phaseBeforePause = this.phase;
      this.setPhase("paused");
    }
  }

  private enterPostShow(): void {
    if (this.phase === "post_show") {
      return;
    }
    this.finalClock = computeClock(this.show, this.showStartedAtMs, this.now().getTime());
    this.currentSegmentIndex = null;
    this.endRequested = false;
    this.phaseBeforePause = null;
    this.cutInRuntime.cancel();
    this.generation = null;
    this.responsePlayback.cancel();
    this.comments.clearStageComment();
    this.comments.stopSources();
    this.comments.interrupt("stop");
    this.playout.setQueue([]);
    this.setPhase("post_show");
    this.publishPreload();
    this.publish();
    if (!this.finished) {
      this.finished = true;
      void this.runStore
        ?.finish({ status: "completed", phase: "post_show" })
        .catch(() => undefined);
    }
  }

  enqueueGeneratedCues(cues: LiveCue[]): void {
    this.cueControl.enqueueGeneratedCues(cues);
  }

  updateCue(cueId: string, patch: LiveCuePatch): boolean {
    return this.cueControl.updateCue(cueId, patch);
  }

  removeCue(cueId: string): boolean {
    return this.cueControl.removeCue(cueId);
  }

  moveCue(cueId: string, beforeCueId: string | null): boolean {
    return this.cueControl.moveCue(cueId, beforeCueId);
  }

  getCue(cueId: string): LiveCue | null {
    return this.cueControl.getCue(cueId);
  }

  getUpcomingCues(limit: number): LiveCue[] {
    return this.cueControl.getUpcomingCues(limit);
  }

  /** Installs the generated-cue edit/regenerate service (P5b2 console). */
  setGeneratedCueCommands(commands: GeneratedCueCommands | null): void {
    this.generatedCueCommands = commands;
  }

  getCurrentSegment(): LiveSegment | null {
    return this.segment();
  }

  /** The cue currently playing (or waiting to play) in the playout. */
  getCurrentCue(): LiveCue | null {
    return this.playout.current;
  }

  getGeneration(): LiveGenerationStatus | null {
    return this.generation;
  }

  setGeneration(status: LiveGenerationStatus | null): void {
    this.generation = status;
    this.publishSnapshot();
  }

  notify(level: LiveNoticeLevel, message: string): void {
    this.notice(level, message);
  }

  /** Installs and starts a comment-corner response queue. Returns its serial. */
  playResponseCues(cues: LiveCue[]): number {
    if (this.isResponseStopped() || this.phase === "paused") {
      return this.responsePlayback.start([]);
    }
    return this.responsePlayback.start(cues);
  }

  /**
   * Plays a correction with no response waiter. `queue_finished` advances the
   * spine normally, which matches "play the correction, then return to the
   * spine". Used when no cue is current.
   */
  playCorrectionResponse(cues: LiveCue[]): boolean {
    const index = this.currentSegmentIndex;
    if (
      index === null ||
      cues.length === 0 ||
      this.show.segments[index]?.kind !== "comment" ||
      this.phase === "paused" ||
      this.phase === "post_show" ||
      this.phase === "error"
    ) {
      return false;
    }
    this.responsePlayback.cancel();
    const pending = this.queues.forSegment(index) ?? [];
    for (const cue of pending) {
      if (cue.status !== "done" && cue.status !== "skipped" && cue.status !== "failed") {
        this.log({ type: "cue_deleted", cueId: cue.id, data: { reason: "correction" } });
      }
    }
    this.queues.setForSegment(index, cues);
    const installed = this.queues.forSegment(index) ?? cues;
    this.playout.setQueue(installed);
    this.playout.start();
    this.publishPreload();
    this.publish();
    return true;
  }

  endResponseCues(serial: number): void {
    this.responsePlayback.end(serial);
  }

  cancelResponseCues(): void {
    this.responsePlayback.cancel();
  }

  isResponseStopped(): boolean {
    return (
      this.safeMode ||
      this.phase === "post_show" ||
      this.phase === "error" ||
      this.currentSegmentIndex === null
    );
  }

  /** Public log hook for collaborators (the comment corner) wired before construction. */
  recordEvent(input: RunLogEventInput): void {
    this.log(input);
  }

  dispose(): void {
    this.playout.dispose();
    this.cutInRuntime.dispose();
    this.comments.dispose();
  }
}
