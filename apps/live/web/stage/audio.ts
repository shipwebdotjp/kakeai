import type { LivePreloadCue, StagePhase, StagePlayback } from "@kakeai/contracts";
import { FADE_OUT_DURATION_MS, fadeOutVolume, shouldFadeOut } from "../../src/runtime/audio-fade.ts";
import { resolvePlaybackStart } from "../../src/runtime/audio-start.ts";
import { audioUrlForStage } from "../../src/shared/audio-url.ts";

export interface StageAudioEvent {
  kind: "audio_ended" | "audio_error";
  playback: StagePlayback;
  error?: string;
}

export interface StageAudioOptions {
  /** Preview stages play muted and never report events. */
  isProgram: () => boolean;
  send: (event: StageAudioEvent) => void;
  now?: () => number;
}

interface ActivePlayback {
  key: string;
  playback: StagePlayback;
  audio: HTMLAudioElement;
  onEnded: () => void;
  onError: () => void;
}

function playbackKey(playback: StagePlayback): string {
  return `${playback.cueId}:${playback.attempt}:${playback.sequence}`;
}

/**
 * Owns the stage's single `<audio>` element. `StageState.playback` is the only
 * trigger: the same cue/attempt/sequence never restarts, a new sequence stops
 * the old sound, and a reconnect seeks using `startedAt` instead of replaying
 * a finished cue. Only the program stage reports `audio_ended`/`audio_error`.
 */
export class StageAudio {
  private readonly isProgram: () => boolean;
  private readonly send: (event: StageAudioEvent) => void;
  private readonly now: () => number;
  private readonly durations = new Map<string, number>();
  private readonly preloaded = new Map<string, HTMLAudioElement>();
  private active: ActivePlayback | null = null;
  private currentKey: string | null = null;
  private endedKey: string | null = null;
  private failedKey: string | null = null;
  private fadeTimer: number | null = null;

  constructor(options: StageAudioOptions) {
    this.isProgram = options.isProgram;
    this.send = options.send;
    this.now = options.now ?? (() => Date.now());
  }

  /** Applies an explicit takeover/expiry without restarting the cue. */
  setProgram(program: boolean): void {
    if (this.active !== null) {
      this.active.audio.muted = !program;
    }
  }

  /** Builds the cueId → duration table used to detect a missed completion. */
  setCueDurations(cues: readonly { id: string; durationMs: number | null }[]): void {
    this.durations.clear();
    for (const cue of cues) {
      if (cue.durationMs !== null) {
        this.durations.set(cue.id, cue.durationMs);
      }
    }
  }

  setPreload(cues: readonly LivePreloadCue[]): void {
    const keep = new Set(cues.map((cue) => cue.cueId));
    for (const [cueId, audio] of [...this.preloaded]) {
      if (keep.has(cueId)) {
        continue;
      }
      this.preloaded.delete(cueId);
      audio.removeAttribute("src");
      audio.load();
    }
    for (const cue of cues) {
      if (this.preloaded.has(cue.cueId)) {
        continue;
      }
      if (this.active?.playback.cueId === cue.cueId) {
        continue;
      }
      const audio = new Audio(audioUrlForStage(cue.audioUrl));
      audio.preload = "auto";
      audio.muted = true;
      this.preloaded.set(cue.cueId, audio);
    }
  }

  update(phase: StagePhase, playback: StagePlayback | null): void {
    if (shouldFadeOut(phase, playback !== null)) {
      if (phase === "paused" || phase === "post_show" || playback === null) {
        this.currentKey = null;
        this.endedKey = null;
        this.failedKey = null;
      }
      this.fadeOutAndStop();
      return;
    }
    if (playback === null) {
      return;
    }
    const key = playbackKey(playback);
    if (key === this.currentKey || key === this.endedKey || key === this.failedKey) {
      return;
    }
    // Sequence changes (resume/skip/reconnect) discard the old sound before the
    // new instruction starts. A normal cue switch uses the same immediate stop.
    this.stopImmediately();
    this.currentKey = key;
    this.start(playback, key);
  }

