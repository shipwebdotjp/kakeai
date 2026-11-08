import type {
  CommentCandidate,
  LiveCue,
  LiveGenerationStatus,
  LivePackageShow,
  LiveRuntimeConfig,
  LiveSpeaker,
  TtsAdapter,
  VoiceAdapterId,
} from "@kakeai/contracts";
import type { RunLogEventInput } from "../runs/run-store.ts";
import type { Director } from "./director.ts";
import { generateGeneratedSpeech } from "./generated-speech.ts";
import type { DirectorContext } from "./prompt.ts";

export type GeneratedCueEdit = Partial<
  Pick<LiveCue, "caption" | "speech" | "expression">
>;

export type GeneratedCueUpdate = Partial<
  Pick<LiveCue, "caption" | "speech" | "expression" | "audio" | "durationMs" | "status">
>;

export type GeneratedCueCommandResult = { ok: true } | { ok: false; message: string };

/** The controller-facing surface used by generated cue editing/regeneration. */
export interface GeneratedCueCommands {
  editGeneratedCue(cueId: string, patch: GeneratedCueEdit): GeneratedCueCommandResult;
  regenerateGeneratedCue(cueId: string): GeneratedCueCommandResult;
}

export interface GeneratedCueServiceHost {
  getCue(cueId: string): LiveCue | null;
  updateCue(cueId: string, patch: GeneratedCueUpdate): boolean;
  setGeneration(status: LiveGenerationStatus | null): void;
  log(input: RunLogEventInput): void;
  notice(level: "info" | "warning" | "error", message: string): void;
  appendGeneratedText(entry: Record<string, unknown>): void;
  contextFor(candidate: CommentCandidate): DirectorContext;
  candidateFor(commentId: string): CommentCandidate | null;
}

export interface GeneratedCueServiceOptions {
  show: LivePackageShow;
  config: LiveRuntimeConfig;
  packageRoot: string;
  runDir: string;
  director: Director;
  host: GeneratedCueServiceHost;
  now?: () => Date;
  adapterFor?: (id: VoiceAdapterId) => TtsAdapter;
}

const EDITABLE_STATUSES = new Set<LiveCue["status"]>(["draft", "preparing", "ready"]);

function ok(): GeneratedCueCommandResult {
  return { ok: true };
}

function reject(message: string): GeneratedCueCommandResult {
  return { ok: false, message };
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : fallback;
}

/**
 * Applies operator edits and regeneration to generated cues. Caption and
 * expression changes are immediate; speech changes re-run TTS. Regeneration
 * updates the existing cue id in place and ignores extra cues for v1.
 */
export class GeneratedCueService implements GeneratedCueCommands {
  private readonly show: LivePackageShow;
  private readonly config: LiveRuntimeConfig;
  private readonly packageRoot: string;
  private readonly runDir: string;
  private readonly director: Director;
  private readonly host: GeneratedCueServiceHost;
  private readonly now: () => Date;
  private readonly adapterFor: ((id: VoiceAdapterId) => TtsAdapter) | undefined;
  private readonly busy = new Set<string>();
  private readonly generationTokens = new Map<string, number>();
  private editSequence = 0;
  private regenerateSequence = 0;

  constructor(options: GeneratedCueServiceOptions) {
    this.show = options.show;
    this.config = options.config;
    this.packageRoot = options.packageRoot;
    this.runDir = options.runDir;
    this.director = options.director;
    this.host = options.host;
    this.now = options.now ?? (() => new Date());
    this.adapterFor = options.adapterFor;
  }

