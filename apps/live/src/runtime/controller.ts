import type {
  ConsoleSnapshot,
  LiveCharacterSheet,
  LiveCommand,
  LiveCue,
  LivePackageShow,
  LivePreloadCue,
  LiveSegment,
  LiveStageConnection,
  LiveNoticeLevel,
  RunLogEvent,
  StageClock,
  StageEvent,
  StageLease,
  StagePhase,
  StageState,
} from "@kakeai/contracts";
import type { RunLogEventInput, RunStore } from "../runs/run-store.ts";
import type { SegmentBufferEstimate } from "./buffer.ts";
import type { CommentCorner } from "./comment-corner.ts";
import { CommentRuntime } from "./comment-runtime.ts";
import { dispatchLiveCommand, type CommandResult } from "./command-dispatch.ts";
import { ControllerView } from "./controller-view.ts";
import { CueControl, type LiveCuePatch } from "./control-queue.ts";
import { StageLeaseManager, type StageConnectOptions } from "./lease.ts";
import { Playout, type PlayoutEvent, type PlayoutScheduler } from "./playout.ts";
import { dispatchPlayoutEvent } from "./playout-events.ts";
import { CueQueueStore } from "./queue.ts";
import { ACTIVE_PHASES } from "./segments.ts";
import { Spine } from "./spine.ts";
import { handleProgramStageEvent } from "./stage-events.ts";
import { buildShowMeta, computeClock } from "./state.ts";

export type { LiveCuePatch } from "./control-queue.ts";

export type LiveControllerChange =
  | { type: "state"; state: StageState }
  | { type: "snapshot"; snapshot: ConsoleSnapshot }
  | { type: "preload"; cues: LivePreloadCue[] }
  | { type: "event"; event: RunLogEvent }
  | { type: "notice"; level: LiveNoticeLevel; message: string };

export type { CommandResult } from "./command-dispatch.ts";

