import { createHash } from "node:crypto";
import type {
  CommentCandidate,
  DirectorOutput,
  LiveCue,
  LiveGenerationStatus,
  LivePackageShow,
  LiveRuntimeConfig,
  LiveSpeaker,
  PreparedCue,
  TtsAdapter,
  VoiceAdapterId,
} from "@kakeai/contracts";
import type { CommentSourceScheduler } from "../comments/source.ts";
import { realCommentScheduler } from "../comments/source.ts";
import type { RunLogEventInput } from "../runs/run-store.ts";
import type { Director } from "./director.ts";
import { generateGeneratedSpeech } from "./generated-speech.ts";
import type { DirectorContext } from "./prompt.ts";
import { Semaphore } from "./semaphore.ts";
import type {
  CommentCornerResponder,
  CommentCornerRespondOutcome,
} from "../runtime/comment-responder.ts";

export interface DirectorResponseHost {
  contextFor(candidate: CommentCandidate): DirectorContext;
  playGeneratedCues(cues: LiveCue[]): void;
  waitForCues(cueIds: string[], timeoutMs: number): Promise<"done" | "stopped">;
  setGeneration(status: LiveGenerationStatus | null): void;
  log(input: RunLogEventInput): void;
  appendGeneratedText(entry: Record<string, unknown>): void;
  notice(level: "info" | "warning" | "error", message: string): void;
  isStopped(): boolean;
}

export interface DirectorResponderOptions {
  director: Director;
  config: LiveRuntimeConfig;
  show: LivePackageShow;
  packageRoot: string;
  runDir: string;
  /** `show.safety.fallbackCueId` resolved to its prepared cue. */
  fallbackCue: PreparedCue;
  host: () => DirectorResponseHost | null;
  scheduler?: CommentSourceScheduler;
  now?: () => Date;
  fetch?: typeof fetch;
  adapterFor?: (id: VoiceAdapterId) => TtsAdapter;
}

type PreparedResponse =
  | { ok: true; commentId: string; cues: LiveCue[] }
  | {
      ok: false;
      commentId: string;
      kind: "skip" | "error";
      message: string;
    };

interface StopSignal {
  promise: Promise<"stopped">;
  resolve(): void;
}

const PLAY_CUE_TIMEOUT_MARGIN_MS = 10_000;
const MAX_LLM_CONCURRENCY = 2;
const MAX_CUE_TOKEN = 40;

