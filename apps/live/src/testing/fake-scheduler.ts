import type { CommentSourceScheduler } from "../comments/source.ts";

interface ScheduledTask {
  callback: () => void;
  dueAtMs: number;
  order: number;
}

/**
 * Deterministic scheduler for tests. Tests advance logical time and never wait
 * for wall-clock delays. `flushMicrotasks` only yields one zero-time tick to
 * let already-started promises settle.
 */
export class FakeCommentScheduler implements CommentSourceScheduler {
  private nowMs = 0;
  private nextHandle = 1;
  private nextOrder = 1;
  private readonly tasks = new Map<number, ScheduledTask>();

  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.tasks.set(handle, {
      callback,
      dueAtMs: this.nowMs + (Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0),
      order: this.nextOrder,
    });
    this.nextOrder += 1;
    return handle as unknown as ReturnType<typeof setTimeout>;
  }

  clearTimeout(handle: ReturnType<typeof setTimeout>): void {
    this.tasks.delete(handle as unknown as number);
  }

  get pendingCount(): number {
    return this.tasks.size;
  }

  get currentTimeMs(): number {
    return this.nowMs;
  }

  get pendingDelaysMs(): number[] {
    return [...this.tasks.values()]
      .map((task) => task.dueAtMs - this.nowMs)
      .sort((left, right) => left - right);
  }

  /** Runs all tasks due within `ms`, in due-time order. */
  async advance(ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new RangeError(`advance(ms) には 0 以上の有限値を指定してください: ${String(ms)}`);
    }
    const target = this.nowMs + ms;
    for (let iterations = 0; ; iterations += 1) {
      if (iterations > 10_000) {
        throw new Error("FakeCommentScheduler.advance: too many timers (zero-delay loop?)");
      }
      const due = [...this.tasks.entries()]
        .filter(([, task]) => task.dueAtMs <= target)
        .sort((left, right) =>
          left[1].dueAtMs === right[1].dueAtMs
            ? left[1].order - right[1].order
            : left[1].dueAtMs - right[1].dueAtMs,
        )[0];
      if (due === undefined) {
        break;
      }
      const [handle, task] = due;
      this.tasks.delete(handle);
      this.nowMs = Math.max(this.nowMs, task.dueAtMs);
      try {
        task.callback();
      } finally {
        await flushMicrotasks();
      }
    }
    this.nowMs = target;
  }

  async runNext(): Promise<void> {
    const due = [...this.tasks.entries()].sort((left, right) =>
      left[1].dueAtMs === right[1].dueAtMs
        ? left[1].order - right[1].order
        : left[1].dueAtMs - right[1].dueAtMs,
    )[0];
    if (due === undefined) {
      return;
    }
    const [handle, task] = due;
    this.tasks.delete(handle);
    this.nowMs = Math.max(this.nowMs, task.dueAtMs);
    try {
      task.callback();
    } finally {
      await flushMicrotasks();
    }
  }
}

export async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
