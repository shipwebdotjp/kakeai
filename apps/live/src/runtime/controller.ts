import type {
  ConsoleSnapshot,
  LiveCharacterSheet,
  LiveCommand,
  LiveCue,
  LivePackageShow,
  LiveSegment,
  LiveStageConnection,
  LiveNoticeLevel,
  RunLogEvent,
  StageEvent,
  StageLease,
  StagePhase,
  StageState,
} from "@kakeai/contracts";
import type { RunLogEventInput, RunStore } from "../runs/run-store.ts";
import { StageLeaseManager } from "./lease.ts";
import { Playout, type PlayoutEvent } from "./playout.ts";
import { buildConsoleSnapshot, buildShowMeta, buildStageState, computeClock } from "./state.ts";

export type LiveControllerChange =
  | { type: "state"; state: StageState }
  | { type: "snapshot"; snapshot: ConsoleSnapshot }
  | { type: "event"; event: RunLogEvent }
  | { type: "notice"; level: LiveNoticeLevel; message: string };

export type CommandResult = { ok: true } | { ok: false; message: string };

export interface LiveControllerOptions {
  runId: string;
  show: LivePackageShow;
  characters: LiveCharacterSheet;
  runStore?: RunStore;
  now?: () => Date;
  leaseTtlMs?: number;
}

const ACTIVE_PHASES: ReadonlySet<StagePhase> = new Set([
  "opening",
  "script",
  "material",
  "comment",
  "closing",
  "safe_mode",
]);

