import type { CommentEvent, CommentSourceStatus, LiveCommentKind } from "@kakeai/contracts";
import { CommentSourceBase } from "../comments/source.ts";

export interface ManualCommentInput {
  id?: string;
  author?: string;
  text: string;
  kind?: LiveCommentKind;
}

/**
 * Test-only source whose comments are emitted explicitly. It lets WebSocket
 * and corner tests place comments at exact points without wall-clock waits.
 */
export class ManualCommentSource extends CommentSourceBase {
  private state: CommentSourceStatus["state"] = "idle";
  private liveChatId: string | null = null;
  private lastPolledAt: string | null = null;
  private counter = 0;

  constructor(
    private readonly now: () => Date = () => new Date(),
    options: { liveChatId?: string } = {},
  ) {
    super();
    this.liveChatId = options.liveChatId ?? null;
  }

  start(): void {
    this.state = "polling";
    this.emitStatus();
  }

  stop(): void {
    this.state = "stopped";
    this.emitStatus();
  }

  getStatus(): CommentSourceStatus {
    return {
      kind: "fixture",
      state: this.state,
      liveChatId: this.liveChatId,
      pollingIntervalMs: 0,
      lastPolledAt: this.lastPolledAt,
      lastError: null,
      quota: null,
      authExpiresAt: null,
      needsReauth: false,
    };
  }

  setLiveChatId(liveChatId: string): void {
    this.liveChatId = liveChatId;
    this.emitStatus();
  }

  emit(input: ManualCommentInput): CommentEvent {
    this.counter += 1;
    const at = this.now().toISOString();
    const comment: CommentEvent = {
      id: input.id ?? `manual-${this.counter}`,
      authorName: input.author ?? "みかん",
      text: input.text,
      publishedAt: at,
      receivedAt: at,
      kind: input.kind ?? "normal",
    };
    this.lastPolledAt = at;
    this.emitComment(comment);
    this.emitStatus();
    return comment;
  }
}