  editGeneratedCue(cueId: string, patch: GeneratedCueEdit): GeneratedCueCommandResult {
    if (
      patch.caption === undefined &&
      patch.speech === undefined &&
      patch.expression === undefined
    ) {
      return reject("変更する項目がありません。");
    }
    const cue = this.host.getCue(cueId);
    if (cue === null || cue.source !== "generated") {
      return reject("生成レスではありません。");
    }
    if (this.busy.has(cueId)) {
      return reject("このキューは処理中です。");
    }
    if (!EDITABLE_STATUSES.has(cue.status)) {
      return reject("再生中・再生済みのキューは編集できません。");
    }
    const immediate: GeneratedCueUpdate = {};
    if (patch.caption !== undefined) {
      immediate.caption = patch.caption;
    }
    if (patch.expression !== undefined) {
      immediate.expression = patch.expression;
    }
    if (patch.speech === undefined) {
      return this.host.updateCue(cueId, immediate)
        ? ok()
        : reject("編集できるキューがありません。");
    }
    if (
      !this.host.updateCue(cueId, {
        ...immediate,
        speech: patch.speech,
        status: "preparing",
      })
    ) {
      return reject("編集できるキューがありません。");
    }
    this.busy.add(cueId);
    const token = (this.generationTokens.get(cueId) ?? 0) + 1;
    this.generationTokens.set(cueId, token);
    const generation = this.generation("preparing", cue.commentId, [cueId]);
    this.applyGeneration(cueId, token, generation);
    this.editSequence += 1;
    void this.runEdit(
      { cueId, commentId: cue.commentId, speech: patch.speech },
      generation,
      token,
    )
      .catch(() => undefined)
      .finally(() => this.busy.delete(cueId));
    return ok();
  }

  regenerateGeneratedCue(cueId: string): GeneratedCueCommandResult {
    const cue = this.host.getCue(cueId);
    if (cue === null || cue.source !== "generated") {
      return reject("生成レスではありません。");
    }
    if (this.busy.has(cueId)) {
      return reject("このキューは処理中です。");
    }
    if (!EDITABLE_STATUSES.has(cue.status)) {
      return reject("再生中・再生済みのキューは再生成できません。");
    }
    if (cue.commentId === null) {
      return reject("コメントに紐づかないキューは再生成できません。");
    }
    const candidate = this.host.candidateFor(cue.commentId);
    if (candidate === null) {
      return reject("再生成するコメント候補が見つかりません。");
    }
    if (!this.host.updateCue(cueId, { status: "preparing" })) {
      return reject("再生成できるキューがありません。");
    }
    this.busy.add(cueId);
    const token = (this.generationTokens.get(cueId) ?? 0) + 1;
    this.generationTokens.set(cueId, token);
    const generation = this.generation("thinking", cue.commentId, [cueId]);
    this.applyGeneration(cueId, token, generation);
    this.regenerateSequence += 1;
    void this.runRegenerate(cue, candidate, generation, token)
      .catch(() => undefined)
      .finally(() => this.busy.delete(cueId));
    return ok();  }

  private async runEdit(
    input: { cueId: string; commentId: string | null; speech: string },
    generation: LiveGenerationStatus,
    token: number,
  ): Promise<void> {
    try {
      const result = await generateGeneratedSpeech({
        runDir: this.runDir,
        packageRoot: this.packageRoot,
        speaker: this.speakerFor(this.host.getCue(input.cueId)?.speaker ?? "left"),
        text: input.speech,
        cueId: `${input.cueId}-edit-${this.editSequence}`,
        config: this.config,
        now: this.now,
        ...(this.adapterFor === undefined ? {} : { adapterFor: this.adapterFor }),
      });
      if (
        !this.host.updateCue(input.cueId, {
          audio: result.audio,
          durationMs: result.durationMs,
          status: "ready",
        })
      ) {
        throw new Error("編集したキューを更新できませんでした。");
      }
      const latest = this.host.getCue(input.cueId);
      this.host.appendGeneratedText({
        event: "edited",
        cueId: input.cueId,
        commentId: input.commentId,
        caption: latest?.caption ?? "",
        speech: latest?.speech ?? input.speech,
        expression: latest?.expression ?? "normal",
      });
      this.applyGeneration(input.cueId, token, {
        ...generation,
        phase: "ready",
        updatedAt: this.nowIso(),
      });
    } catch (error) {
      this.fail(input.cueId, input.commentId, error, "edit", token);
    }
  }

