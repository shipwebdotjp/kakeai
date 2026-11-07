import type { CommentEvent, CommentSourceStatus } from "@kakeai/contracts";

/**
 * Injectable timer boundary. Fixture playback and YouTube polling advance with
 * a fake scheduler in tests so no test waits on wall-clock time.
 */
export interface CommentSourceScheduler {
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

export const realCommentScheduler: CommentSourceScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
};

/**
 * The boundary between the live runtime and the comment supply. Callers do not
 * know whether comments come from YouTube or a fixture. Comment bodies are
 * untrusted input: they are only rendered through text nodes after filtering.
 */
export interface CommentSource {
  start(): void | Promise<void>;
  stop(): void;
  onComment(listener: (comment: CommentEvent) => void): () => void;
  onStatus(listener: (status: CommentSourceStatus) => void): () => void;
  getStatus(): CommentSourceStatus;
  /** Manual `liveChatId` override, used by the console and `set_live_chat`. */
  setLiveChatId?(liveChatId: string): void;
}

export abstract class CommentSourceBase implements CommentSource {
  private readonly commentListeners = new Set<(comment: CommentEvent) => void>();
  private readonly statusListeners = new Set<(status: CommentSourceStatus) => void>();

  abstract start(): void | Promise<void>;
  abstract stop(): void;
  abstract getStatus(): CommentSourceStatus;

  onComment(listener: (comment: CommentEvent) => void): () => void {
    this.commentListeners.add(listener);
    return () => {
      this.commentListeners.delete(listener);
    };
  }

  onStatus(listener: (status: CommentSourceStatus) => void): () => void {
    this.statusListeners.add(listener);
    try {
      listener(this.getStatus());
    } catch (error) {
      console.error("[live comments] status listener failed", error);
    }
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  protected emitComment(comment: CommentEvent): void {
    for (const listener of [...this.commentListeners]) {
      try {
        listener(comment);
      } catch (error) {
        // One console listener must not stop comment delivery to the rest.
        console.error("[live comments] comment listener failed", error);
      }
    }
  }

  protected emitStatus(): void {
    const status = this.getStatus();
    for (const listener of [...this.statusListeners]) {
      try {
        listener(status);
      } catch (error) {
        console.error("[live comments] status listener failed", error);
      }
    }
  }
}
