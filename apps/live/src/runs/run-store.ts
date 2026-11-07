import { randomBytes } from "node:crypto";
import { appendFile, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  runLogEventSchema,
  type RunLogEvent,
  type RunLogEventType,
} from "@kakeai/contracts";

export interface RunStoreOptions {
  dataDir: string;
  showTitle: string;
  packageId: string;
  packagePath: string;
  runId?: string;
  now?: () => Date;
}

export interface RunLogEventInput {
  type: RunLogEventType;
  cueId?: string | null;
  commentId?: string | null;
  data?: RunLogEvent["data"];
}

export interface RunResult {
  status: "completed" | "stopped" | "failed";
  [key: string]: unknown;
}

interface RunMetadata {
  schemaVersion: 1;
  runId: string;
  show: { title: string };
  package: { packageId: string; path: string };
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "finished";
  result: RunResult | null;
}

function makeRunId(now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/[-:.]/g, "")
    .replace("Z", "");
  return `run-${stamp}-${randomBytes(3).toString("hex")}`;
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

/**
 * Per-run append-only logs. The run directory is independent of the immutable
 * package: generated audio, events, errors and metadata all live here.
 */
export class RunStore {
  readonly runId: string;
  readonly dir: string;
  private sequence = 0;
  private tail: Promise<void> = Promise.resolve();
  private pendingWrites = 0;
  private metadata: RunMetadata;
  private finishPromise: Promise<void> | null = null;

  private constructor(
    private readonly options: RunStoreOptions,
    runId: string,
    dir: string,
    metadata: RunMetadata,
  ) {
    this.runId = runId;
    this.dir = dir;
    this.metadata = metadata;
  }

  static async create(options: RunStoreOptions): Promise<RunStore> {
    const now = options.now ?? (() => new Date());
    const startedAt = now();
    const runId = options.runId ?? makeRunId(startedAt);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(runId)) {
      throw new Error(`runId に使用できない文字が含まれています: ${runId}`);
    }
    const dir = join(options.dataDir, "runs", runId);
    await mkdir(join(dir, "generated"), { recursive: true });
    const metadata: RunMetadata = {
      schemaVersion: 1,
      runId,
      show: { title: options.showTitle },
      package: { packageId: options.packageId, path: options.packagePath },
      startedAt: startedAt.toISOString(),
      finishedAt: null,
      status: "running",
      result: null,
    };
    const store = new RunStore(options, runId, dir, metadata);
    await Promise.all([
      writeJsonAtomic(join(dir, "run.json"), metadata),
      store.touchLog("events.jsonl"),
      store.touchLog("cues.jsonl"),
      store.touchLog("comments.jsonl"),
      store.touchLog("generated-text.jsonl"),
      store.touchLog("errors.log"),
    ]);
    return store;
  }

  private async touchLog(name: string): Promise<void> {
    await writeFile(join(this.dir, name), "", { flag: "a" });
  }

  private enqueue(task: () => Promise<void>): void {
    this.pendingWrites += 1;
    this.tail = this.tail
      .then(task)
      .catch((error: unknown) => {
        console.error(`[live run-store] ログの追記に失敗しました (${this.runId})`, error);
      })
      .finally(() => {
        this.pendingWrites -= 1;
      });
  }

  private async drain(): Promise<void> {
    while (this.pendingWrites > 0) {
      await this.tail;
    }
  }

  private now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }

  appendEvent(input: RunLogEventInput): RunLogEvent {
    this.sequence += 1;
    const event: RunLogEvent = {
      schemaVersion: 1,
      runId: this.runId,
      sequence: this.sequence,
      at: this.now().toISOString(),
      type: input.type,
      ...(input.cueId === undefined ? {} : { cueId: input.cueId }),
      ...(input.commentId === undefined ? {} : { commentId: input.commentId }),
      data: input.data ?? {},
    };
    const validated = runLogEventSchema.safeParse(event);
    const safeEvent: RunLogEvent = validated.success
      ? validated.data
      : { ...event, data: {} };
    if (!validated.success) {
      this.appendError(
        `run log event が契約に一致しません: ${validated.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join(" / ")}`,
      );
    }
    this.enqueue(async () => {
      await appendFile(join(this.dir, "events.jsonl"), `${JSON.stringify(safeEvent)}\n`, "utf8");
    });
    return safeEvent;
  }

  appendCue(entry: Record<string, unknown>): void {
    this.appendJsonLine("cues.jsonl", entry);
  }

  appendComment(entry: Record<string, unknown>): void {
    this.appendJsonLine("comments.jsonl", entry);
  }

  appendGeneratedText(entry: Record<string, unknown>): void {
    this.appendJsonLine("generated-text.jsonl", entry);
  }

  appendError(message: string): void {
    const line = `[${this.now().toISOString()}] ${message}\n`;
    this.enqueue(async () => {
      await appendFile(join(this.dir, "errors.log"), line, "utf8");
    });
  }

  private appendJsonLine(name: string, entry: Record<string, unknown>): void {
    const line = `${JSON.stringify({ at: this.now().toISOString(), ...entry })}\n`;
    this.enqueue(async () => {
      await appendFile(join(this.dir, name), line, "utf8");
    });
  }

  finish(result: RunResult): Promise<void> {
    if (this.finishPromise !== null) {
      return this.finishPromise;
    }
    this.finishPromise = this.finishInternal(result);
    return this.finishPromise;
  }

  private async finishInternal(result: RunResult): Promise<void> {
    await this.drain();
    this.metadata = {
      ...this.metadata,
      finishedAt: this.now().toISOString(),
      status: "finished",
      result,
    };
    await writeJsonAtomic(join(this.dir, "run.json"), this.metadata);
  }
}
