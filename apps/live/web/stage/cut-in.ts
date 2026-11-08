import type { StageCutIn as StageCutInState, StageState } from "@kakeai/contracts";
import { packageUrl } from "./elements";

/** Positions shorter than this are treated as "start from the top". */
const SEEK_THRESHOLD_MS = 250;
/** A program handoff only seeks when the drift is audible/visible. */
const HANDOFF_SEEK_TOLERANCE_MS = 500;
/** Metadata that never arrives must not leave `pendingStart` stuck forever. */
const PENDING_LOAD_TIMEOUT_MS = 8000;

export interface StageCutInEvent {
  kind: "cut_in_ended" | "cut_in_error";
  cutInId: string;
  segmentId: string;
  attempt: number;
  sequence: number;
  positionMs?: number;
  error?: string;
}

export interface StageCutInOptions {
  /** Preview stages play muted and never report events. */
  isProgram: () => boolean;
  send: (event: StageCutInEvent) => void;
  now?: () => number;
}

function identityOf(cutIn: StageCutInState): string {
  return `${cutIn.segmentId}:${cutIn.attempt}:${cutIn.sequence}`;
}

function describeError(error: unknown): string {
  if (error instanceof DOMException) {
    return error.message === "" ? error.name : error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string" && error !== "") {
    return error;
  }
  return "CutIn の再生に失敗しました。";
}

/**
 * Owns the stage's dedicated CutIn `<video>`. Unlike a material card it is not
 * looped or permanently muted: the program stage plays `hasAudio` CutIns with
 * sound, while preview stays muted. `segmentId`/`attempt`/`sequence` identify
 * one occurrence, so ordinary re-renders never restart playback.
 */
export class StageCutIn {
  private readonly isProgram: () => boolean;
  private readonly send: (event: StageCutInEvent) => void;
  private readonly now: () => number;
  private current: StageCutInState | null = null;
  private currentIdentity: string | null = null;
  private terminal: "ended" | "error" | null = null;
  private paused = false;
  private pendingStart = false;
  private generation = 0;
  private pendingTimer: number | null = null;
  private pendingMetadataHandler: (() => void) | null = null;

  constructor(
    private readonly layer: HTMLElement,
    private readonly video: HTMLVideoElement,
    options: StageCutInOptions,
  ) {
    this.isProgram = options.isProgram;
    this.send = options.send;
    this.now = options.now ?? (() => Date.now());
    this.video.playsInline = true;
    this.video.loop = false;
    this.video.muted = true;
    this.video.addEventListener("ended", this.handleEnded);
    this.video.addEventListener("error", this.handleError);
  }

  render(state: StageState): void {
    const cutIn = state.cutIn;
    if (cutIn === null) {
      this.release();
      return;
    }
    this.paused = state.phase === "paused";
    const identity = identityOf(cutIn);
    if (identity !== this.currentIdentity) {
      this.start(cutIn, identity);
      return;
    }
    if (this.terminal !== null) {
      return;
    }
    if (this.paused) {
      this.clearPendingTimeout();
      this.clearMetadataHandler();
      this.video.pause();
      this.layer.hidden = false;
      return;
    }
    if (this.video.paused && !this.pendingStart) {
      this.play(this.generation);
    }
  }

  /**
   * Applies a lease change without restarting the occurrence. A preview stage
   * that becomes program keeps its already-playing element and only unmutes
   * (plus seeks if it drifted too far).
   */
  setProgram(program: boolean): void {
    const cutIn = this.current;
    if (cutIn === null || this.currentIdentity === null || this.terminal !== null) {
      return;
    }
    this.video.muted = !(program && cutIn.hasAudio);
    if (!program) {
      return;
    }
    const elapsed = this.elapsedMs(cutIn);
    if (elapsed >= cutIn.durationMs) {
      this.finishEnded(cutIn.durationMs);
      return;
    }
    const currentMs = Number.isFinite(this.video.currentTime)
      ? this.video.currentTime * 1000
      : 0;
    if (Math.abs(currentMs - elapsed) > HANDOFF_SEEK_TOLERANCE_MS) {
      this.generation += 1;
      this.pendingStart = true;
      this.seekAndPlay(this.generation, elapsed);
      return;
    }
    this.play(this.generation);
  }

  dispose(): void {
    this.generation += 1;
    this.clearPendingTimeout();
    this.clearMetadataHandler();
    this.video.removeEventListener("ended", this.handleEnded);
    this.video.removeEventListener("error", this.handleError);
    this.currentIdentity = null;
    this.current = null;
    this.terminal = null;
    this.pendingStart = false;
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.layer.hidden = true;
  }

  private start(cutIn: StageCutInState, identity: string): void {
    this.generation += 1;
    this.clearPendingTimeout();
    this.clearMetadataHandler();
    const generation = this.generation;
    this.current = cutIn;
    this.currentIdentity = identity;
    this.terminal = null;
    this.video.muted = !(this.isProgram() && cutIn.hasAudio);

    const elapsed = this.elapsedMs(cutIn);
    if (elapsed >= cutIn.durationMs) {
      // The occurrence finished while this stage was away. Reporting it is
      // cheaper and safer than replaying from the top.
      this.finishEnded(cutIn.durationMs);
      return;
    }

    const url = packageUrl(cutIn.file);
    if (this.video.getAttribute("src") !== url) {
      this.video.src = url;
    }
    this.layer.hidden = false;
    this.pendingStart = true;
    const targetMs = elapsed > SEEK_THRESHOLD_MS ? Math.min(elapsed, cutIn.durationMs) : 0;
    this.seekAndPlay(generation, targetMs);
  }