export interface LiveControllerOptions {
  runId: string;
  show: LivePackageShow;
  characters: LiveCharacterSheet;
  runStore?: RunStore;
  now?: () => Date;
  leaseTtlMs?: number;
  playoutScheduler?: PlayoutScheduler;
  /** Comment corner implementation. Omit to skip comment segments. */
  comments?: CommentCorner;
}

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
  private readonly materialById = new Map<string, LivePackageShow["materials"][number]>();
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
    });
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
        start: () => this.start(),
        end: () => this.end(),
        pause: () => this.pause(),
        resume: () => this.resume(),
        stop: () => this.stop(),
        enterSafeMode: () => this.enterSafeMode(),
        skipCue: () => this.skipCue(),
        takeover: (sessionId) => this.takeover(sessionId),
        reject: (message) => this.reject(message),
      },
      command,
    );
  }

  private reject(message: string): CommandResult {
    this.notice("warning", message);
    return { ok: false, message };
  }

  private start(): CommandResult {
    const canStart =
      this.phase === "pre_show" ||
      (this.phase === "safe_mode" && this.showStartedAtMs === null);
    if (!canStart) {
      return this.reject("開始できるのは pre_show のときだけです。");
    }
    this.showStartedAtMs = this.now().getTime();
    this.finalClock = null;
    this.endRequested = false;
    this.comments.startSources();
    this.spine.enterSegment(0);
    return { ok: true };
  }

  private end(): CommandResult {
    if (this.phase === "post_show" || this.phase === "pre_show" || this.phase === "error") {
      return this.reject("終了できる状態ではありません。");
    }
    if (this.showStartedAtMs === null) {
      return this.reject("まだ開始していません。");
    }
    if (this.segment()?.kind === "closing") {
      this.enterPostShow();
      return { ok: true };
    }
    if (this.phase === "paused") {
      this.endRequested = false;
      this.comments.interrupt("skip");
      this.spine.enterClosing();
      return { ok: true };
    }
    this.endRequested = true;
    this.notice("info", "現在のキューの終了後にクロージングへ進みます。");
    return { ok: true };
  }

  private pause(): CommandResult {
    if (!ACTIVE_PHASES.has(this.phase) || this.showStartedAtMs === null) {
      return this.reject("一時停止できる状態ではありません。");
    }
    this.phaseBeforePause = this.phase;
    this.setPhase("paused");
    this.playout.pause();
    this.comments.pause();
    this.publish();
    return { ok: true };
  }

  private resume(): CommandResult {
    if (this.phase !== "paused") {
      return this.reject("再開できる状態ではありません。");
    }
    if (
      this.safeMode &&
      this.segment()?.kind === "comment" &&
      !this.comments.isActive()
    ) {
      // Safe mode ended the corner while paused. On resume continue at the
      // next non-comment segment instead of waiting for a corner callback.
      this.setPhase("safe_mode");
      this.log({ type: "resumed" });
      this.spine.handleQueueFinished();
      this.publish();
      return { ok: true };
    }
    const resumePhase = this.safeMode ? "safe_mode" : (this.phaseBeforePause ?? "script");
    this.setPhase(resumePhase);
    this.playout.resume();
    this.comments.resume();
    this.log({
      type: "resumed",
      ...(this.playout.current === null ? {} : { cueId: this.playout.current.id }),
    });
    this.publish();
    return { ok: true };
  }

  private stop(): CommandResult {
    if (
      this.phase === "pre_show" ||
      this.phase === "post_show" ||
      this.phase === "error" ||
      this.showStartedAtMs === null
    ) {
      return this.reject("停止できる状態ではありません。");
    }
    const currentCueId = this.playout.current?.id ?? null;
    if (this.phase !== "paused") {
      this.phaseBeforePause = this.phase;
    }
    this.setPhase("paused");
    this.playout.stop();
    this.comments.pause();
    const removed = [
      ...this.playout.discardGeneratedCues({ continuePlaying: false }),
      ...this.queues.removeWhere(
        (cue) => cue.source === "generated" || cue.source === "manual",
      ),
    ];
    for (const cue of removed) {
      this.log({ type: "cue_deleted", cueId: cue.id, data: { reason: "stop" } });
    }
    this.log({
      type: "stopped",
      ...(currentCueId === null ? {} : { cueId: currentCueId }),
    });
    this.publishPreload();
    this.publish();
    return { ok: true };
  }

  private enterSafeMode(): CommandResult {
    if (this.phase === "post_show" || this.phase === "error" || this.phase === "safe_mode") {
      return this.reject("安全モードへ移行できる状態ではありません。");
    }
    // v1 has no exit command: once the operator enters safe mode, prepared
    // cues continue safely until the show ends.
    this.safeMode = true;
    this.log({
      type: "safe_mode",
      ...(this.playout.current === null ? {} : { cueId: this.playout.current.id }),
    });
    const paused = this.phase === "paused";
    const cornerWasActive = this.comments.interrupt("safe_mode") ?? false;
    if (paused) {
      this.playout.stop();
    } else {
      this.setPhase("safe_mode");
    }
    const removed = [
      ...this.playout.discardGeneratedCues({ continuePlaying: !paused }),
      ...this.queues.removeWhere(
        (cue) => cue.source === "generated" || cue.source === "manual",
      ),
    ];
    for (const cue of removed) {
      this.log({ type: "cue_deleted", cueId: cue.id, data: { reason: "safe_mode" } });
    }
    this.publishPreload();
    this.publish();
    if (cornerWasActive && !paused) {
      this.spine.handleQueueFinished();
    }
    return { ok: true };
  }

  private skipCue(): CommandResult {
    if (this.phase === "pre_show" || this.phase === "post_show" || this.phase === "error") {
      return this.reject("スキップできる状態ではありません。");
    }
    if (this.segment()?.kind === "comment" && this.comments.isActive() === true) {
      const currentCommentId = this.comments.getCurrentCommentId();
      if (currentCommentId !== null) {
        const result = this.comments.handleCommand({
          kind: "skip_comment",
          commentId: currentCommentId,
        });
        return result.ok ? { ok: true } : this.reject(result.message);
      }
      this.comments.interrupt("skip");
      this.spine.handleQueueFinished();
      return { ok: true };
    }
    if (this.playout.current === null) {
      return this.reject("スキップするキューがありません。");
    }
    if (!this.playout.skipCurrent()) {
      return this.reject("スキップできませんでした。");
    }
    this.publishPreload();
    this.publish();
    return { ok: true };
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
        handleQueueFinished: () => this.spine.handleQueueFinished(),
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

  /** Public log hook for collaborators (the comment corner) wired before construction. */
  recordEvent(input: RunLogEventInput): void {
    this.log(input);
  }

  dispose(): void {
    this.playout.dispose();
    this.comments.dispose();
  }
}