  private async runRegenerate(
    cue: LiveCue,
    candidate: CommentCandidate,
    generation: LiveGenerationStatus,
    token: number,
  ): Promise<void> {
    try {
      const output = await this.director.generate(this.host.contextFor(candidate));
      if (output.skip || output.cues.length === 0) {
        throw new Error("ディレクターが応答を生成しませんでした。");
      }
      const first = output.cues[0];
      if (first === undefined) {
        throw new Error("ディレクターが応答を生成しませんでした。");
      }
      if (output.cues.length > 1) {
        this.host.log({
          type: "cue_edited",
          cueId: cue.id,
          data: { warning: "extra_cues_ignored", ignored: output.cues.length - 1 },
        });
        this.host.notice(
          "warning",
          `再生成で ${output.cues.length - 1} 件の余分なキューを無視しました。`,
        );
      }
      this.applyGeneration(cue.id, token, {
        ...generation,
        phase: "preparing",
        updatedAt: this.nowIso(),
      });
      const result = await generateGeneratedSpeech({
        runDir: this.runDir,
        packageRoot: this.packageRoot,
        speaker: this.speakerFor(cue.speaker),
        text: first.speech,
        cueId: `${cue.id}-regen-${this.regenerateSequence}`,
        config: this.config,
        now: this.now,
        ...(this.adapterFor === undefined ? {} : { adapterFor: this.adapterFor }),
      });
      if (
        !this.host.updateCue(cue.id, {
          caption: first.caption,
          speech: first.speech,
          expression: first.expression,
          audio: result.audio,
          durationMs: result.durationMs,
          status: "ready",
        })
      ) {
        throw new Error("再生成したキューを更新できませんでした。");
      }
      this.host.appendGeneratedText({
        event: "regenerated",
        cueId: cue.id,
        commentId: cue.commentId,
        caption: first.caption,
        speech: first.speech,
        expression: first.expression,
      });
      this.host.log({
        type: "cue_edited",
        cueId: cue.id,
        commentId: cue.commentId,
        data: { reason: "regenerated", cueCount: output.cues.length },
      });
      this.applyGeneration(cue.id, token, {
        ...generation,
        phase: "ready",
        updatedAt: this.nowIso(),
      });
    } catch (error) {
      this.fail(cue.id, cue.commentId, error, "regenerate", token);
    }
  }

  private fail(
    cueId: string,
    commentId: string | null,
    error: unknown,
    reason: "edit" | "regenerate",
    token: number,
  ): void {
    const message = messageOf(
      error,
      reason === "edit" ? "生成レスの編集に失敗しました。" : "生成レスの再生成に失敗しました。",
    );
    this.host.updateCue(cueId, { status: "failed" });
    this.host.log({
      type: "error",
      cueId,
      commentId,
      data: { message, reason },
    });
    this.host.notice("error", message);
    this.applyGeneration(cueId, token, {
      ...this.generation("failed", commentId, [cueId]),
      error: message,
    });
  }

  private speakerFor(side: LiveCue["speaker"]): LiveSpeaker {
    const speaker = this.show.speakers.find((entry) => entry.side === side);
    if (speaker === undefined) {
      throw new Error(`TTS の話者が見つかりません: ${side}`);
    }
    return speaker;
  }

  private generation(
    phase: LiveGenerationStatus["phase"],
    commentId: string | null,
    cueIds: string[],
  ): LiveGenerationStatus {
    return {
      phase,
      commentId,
      cueIds,
      error: null,
      updatedAt: this.nowIso(),
    };
  }

  private nowIso(): string {
    return this.now().toISOString();
  }

  /** Only the latest edit/regeneration for a cue may update the console status. */
  private applyGeneration(
    cueId: string,
    token: number,
    status: LiveGenerationStatus | null,
  ): void {
    if (this.generationTokens.get(cueId) === token) {
      this.host.setGeneration(status);
    }
  }
}