  /**
   * Seeks once metadata is available, then plays if the occurrence is not
   * paused. Metadata may not have arrived yet on a reconnect or a fresh source.
   */
  private seekAndPlay(generation: number, targetMs: number): void {
    const video = this.video;
    const prepare = () => {
      if (generation !== this.generation || this.terminal !== null) {
        return;
      }
      this.clearPendingTimeout();
      this.clearMetadataHandler();
      try {
        video.currentTime = targetMs / 1000;
      } catch {
        // Metadata is still pending; play() below starts from the browser's
        // default position and the next render can retry.
      }
      this.pendingStart = false;
      if (!this.paused) {
        this.play(generation);
      }
    };
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      prepare();
      return;
    }
    this.clearMetadataHandler();
    const handler = () => {
      this.clearMetadataHandler();
      prepare();
    };
    this.pendingMetadataHandler = handler;
    this.armPendingTimeout(generation);
    video.addEventListener("loadedmetadata", handler, { once: true });
  }

  /**
   * Fails the occurrence when metadata never arrives. The generation guard
   * keeps a timeout from a replaced identity from touching the new one.
   */
  private armPendingTimeout(generation: number): void {
    this.clearPendingTimeout();
    this.pendingTimer = window.setTimeout(() => {
      this.pendingTimer = null;
      if (
        generation !== this.generation ||
        !this.pendingStart ||
        this.terminal !== null
      ) {
        return;
      }
      this.pendingStart = false;
      this.fail("CutIn の読み込みがタイムアウトしました。");
    }, PENDING_LOAD_TIMEOUT_MS);
  }

  private clearPendingTimeout(): void {
    if (this.pendingTimer !== null) {
      window.clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  private clearMetadataHandler(): void {
    if (this.pendingMetadataHandler !== null) {
      this.video.removeEventListener("loadedmetadata", this.pendingMetadataHandler);
      this.pendingMetadataHandler = null;
    }
  }

  private play(generation: number): void {
    if (generation !== this.generation || this.terminal !== null || this.paused) {
      return;
    }
    const started = this.video.play();
    if (started === undefined) {
      return;
    }
    started.catch((error: unknown) => {
      if (generation !== this.generation || this.terminal !== null) {
        return;
      }
      // A pause/unload interrupts play() with AbortError; that is not a
      // CutIn failure and must not advance the spine.
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      this.fail(error);
    });
  }

  private finishEnded(positionMs: number): void {
    if (this.currentIdentity === null || this.terminal !== null) {
      return;
    }
    this.terminal = "ended";
    this.pendingStart = false;
    this.clearPendingTimeout();
    this.clearMetadataHandler();
    this.video.pause();
    this.layer.hidden = true;
    this.emit({ kind: "cut_in_ended", positionMs });
  }

  private fail(error: unknown): void {
    if (this.currentIdentity === null || this.terminal !== null) {
      return;
    }
    this.terminal = "error";
    this.pendingStart = false;
    this.clearPendingTimeout();
    this.clearMetadataHandler();
    this.video.pause();
    this.layer.hidden = true;
    this.emit({ kind: "cut_in_error", error: describeError(error) });
  }

  private readonly handleEnded = (): void => {
    if (this.currentIdentity === null || this.terminal !== null) {
      return;
    }
    const positionMs =
      Number.isFinite(this.video.currentTime) && this.video.currentTime > 0
        ? Math.round(this.video.currentTime * 1000)
        : (this.current?.durationMs ?? 0);
    this.finishEnded(positionMs);
  };

  private readonly handleError = (): void => {
    if (this.currentIdentity === null || this.terminal !== null) {
      return;
    }
    // `release()` clears the identity before unloading, so an empty source
    // never reaches this handler.
    if (this.video.getAttribute("src") === null) {
      return;
    }
    this.fail(this.video.error ?? "CutIn を読み込めませんでした。");
  };

  private release(): void {
    const hadSource = this.currentIdentity !== null || this.video.getAttribute("src") !== null;
    this.clearPendingTimeout();
    this.clearMetadataHandler();
    this.layer.hidden = true;
    if (!hadSource) {
      return;
    }
    this.generation += 1;
    // Clear the identity first so the intentional unload cannot be mistaken
    // for a media error.
    this.currentIdentity = null;
    this.current = null;
    this.terminal = null;
    this.pendingStart = false;
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
  }

  private emit(event: {
    kind: "cut_in_ended" | "cut_in_error";
    positionMs?: number;
    error?: string;
  }): void {
    const cutIn = this.current;
    if (cutIn === null || !this.isProgram()) {
      return;
    }
    this.send({
      kind: event.kind,
      cutInId: cutIn.cutInId,
      segmentId: cutIn.segmentId,
      attempt: cutIn.attempt,
      sequence: cutIn.sequence,
      ...(event.positionMs === undefined ? {} : { positionMs: event.positionMs }),
      ...(event.error === undefined ? {} : { error: event.error }),
    });
  }

  private elapsedMs(cutIn: StageCutInState): number {
    const startedAt = Date.parse(cutIn.startedAt);
    if (Number.isNaN(startedAt)) {
      return 0;
    }
    return Math.max(0, this.now() - startedAt);
  }
}