function safeCommentToken(commentId: string): string {
  const readable = commentId
    .replace(/[^A-Za-z0-9_-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, MAX_CUE_TOKEN);
  if (readable.length > 0) {
    return readable;
  }
  return createHash("sha1").update(commentId).digest("hex").slice(0, 10);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : fallback;
}

/**
 * P5 comment responder: generates one response per selected candidate ahead of
 * time, synthesizes the cues, plays them through the controller and waits for
 * the stage to finish. Every failure falls back once per corner and never stops
 * the prepared spine.
 */
export class DirectorResponder implements CommentCornerResponder {
  private readonly director: Director;
  private readonly config: LiveRuntimeConfig;
  private readonly show: LivePackageShow;
  private readonly packageRoot: string;
  private readonly runDir: string;
  private readonly fallbackCue: PreparedCue;
  private readonly host: () => DirectorResponseHost | null;
  private readonly scheduler: CommentSourceScheduler;
  private readonly now: () => Date;
  private readonly adapterFor: ((id: VoiceAdapterId) => TtsAdapter) | undefined;
  private readonly llmGate = new Semaphore(MAX_LLM_CONCURRENCY);
  private readonly maxThinkingMs: number;
  private session = 0;
  private responseToken = 0;
  private prepared = new Map<string, Promise<PreparedResponse>>();
  private preparedSession = new Map<string, number>();
  private latestStatus = new Map<string, LiveGenerationStatus>();
  private activeCandidateId: string | null = null;
  private stopSignal: StopSignal | null = null;
  private fallbackUsed = false;
  private fallbackSequence = 0;
  private consecutiveFailures = 0;

  constructor(options: DirectorResponderOptions) {
    this.director = options.director;
    this.config = options.config;
    this.show = options.show;
    this.packageRoot = options.packageRoot;
    this.runDir = options.runDir;
    this.fallbackCue = options.fallbackCue;
    this.host = options.host;
    this.scheduler = options.scheduler ?? realCommentScheduler;
    this.now = options.now ?? (() => new Date());
    this.adapterFor = options.adapterFor;
    this.maxThinkingMs = this.show.playout.maxThinkingMs;
  }

  prepare(candidates: CommentCandidate[]): void {
    this.session += 1;
    this.prepared.clear();
    this.preparedSession.clear();
    this.latestStatus.clear();
    this.fallbackUsed = false;
    this.activeCandidateId = candidates[0]?.commentId ?? null;
    for (const candidate of candidates) {
      this.track(candidate, this.session);
    }
  }

  async respond(candidate: CommentCandidate): Promise<CommentCornerRespondOutcome> {
    const token = (this.responseToken += 1);
    this.activeCandidateId = candidate.commentId;
    const stop = this.createStopSignal();
    const host = this.host();
    if (host === null) {
      return "stopped";
    }
    this.publishLatestStatus(candidate.commentId);

    const prepared = await this.raceStop(
      this.waitForPreparation(candidate, this.ensurePrepared(candidate)),
      stop.promise,
    );
    if (prepared === "stopped" || token !== this.responseToken) {
      return this.finishStopped(token);
    }
    if (prepared === "timeout") {
      return this.finishFailure(
        candidate,
        `生成レスが ${this.maxThinkingMs}ms 以内に準備できませんでした。`,
        token,
        stop,
      );
    }
    if (!prepared.ok) {
      if (prepared.kind === "skip") {
        this.clearGeneration(token);
        return "failed";
      }
      return this.finishFailure(candidate, prepared.message, token, stop);
    }
    if (host.isStopped() || token !== this.responseToken) {
      return this.finishStopped(token);
    }

    host.playGeneratedCues(prepared.cues);
    const timeoutMs =
      prepared.cues.reduce((total, cue) => total + (cue.durationMs ?? 0), 0) +
      PLAY_CUE_TIMEOUT_MARGIN_MS +
      this.maxThinkingMs;
    const played = await this.raceStop(
      host.waitForCues(
        prepared.cues.map((cue) => cue.id),
        timeoutMs,
      ),
      stop.promise,
    );
    if (played === "stopped") {
      if (token !== this.responseToken || host.isStopped()) {
        return this.finishStopped(token);
      }
      // The wait itself timed out (not stop/safe mode): fall back once so the
      // corner does not stall behind a stage that never reports audio_ended.
      return this.finishFailure(
        candidate,
        `生成キューの再生が ${timeoutMs}ms 以内に完了しませんでした。`,
        token,
        stop,
      );
    }
    if (token !== this.responseToken) {
      return this.finishStopped(token);
    }
    this.consecutiveFailures = 0;
    this.clearGeneration(token);
    return "done";
  }

  /** Generation keeps running; the controller owns playback pausing. */
  pause(): void {}

  resume(): void {}

  stop(): void {
    this.responseToken += 1;
    this.resolveStop();
    this.clearGeneration(this.responseToken);
    this.activeCandidateId = null;
  }

  private track(candidate: CommentCandidate, session: number): void {
    const promise = this.generateCandidate(candidate, session);
    this.prepared.set(candidate.commentId, promise);
    this.preparedSession.set(candidate.commentId, session);
  }

  private ensurePrepared(candidate: CommentCandidate): Promise<PreparedResponse> {
    if (this.preparedSession.get(candidate.commentId) === this.session) {
      const existing = this.prepared.get(candidate.commentId);
      if (existing !== undefined) {
        return existing;
      }
    }
    const promise = this.generateCandidate(candidate, this.session);
    this.prepared.set(candidate.commentId, promise);
    this.preparedSession.set(candidate.commentId, this.session);
    return promise;
  }

  private async generateCandidate(
    candidate: CommentCandidate,
    session: number,
  ): Promise<PreparedResponse> {
    const host = this.host();
    if (host === null) {
      return { ok: false, commentId: candidate.commentId, kind: "error", message: "実行が終了しています。" };
    }
    const active = (): boolean =>
      session === this.session && this.activeCandidateId === candidate.commentId;
    this.applyGeneration(candidate.commentId, session, {
      phase: "thinking",
      commentId: candidate.commentId,
      cueIds: [],
      error: null,
      updatedAt: this.now().toISOString(),
    });

    let output: DirectorOutput;
    try {
      const context = host.contextFor(candidate);
      output = await this.llmGate.run(() => this.director.generate(context));
    } catch (error) {
      const message = errorMessage(error, "ディレクターの生成に失敗しました。");
      if (session === this.session) {
        host.log({
          type: "error",
          commentId: candidate.commentId,
          data: { message, reason: "director" },
        });
        this.applyGeneration(candidate.commentId, session, {
          phase: "failed",
          commentId: candidate.commentId,
          cueIds: [],
          error: message,
          updatedAt: this.now().toISOString(),
        });
      }
      return { ok: false, commentId: candidate.commentId, kind: "error", message };
    }

    if (session !== this.session) {
      return { ok: false, commentId: candidate.commentId, kind: "error", message: "古い生成結果です。" };
    }
    if (output.skip) {
      host.log({
        type: "cue_skipped",
        commentId: candidate.commentId,
        data: { reason: "director_skip" },
      });
      if (active()) {
        this.applyGeneration(candidate.commentId, session, null);
      }
      return {
        ok: false,
        commentId: candidate.commentId,
        kind: "skip",
        message: "ディレクターがこのコメントを拾いませんでした。",
      };
    }

    const cueIds = output.cues.map(
      (_cue, index) => `gen-${safeCommentToken(candidate.commentId)}-${index}`,
    );
    this.applyGeneration(candidate.commentId, session, {
      phase: "preparing",
      commentId: candidate.commentId,
      cueIds,
      error: null,
      updatedAt: this.now().toISOString(),
    });

    try {
      const cues = await Promise.all(
        output.cues.map(async (cue, index) => {
          const speaker = this.speakerFor(cue.speaker);
          const cueId = cueIds[index] ?? `gen-${safeCommentToken(candidate.commentId)}-${index}`;
          const speech = await generateGeneratedSpeech({
            runDir: this.runDir,
            packageRoot: this.packageRoot,
            speaker,
            text: cue.speech,
            cueId,
            config: this.config,
            now: this.now,
            ...(this.adapterFor === undefined ? {} : { adapterFor: this.adapterFor }),
          });
          if (session !== this.session) {
            throw new Error("古い生成結果です。");
          }
          return {
            id: cueId,
            origin: "live" as const,
            speaker: cue.speaker === "none" ? ("left" as const) : cue.speaker,
            caption: cue.caption,
            speech: cue.speech,
            expression: cue.expression,
            audio: speech.audio,
            durationMs: speech.durationMs,
            source: "generated" as const,
            status: "ready" as const,
            commentId: candidate.commentId,
          };
        }),
      );
      if (session !== this.session) {
        return { ok: false, commentId: candidate.commentId, kind: "error", message: "古い生成結果です。" };
      }
      for (const cue of cues) {
        host.appendGeneratedText({
          event: "generated",
          commentId: candidate.commentId,
          cueId: cue.id,
          caption: cue.caption,
          speech: cue.speech,
          expression: cue.expression,
        });
      }
      host.log({
        type: "cue_generated",
        commentId: candidate.commentId,
        data: {
          cueCount: cues.length,
          source: "generated",
          cueIds: cues.map((cue) => cue.id),
        },
      });
      this.applyGeneration(candidate.commentId, session, {
        phase: "ready",
        commentId: candidate.commentId,
        cueIds: cues.map((cue) => cue.id),
        error: null,
        updatedAt: this.now().toISOString(),
      });
      return { ok: true, commentId: candidate.commentId, cues };
    } catch (error) {
      const message = errorMessage(error, "生成レスの TTS に失敗しました。");
      if (session === this.session) {
        host.log({
          type: "error",
          commentId: candidate.commentId,
          data: { message, reason: "tts" },
        });
        this.applyGeneration(candidate.commentId, session, {
          phase: "failed",
          commentId: candidate.commentId,
          cueIds,
          error: message,
          updatedAt: this.now().toISOString(),
        });
      }
      return { ok: false, commentId: candidate.commentId, kind: "error", message };
    }
  }

  private speakerFor(side: "left" | "right" | "none"): LiveSpeaker {
    const resolved = side === "none" ? "left" : side;
    const speaker = this.show.speakers.find((entry) => entry.side === resolved);
    if (speaker === undefined) {
      throw new Error(`TTS の話者が見つかりません: ${resolved}`);
    }
    return speaker;
  }

  private async finishFailure(
    candidate: CommentCandidate,
    message: string,
    token: number,
    stop: StopSignal,
  ): Promise<CommentCornerRespondOutcome> {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures === 3) {
      this.host()?.notice(
        "error",
        "生成レスが続けて失敗しています。安全モードへの切り替えを検討してください。",
      );
    }
    if (token !== this.responseToken) {
      return "stopped";
    }
    if (this.host()?.isStopped() === true) {
      return this.finishStopped(token);
    }
    const outcome = await this.playFallback(candidate, message, token, stop);
    this.clearGeneration(token);
    return outcome;
  }

  private async playFallback(
    candidate: CommentCandidate,
    message: string,
    token: number,
    stop: StopSignal,
  ): Promise<"failed" | "stopped"> {
    const host = this.host();
    if (host === null) {
      return "failed";
    }
    if (this.fallbackUsed) {
      host.log({
        type: "error",
        commentId: candidate.commentId,
        data: { message: "このコーナーでは退避キューを再生済みです。", reason: "fallback_used" },
      });
      return "failed";
    }
    this.fallbackUsed = true;
    this.fallbackSequence += 1;
    const fallback: LiveCue = {
      ...this.fallbackCue,
      id: `${this.fallbackCue.id}-fallback-${this.fallbackSequence}`,
      source: "fallback",
      status: "ready",
      commentId: null,
    };
    host.log({
      type: "cue_generated",
      commentId: candidate.commentId,
      cueId: fallback.id,
      data: { source: "fallback", reason: "generation_failed" },
    });
    host.notice(
      "warning",
      `生成レスを退避キューに切り替えます: ${message}`,
    );
    try {
      host.playGeneratedCues([fallback]);
      const timeoutMs =
        (fallback.durationMs ?? 0) +
        PLAY_CUE_TIMEOUT_MARGIN_MS +
        this.maxThinkingMs;
      const played = await this.raceStop(
        host.waitForCues([fallback.id], timeoutMs),
        stop.promise,
      );
      if (played === "stopped" || token !== this.responseToken) {
        return "stopped";
      }
      return "failed";
    } catch (error) {
      host.log({
        type: "error",
        commentId: candidate.commentId,
        cueId: fallback.id,
        data: {
          message: errorMessage(error, "退避キューの再生に失敗しました。"),
          reason: "fallback_failed",
        },
      });
      return "failed";
    }
  }

  private waitForPreparation(
    candidate: CommentCandidate,
    promise: Promise<PreparedResponse>,
  ): Promise<PreparedResponse | "timeout"> {
    return new Promise<PreparedResponse | "timeout">((resolve) => {
      let settled = false;
      const finish = (value: PreparedResponse | "timeout"): void => {
        if (settled) {
          return;
        }
        settled = true;
        this.scheduler.clearTimeout(timer);
        resolve(value);
      };
      const timer = this.scheduler.setTimeout(
        () => finish("timeout"),
        Math.max(0, this.maxThinkingMs),
      );
      promise.then(
        (value) => finish(value),
        (error: unknown) =>
          finish({
            ok: false,
            commentId: candidate.commentId,
            kind: "error",
            message: errorMessage(error, "生成レスに失敗しました。"),
          }),
      );
    });
  }

  private createStopSignal(): StopSignal {
    let resolve: () => void = () => undefined;
    const promise = new Promise<"stopped">((resolvePromise) => {
      resolve = () => resolvePromise("stopped");
    });
    const signal: StopSignal = { promise, resolve };
    this.stopSignal = signal;
    return signal;
  }

  private resolveStop(): void {
    const signal = this.stopSignal;
    this.stopSignal = null;
    signal?.resolve();
  }

  private raceStop<T>(
    promise: Promise<T>,
    stopped: Promise<"stopped">,
  ): Promise<T | "stopped"> {
    return Promise.race([promise, stopped]);
  }

  private applyGeneration(
    commentId: string,
    session: number,
    status: LiveGenerationStatus | null,
  ): void {
    if (session !== this.session) {
      return;
    }
    if (status === null) {
      this.latestStatus.delete(commentId);
    } else {
      this.latestStatus.set(commentId, status);
    }
    if (this.activeCandidateId === commentId) {
      this.host()?.setGeneration(status);
    }
  }

  private publishLatestStatus(commentId: string): void {
    const status = this.latestStatus.get(commentId);
    if (status !== undefined) {
      this.host()?.setGeneration(status);
    }
  }

  private finishStopped(token: number): "stopped" {
    this.clearGeneration(token);
    return "stopped";
  }

  private clearGeneration(token: number): void {
    if (token !== this.responseToken) {
      return;
    }
    if (this.activeCandidateId === null) {
      return;
    }
    this.activeCandidateId = null;
    this.host()?.setGeneration(null);
  }
}