  dispose(): void {
    this.clearFade();
    this.stopImmediately();
    this.currentKey = null;
    for (const [cueId, audio] of [...this.preloaded]) {
      this.preloaded.delete(cueId);
      audio.removeAttribute("src");
      audio.load();
    }
  }

  private start(playback: StagePlayback, key: string): void {
    const positionMs = this.positionMs(playback);
    const decision = resolvePlaybackStart(
      positionMs,
      this.durations.get(playback.cueId) ?? null,
    );
    if (decision.action === "ended") {
      // The cue finished while this stage was away. Report it without
      // replaying from the top so the server does not advance twice.
      this.endedKey = key;
      this.emit({ kind: "audio_ended", playback });
      return;
    }
    const audio = this.takePreloaded(playback) ?? new Audio(audioUrlForStage(playback.audioUrl));
    audio.preload = "auto";
    audio.volume = 1;
    audio.muted = !this.isProgram();
    const onEnded = () => {
      if (this.active?.audio !== audio) {
        return;
      }
      this.endedKey = key;
      this.emit({ kind: "audio_ended", playback });
      this.stopImmediately();
    };
    const onError = () => {
      if (this.active?.audio !== audio) {
        return;
      }
      this.fail(playback, key, "音声を読み込めませんでした。");
    };
    this.active = { key, playback, audio, onEnded, onError };
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    if (decision.seekMs > 0) {
      this.seekTo(audio, decision.seekMs);
    }
    const started = audio.play();
    if (started !== undefined) {
      started.catch((error: unknown) => {
        if (this.active?.audio !== audio) {
          return;
        }
        this.fail(playback, key, error);
      });
    }
  }

  private takePreloaded(playback: StagePlayback): HTMLAudioElement | null {
    const audio = this.preloaded.get(playback.cueId);
    if (audio === undefined) {
      return null;
    }
    this.preloaded.delete(playback.cueId);
    const expected = new URL(audioUrlForStage(playback.audioUrl), window.location.href).href;
    if (audio.src !== expected) {
      audio.removeAttribute("src");
      audio.load();
      return null;
    }
    return audio;
  }

  private seekTo(audio: HTMLAudioElement, seekMs: number): void {
    const seconds = seekMs / 1000;
    const apply = () => {
      try {
        audio.currentTime = seconds;
      } catch {
        // The media element may still be loading; the next metadata event
        // retries through the one-shot listener below.
      }
    };
    if (audio.readyState >= 1) {
      apply();
      return;
    }
    audio.addEventListener("loadedmetadata", apply, { once: true });
  }

  private fail(playback: StagePlayback, key: string, error: unknown): void {
    this.failedKey = key;
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "音声の再生に失敗しました。";
    this.emit({ kind: "audio_error", playback, error: message });
    this.stopImmediately();
  }

  private emit(event: StageAudioEvent): void {
    if (!this.isProgram()) {
      return;
    }
    this.send(event);
  }

  private positionMs(playback: StagePlayback): number {
    const startedAt = Date.parse(playback.startedAt);
    if (Number.isNaN(startedAt)) {
      return 0;
    }
    return Math.max(0, this.now() - startedAt);
  }

  private fadeOutAndStop(): void {
    const active = this.active;
    if (active === null || this.fadeTimer !== null) {
      return;
    }
    const startedAt = this.now();
    const startVolume = active.audio.volume;
    const step = () => {
      this.fadeTimer = null;
      if (this.active?.audio !== active.audio) {
        return;
      }
      const elapsed = this.now() - startedAt;
      active.audio.volume = Math.max(0, startVolume * fadeOutVolume(elapsed));
      if (elapsed >= FADE_OUT_DURATION_MS) {
        this.stopImmediately();
        return;
      }
      this.fadeTimer = window.setTimeout(step, 20);
    };
    this.fadeTimer = window.setTimeout(step, 20);
  }

  private stopImmediately(): void {
    this.clearFade();
    const active = this.active;
    this.active = null;
    if (active === null) {
      return;
    }
    active.audio.removeEventListener("ended", active.onEnded);
    active.audio.removeEventListener("error", active.onError);
    active.audio.pause();
    active.audio.removeAttribute("src");
    active.audio.load();
  }

  private clearFade(): void {
    if (this.fadeTimer !== null) {
      window.clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
  }
}
