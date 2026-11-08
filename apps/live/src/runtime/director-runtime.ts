import type {
  CommentCandidate,
  LiveCharacterSheet,
  LiveCue,
  LiveGenerationStatus,
  LivePackageShow,
  LiveSegment,
  LiveSpeaker,
} from "@kakeai/contracts";
import type { CommentSourceScheduler } from "../comments/source.ts";
import { realCommentScheduler } from "../comments/source.ts";
import type { RunLogEventInput, RunStore } from "../runs/run-store.ts";
import type { DirectorContext } from "../director/prompt.ts";
import type { DirectorResponseHost } from "../director/response-responder.ts";
import type { CommentCorner } from "./comment-corner.ts";
import type { LiveController } from "./controller.ts";

export interface DirectorRuntimeOptions {
  controller: LiveController;
  runStore: RunStore;
  show: LivePackageShow;
  characters: LiveCharacterSheet;
  comments: CommentCorner | null;
  scheduler?: CommentSourceScheduler;
  now?: () => Date;
}

const RECENT_CAPTION_LIMIT = 5;
const CUE_POLL_INTERVAL_MS = 100;
const TERMINAL_STATUSES = new Set<LiveCue["status"]>(["done", "skipped", "failed"]);

function fileLabel(file: string, fallback: string): string {
  const name = file.split("/").pop()?.trim() ?? "";
  return name.length > 0 ? name : fallback;
}

/**
 * Bridges the comment corner responder and the controller. It owns the
 * director-only context (safe candidate, clock, captions, expressions) and the
 * scheduler-driven wait for generated cues, so neither the responder nor the
 * controller needs to know both sides.
 */
export class DirectorRuntime implements DirectorResponseHost {
  private readonly controller: LiveController;
  private readonly runStore: RunStore;
  private readonly show: LivePackageShow;
  private readonly characters: LiveCharacterSheet;
  private readonly comments: CommentCorner | null;
  private readonly scheduler: CommentSourceScheduler;
  private readonly now: () => Date;
  private responseSerial = 0;

  constructor(options: DirectorRuntimeOptions) {
    this.controller = options.controller;
    this.runStore = options.runStore;
    this.show = options.show;
    this.characters = options.characters;
    this.comments = options.comments;
    this.scheduler = options.scheduler ?? realCommentScheduler;
    this.now = options.now ?? (() => new Date());
  }

  contextFor(candidate: CommentCandidate): DirectorContext {
    const segment = this.controller.getCurrentSegment();
    const snapshot = this.controller.getSnapshot();
    const clock = snapshot.clock;
    const target =
      segment !== null && segment.kind !== "cut_in"
        ? segment.targetDurationMs
        : clock.remainingMs;
    const expressions = new Set<string>(["normal"]);
    for (const character of this.characters.characters) {
      for (const appearance of character.appearances) {
        expressions.add(appearance.expression);
      }
    }
    for (const faceSet of this.characters.faceSets) {
      for (const expression of faceSet.expressions) {
        expressions.add(expression.id);
      }
    }
    const left = this.speakerName("left");
    const right = this.speakerName("right");
    return {
      persona: this.show.safety.persona,
      blockedTopics: [...this.show.safety.blockedTopics],
      maxResponseChars: this.show.safety.maxResponseChars,
      maxResponseCues: this.show.safety.maxResponseCues,
      segmentLabel: segment?.label ?? "コメントコーナー",
      segmentRemainingMs: Math.max(0, Math.min(target, clock.remainingMs)),
      showRemainingMs: Math.max(0, clock.remainingMs),
      recentCaptions: this.recentCaptions(snapshot.queue),
      candidate: {
        safeSummary: candidate.safeSummary,
        safeQuestion: candidate.safeQuestion,
        suggestedAngle: candidate.suggestedAngle,
      },
      pinNote: this.comments?.getPinNote(candidate.commentId) ?? null,
      materialLabel: this.materialLabel(segment),
      expressions: [...expressions],
      speakerNames: { left: left ?? "左", right },
    };
  }

  playGeneratedCues(cues: LiveCue[]): void {
    this.responseSerial = this.controller.playResponseCues(cues);
  }

  waitForCues(cueIds: string[], timeoutMs: number): Promise<"done" | "stopped"> {
    const serial = this.responseSerial;
    return new Promise<"done" | "stopped">((resolve) => {
      if (cueIds.length === 0) {
        this.controller.endResponseCues(serial);
        resolve("done");
        return;
      }
      const deadline = this.now().getTime() + Math.max(0, timeoutMs);
      const poll = (): void => {
        if (this.controller.isResponseStopped()) {
          this.controller.endResponseCues(serial);
          resolve("stopped");
          return;
        }
        const settled = cueIds.every((cueId) => {
          const cue = this.controller.getCue(cueId);
          return cue === null || TERMINAL_STATUSES.has(cue.status);
        });
        if (settled) {
          this.controller.endResponseCues(serial);
          resolve("done");
          return;
        }
        if (this.now().getTime() >= deadline) {
          // The host contract has only done/stopped. The responder tells a
          // real stop apart from this timeout via its token and isStopped().
          const message = `生成キューの再生待ちがタイムアウトしました: ${cueIds.join(", ")}`;
          this.log({ type: "error", data: { message, reason: "response_wait_timeout" } });
          this.notice("warning", message);
          this.controller.endResponseCues(serial);
          resolve("stopped");
          return;
        }
        this.scheduler.setTimeout(poll, CUE_POLL_INTERVAL_MS);
      };
      this.scheduler.setTimeout(poll, CUE_POLL_INTERVAL_MS);
    });
  }

  setGeneration(status: LiveGenerationStatus | null): void {
    this.controller.setGeneration(status);
  }

  log(input: RunLogEventInput): void {
    this.controller.recordEvent(input);
    if (input.type !== "error") {
      return;
    }
    const message = input.data?.message;
    this.runStore.appendError(
      typeof message === "string" ? message : "ライブ実行でエラーが発生しました。",
    );
  }

  appendGeneratedText(entry: Record<string, unknown>): void {
    this.runStore.appendGeneratedText(entry);
  }

  notice(level: "info" | "warning" | "error", message: string): void {
    this.controller.notify(level, message);
  }

  isStopped(): boolean {
    return this.controller.isResponseStopped();
  }

  private recentCaptions(queue: LiveCue[]): string[] {
    return queue
      .filter((cue) => cue.status === "done" || cue.status === "playing")
      .slice(-RECENT_CAPTION_LIMIT)
      .map((cue) => cue.caption);
  }

  private materialLabel(segment: LiveSegment | null): string | null {
    if (segment === null || segment.kind === "cut_in" || segment.material === undefined) {
      return null;
    }
    const material = this.show.materials.find((entry) => entry.id === segment.material);
    return material === undefined ? segment.material : fileLabel(material.file, material.id);
  }

  private speakerName(side: "left" | "right"): string | null {
    const character = this.characters.characters.find((entry) => entry.side === side);
    if (character !== undefined) {
      return character.name;
    }
    const speaker: LiveSpeaker | undefined = this.show.speakers.find(
      (entry) => entry.side === side,
    );
    if (speaker !== undefined) {
      return speaker.name;
    }
    return side === "left" ? "左" : null;
  }
}
