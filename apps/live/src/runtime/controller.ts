import type {
  ConsoleSnapshot,
  LiveCharacterSheet,
  LiveCommand,
  LiveCue,
  LiveGenerationStatus,
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

export type { LiveCuePatch } from "./control-queue.ts";
export type { LiveControllerChange, LiveControllerOptions } from "./controller-types.ts";
export type { CommandResult } from "./command-dispatch.ts";

/**
 * Single owner of live state. Stages only render `StageState` and report audio
 * events; every phase, segment and cue transition happens here. Playout is
 * event-driven: a timer is only a watchdog or the bounded "thinking" poll.
 */
export class LiveController {
  readonly runId: string;
  private readonly show: LivePackageShow;
  private readonly characters: LiveCharacterSheet;
  private readonly runStore: RunStore | undefined;
  private readonly now: () => Date;
  private readonly leases: StageLeaseManager;
  private readonly listeners = new Set<(change: LiveControllerChange) => void>();
  private readonly playout: Playout;
  private readonly queues: CueQueueStore;
  private readonly cueControl: CueControl;
  private readonly spine: Spine;
  private readonly comments: CommentRuntime;
  private readonly view: ControllerView;
  private readonly responsePlayback: ResponsePlayback;
  private readonly phaseCommands: PhaseCommands;
  private readonly materialById = new Map<string, LivePackageShow["materials"][number]>();
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
      characters: this.characters,
      playout: this.playout,
      queues: this.queues,
      leases: this.leases,
      comments: this.comments,
      phase: () => this.phase,
      segment: () => this.segment(),
      segmentLabel: (segment) => this.segmentLabel(segment),
      materialForSegment: (segment) => this.segmentMaterial(segment),
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
      hasMaterial: (segment) => this.segmentMaterial(segment) !== null,
      enterPostShow: () => this.enterPostShow(),
      hasCommentCorner: () => this.comments.enabled,
      startCommentCorner: (segment) => this.comments.startCorner(segment),
    });
    for (const material of this.show.materials) {
      this.materialById.set(material.id, material);
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

  private segmentMaterial(segment: LiveSegment) {
    if (segment.material === undefined) {
      return null;
    }
    return this.materialById.get(segment.material) ?? null;
  }

  private segmentLabel(segment: LiveSegment | null): { id: string; label: string } | null {
    return segment === null ? null : { id: segment.id, label: segment.label };
  }

  private remainingMs(): number {
    return computeClock(this.show, this.showStartedAtMs, this.now().getTime()).remainingMs;
  }

  getState(): StageState { return this.view.getState(); }
  getSnapshot(): ConsoleSnapshot { return this.view.getSnapshot(); }

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
        logIgnored: (ignored, reason) => this.logIgnoredStageEvent(ignored, reason),
      },
      sessionId,
      event,
    );
  }

  private logIgnoredStageEvent(event: StageEvent, reason: string): void {
    this.runStore?.appendCue({
      event: "stage_event_ignored",
      kind: event.kind,
      cueId: event.cueId,
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
    this.comments.dispose();
  }
}