/**
 * Single owner of live state. Stages only render `StageState` and (in P3)
 * report audio events; every phase and cue transition happens here. Playout
 * timing is isolated in `Playout` so P3 can switch from timers to
 * `audio_ended` without rewriting phase logic.
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
  private readonly segmentQueues = new Map<string, LiveCue[]>();
  private readonly materialById = new Map<string, LivePackageShow["materials"][number]>();
  private readonly flatQueue: LiveCue[] = [];
  private phase: StagePhase = "pre_show";
  private phaseBeforePause: StagePhase | null = null;
  private currentSegmentIndex: number | null = null;
  private showStartedAtMs: number | null = null;
  private endRequested = false;
  private safeMode = false;
  private lastStageSequence = -1;
  private finished = false;

  constructor(options: LiveControllerOptions) {
    this.runId = options.runId;
    this.show = options.show;
    this.characters = options.characters;
    this.runStore = options.runStore;
    this.now = options.now ?? (() => new Date());
    this.leases = new StageLeaseManager(options.runId, {
      now: this.now,
      ...(options.leaseTtlMs === undefined ? {} : { ttlMs: options.leaseTtlMs }),
      onProgramExpired: () => {
        this.handleProgramLeaseLost(
          "program ステージのリースが失効しました。コンソールから program を引き継いでください。",
        );
      },
    });
    this.playout = new Playout((event) => this.handlePlayoutEvent(event));
    this.buildQueues();
    for (const material of this.show.materials) {
      this.materialById.set(material.id, material);
    }
  }

  private buildQueues(): void {
    const cueById = new Map(this.show.cues.map((cue) => [cue.id, cue]));
    for (const segment of this.show.segments) {
      if (!("cues" in segment)) {
        continue;
      }
      const cues: LiveCue[] = [];
      for (const cueId of segment.cues) {
        const prepared = cueById.get(cueId);
        if (prepared === undefined) {
          continue;
        }
        cues.push({
          ...prepared,
          source: "prepared",
          status: "ready",
          commentId: null,
        });
      }
      this.segmentQueues.set(segment.id, cues);
      this.flatQueue.push(...cues);
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

  private segmentPhase(segment: LiveSegment): StagePhase {
    switch (segment.kind) {
      case "opening":
      case "closing":
      case "comment":
        return segment.kind;
      case "script":
        return this.segmentMaterial(segment)?.focus === true ? "material" : "script";
      default: {
        const exhaustive: never = segment;
        throw new Error(`Unsupported live segment kind: ${JSON.stringify(exhaustive)}`);
      }
    }
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

  private stageStatus(): "idle" | "thinking" | "speaking" {
    const cue = this.playout.current;
    return cue === null || cue.audio === null ? "idle" : "speaking";
  }

  getState(): StageState {
    const segment = this.segment();
    return buildStageState({
      show: this.show,
      characters: this.characters,
      phase: this.phase,
      segment: this.segmentLabel(segment),
      cue: this.playout.current,
      attempt: this.playout.currentAttempt,
      cueStartedAt: this.playout.currentStartedAt,
      material: segment === null ? null : this.segmentMaterial(segment),
      comment: null,
      status: this.stageStatus(),
      clock: computeClock(this.show, this.showStartedAtMs, this.now().getTime()),
    });
  }

  getSnapshot(): ConsoleSnapshot {
    const segment = this.segment();
    const state = this.getState();
    return buildConsoleSnapshot({
      runId: this.runId,
      show: this.show,
      phase: this.phase,
      segment: this.segmentLabel(segment),
      stages: this.leases.list(),
      queue: this.flatQueue.map((cue) => ({ ...cue })),
      currentCueId: this.playout.current?.id ?? null,
      playback: state.playback,
      status: state.status,
      clock: state.clock,
    });
  }

  getShowMeta() {
    return buildShowMeta(this.show);
  }

  getStageConnections(): LiveStageConnection[] {
    return this.leases.list();
  }

  connectStage(sessionId: string): { lease: StageLease; state: StageState } {
    const lease = this.leases.connect(sessionId);
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
    if (!ACTIVE_PHASES.has(this.phase) || this.playout.current === null) {
      this.publishSnapshot();
      return;
    }
    this.phaseBeforePause = this.phase;
    this.setPhase("paused");
    this.playout.pause();
    this.notice("warning", message);
    this.publish();
  }

  handleCommand(command: LiveCommand): CommandResult {
    switch (command.kind) {
      case "start":
        return this.start();
      case "end":
        return this.end();
      case "pause":
        return this.pause();
      case "resume":
        return this.resume();
      case "stop":
        return this.stop();
      case "safe_mode":
        return this.enterSafeMode();
      case "takeover_program":
        return this.takeover(command.sessionId);
      default: {
        const exhaustive: never = command;
        throw new Error(`Unsupported live command: ${JSON.stringify(exhaustive)}`);
      }
    }
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
    this.endRequested = false;
    this.enterSegment(0);
    return { ok: true };
  }

  private end(): CommandResult {
    if (this.phase === "post_show" || this.phase === "pre_show") {
      return this.reject("終了できる状態ではありません。");
    }
    if (this.phase === "paused") {
      this.endRequested = false;
      this.enterClosing();
      return { ok: true };
    }
    this.endRequested = true;
    this.notice("info", "現在のキューの終了後にクロージングへ進みます。");
    return { ok: true };
  }

  private pause(): CommandResult {
    if (!ACTIVE_PHASES.has(this.phase)) {
      return this.reject("一時停止できる状態ではありません。");
    }
    this.phaseBeforePause = this.phase;
    this.setPhase("paused");
    this.playout.pause();
    this.publish();
    return { ok: true };
  }

  private resume(): CommandResult {
    if (this.phase !== "paused") {
      return this.reject("再開できる状態ではありません。");
    }
    const resumePhase = this.phaseBeforePause ?? "script";
    this.setPhase(resumePhase);
    this.playout.resume();
    this.log({ type: "resumed", ...(this.playout.current === null ? {} : { cueId: this.playout.current.id }) });
    this.publish();
    return { ok: true };
  }

  private stop(): CommandResult {
    if (this.phase === "post_show") {
      return this.reject("停止できる状態ではありません。");
    }
    if (this.phase !== "paused") {
      this.phaseBeforePause = this.phase;
    }
    this.setPhase("paused");
    this.playout.stop();
    this.log({ type: "stopped", ...(this.playout.current === null ? {} : { cueId: this.playout.current.id }) });
    this.publish();
    return { ok: true };
  }

  private enterSafeMode(): CommandResult {
    if (this.phase === "paused" || this.phase === "post_show" || this.phase === "safe_mode") {
      return this.reject("安全モードへ移行できる状態ではありません。");
    }
    // v1 has no exit command: once the operator enters safe mode, prepared
    // cues continue safely until the show ends.
    this.safeMode = true;
    this.setPhase("safe_mode");
    this.log({ type: "safe_mode", ...(this.playout.current === null ? {} : { cueId: this.playout.current.id }) });
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
    if (this.leases.roleOf(sessionId) !== "program") {
      return;
    }
    if (event.runId !== this.runId || event.sessionId !== sessionId) {
      return;
    }
    if (event.kind === "stage_heartbeat") {
      this.leases.touch(sessionId);
      return;
    }
    if (event.kind === "stage_ready") {
      return;
    }
    // Any valid event from the program proves the stage is alive.
    this.leases.touch(sessionId);
    if (this.phase === "paused" || this.phase === "pre_show" || this.phase === "post_show") {
      return;
    }
    const cue = this.playout.current;
    if (cue === null || event.cueId !== cue.id || event.attempt !== this.playout.currentAttempt) {
      return;
    }
    if (event.sequence <= this.lastStageSequence) {
      return;
    }
    this.lastStageSequence = event.sequence;
    if (event.kind === "audio_error") {
      // P2 has no retry/watchdog policy yet: an audio failure fails the cue
      // forward so the spine keeps moving. P3 adds retry/backoff here.
      cue.status = "failed";
      const message = event.error ?? `音声の再生に失敗しました: ${cue.id}`;
      this.log({ type: "error", cueId: cue.id, data: { message } });
      this.runStore?.appendError(message);
      this.notice("error", message);
    }
    this.playout.advance();
  }

  private handlePlayoutEvent(event: PlayoutEvent): void {
    switch (event.type) {
      case "cue_started":
        // StageEvent.sequence is scoped to the current cue attempt.
        this.lastStageSequence = -1;
        event.cue.status = "playing";
        this.runStore?.appendCue({
          cueId: event.cue.id,
          status: "playing",
          attempt: event.attempt,
          segmentId: this.segment()?.id ?? null,
        });
        this.publish();
        return;
      case "cue_finished":
        if (event.cue.status !== "failed") {
          event.cue.status = "done";
        }
        this.runStore?.appendCue({
          cueId: event.cue.id,
          status: event.cue.status,
          attempt: event.attempt,
          reason: event.reason,
        });
        this.publish();
        return;
      case "queue_finished":
        this.handleQueueFinished();
        return;
      default: {
        const exhaustive: never = event;
        throw new Error(`Unsupported playout event: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  private handleQueueFinished(): void {
    const segment = this.segment();
    if (segment?.kind === "closing") {
      this.enterPostShow();
      return;
    }
    if (this.endRequested) {
      this.endRequested = false;
      this.enterClosing();
      return;
    }
    this.enterSegment((this.currentSegmentIndex ?? 0) + 1);
  }

  private enterSegment(startIndex: number): void {
    for (let index = startIndex; index < this.show.segments.length; index += 1) {
      const segment = this.show.segments[index];
      if (segment === undefined || segment.kind === "comment") {
        // Comment corners arrive in P4; the spine skips them for now.
        continue;
      }
      const cues = this.segmentQueues.get(segment.id) ?? [];
      if (cues.length === 0) {
        continue;
      }
      this.currentSegmentIndex = index;
      this.setPhase(this.safeMode ? "safe_mode" : this.segmentPhase(segment));
      this.playout.setQueue(cues);
      this.playout.start();
      return;
    }
    this.enterPostShow();
  }

  private enterClosing(): void {
    const index = this.show.segments.findIndex((segment) => segment.kind === "closing");
    if (index === -1) {
      this.enterPostShow();
      return;
    }
    const segment = this.show.segments[index]!;
    const cues = this.segmentQueues.get(segment.id) ?? [];
    if (cues.length === 0) {
      this.enterPostShow();
      return;
    }
    this.currentSegmentIndex = index;
    this.setPhase(this.safeMode ? "safe_mode" : "closing");
    this.playout.setQueue(cues);
    this.playout.start();
  }

  private enterPostShow(): void {
    if (this.phase === "post_show") {
      return;
    }
    this.currentSegmentIndex = null;
    this.endRequested = false;
    this.playout.setQueue([]);
    this.setPhase("post_show");
    this.publish();
    if (!this.finished) {
      this.finished = true;
      void this.runStore
        ?.finish({ status: "completed", phase: "post_show" })
        .catch(() => undefined);
    }
  }

  dispose(): void {
    this.playout.dispose();
  }
}
