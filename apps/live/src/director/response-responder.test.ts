import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  liveRuntimeConfigSchema,
  type CommentCandidate,
  type LiveCue,
  type LiveGenerationStatus,
  type LivePackageShow,
  type LiveRuntimeConfig,
  type TtsAdapter,
} from "@kakeai/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { CommentSourceScheduler } from "../comments/source.ts";
import { DirectorGenerationError, type Director } from "./director.ts";
import type { DirectorContext } from "./prompt.ts";
import {
  DirectorResponder,
  type DirectorResponseHost,
} from "./response-responder.ts";
import { FakeCommentScheduler, flushMicrotasks } from "../testing/fake-scheduler.ts";
import { fakeTtsAdapter, immediateTtsAdapter, wavBytes } from "../testing/fake-tts.ts";
import { testShow } from "../testing/package-fixture.ts";
import type { RunLogEventInput } from "../runs/run-store.ts";

const BASE_TIME = Date.parse("2026-11-07T12:00:00.000Z");
const tempRoots: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function config(overrides: { maxConcurrentTts?: number } = {}): LiveRuntimeConfig {
  return liveRuntimeConfigSchema.parse({
    llm: { mode: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "test-model" },
    tts: {
      adapters: { voicevox: { baseUrl: "http://127.0.0.1:50021" } },
      ...(overrides.maxConcurrentTts === undefined
        ? {}
        : { maxConcurrentTts: overrides.maxConcurrentTts }),
    },
    port: 3010,
    dataDir: "/tmp/kakeai-live-test",
  });
}

function candidate(commentId: string): CommentCandidate {
  return {
    commentId,
    score: 0.8,
    safety: "ok",
    relevance: "high",
    isQuestion: false,
    reason: "理由",
    suggestedAngle: "補足する",
    safeSummary: `要約: ${commentId}`,
    safeQuestion: `質問: ${commentId}`,
    safeQuote: null,
    piiRedacted: true,
    urlsRemoved: true,
  };
}

function context(forCandidate: CommentCandidate): DirectorContext {
  return {
    persona: "親しみやすい解説役",
    blockedTopics: [],
    maxResponseChars: 180,
    maxResponseCues: 2,
    segmentLabel: "コメント",
    segmentRemainingMs: 120_000,
    showRemainingMs: 300_000,
    recentCaptions: [],
    candidate: {
      safeSummary: forCandidate.safeSummary,
      safeQuestion: forCandidate.safeQuestion,
      suggestedAngle: forCandidate.suggestedAngle,
    },
    pinNote: null,
    materialLabel: null,
    expressions: ["normal", "smile"],
    speakerNames: { left: "左", right: "右" },
  };
}

function output(cues: number): Awaited<ReturnType<Director["generate"]>> {
  return {
    cues: Array.from({ length: cues }, (_value, index) => ({
      speaker: index % 2 === 0 ? ("left" as const) : ("none" as const),
      caption: `応答${index}`,
      speech: `おうとう${index}`,
      expression: "smile",
    })),
    skip: false,
  };
}

function directorWith(
  generate: (context: DirectorContext) => Promise<Awaited<ReturnType<Director["generate"]>>>,
): Director {
  return { sourceKind: "fixture", generate };
}

class TestHost implements DirectorResponseHost {
  generation: Array<LiveGenerationStatus | null> = [];
  played: LiveCue[][] = [];
  waits: Array<{ cueIds: string[]; timeoutMs: number }> = [];
  logs: RunLogEventInput[] = [];
  texts: Array<Record<string, unknown>> = [];
  notices: Array<{ level: "info" | "warning" | "error"; message: string }> = [];
  stopped = false;
  waitResult: "done" | "stopped" = "done";
  waitResults: Array<"done" | "stopped"> = [];
  deferWaits = false;
  waitDeferred: Array<() => void> = [];

  contextFor(forCandidate: CommentCandidate): DirectorContext {
    return context(forCandidate);
  }

  playGeneratedCues(cues: LiveCue[]): void {
    this.played.push(cues.map((cue) => ({ ...cue })));
  }

  waitForCues(cueIds: string[], timeoutMs: number): Promise<"done" | "stopped"> {
    this.waits.push({ cueIds, timeoutMs });
    const queued = this.waitResults.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    if (this.waitResult !== "done") {
      return Promise.resolve(this.waitResult);
    }
    if (this.deferWaits) {
      return new Promise((resolve) => {
        this.waitDeferred.push(() => resolve("done"));
      });
    }
    return Promise.resolve("done");
  }

  setGeneration(status: LiveGenerationStatus | null): void {
    this.generation.push(status);
  }

  log(input: RunLogEventInput): void {
    this.logs.push(input);
  }

  appendGeneratedText(entry: Record<string, unknown>): void {
    this.texts.push(entry);
  }

  notice(level: "info" | "warning" | "error", message: string): void {
    this.notices.push({ level, message });
  }

  isStopped(): boolean {
    return this.stopped;
  }

  releaseWaits(): void {
    for (const release of this.waitDeferred.splice(0)) {
      release();
    }
  }
}

async function settle(rounds = 20): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await flushMicrotasks();
  }
}

interface ResponderOptions {
  director?: Director;
  adapter?: TtsAdapter;
  scheduler?: CommentSourceScheduler;
  show?: LivePackageShow;
  config?: LiveRuntimeConfig;
}

async function setup(options: ResponderOptions = {}) {
  const runDir = await tempDir("kakeai-live-run-");
  const packageRoot = await tempDir("kakeai-live-pkg-");
  const show = options.show ?? testShow();
  const scheduler = options.scheduler ?? new FakeCommentScheduler();
  const host = new TestHost();
  const director = options.director ?? directorWith(async () => output(1));
  const responder = new DirectorResponder({
    director,
    config: options.config ?? config(),
    show,
    packageRoot,
    runDir,
    fallbackCue: show.cues.find((cue) => cue.id === show.safety.fallbackCueId)!,
    host: () => host,
    scheduler,
    now: () =>
      new Date(
        BASE_TIME +
          (scheduler instanceof FakeCommentScheduler ? scheduler.currentTimeMs : 0),
      ),
    adapterFor: () => options.adapter ?? immediateTtsAdapter(),
  });
  return { responder, host, show, scheduler, runDir };
}

describe("DirectorResponder", () => {
  it("generates, synthesizes and plays a response, then clears generation", async () => {
    const { responder, host } = await setup();
    responder.prepare([candidate("c1")]);
    await settle();

    const outcome = await responder.respond(candidate("c1"));
    expect(outcome).toBe("done");
    expect(host.played).toHaveLength(1);
    const cue = host.played[0]?.[0];
    expect(cue).toMatchObject({
      id: "gen-c1-0",
      origin: "live",
      speaker: "left",
      source: "generated",
      status: "ready",
      commentId: "c1",
    });
    expect(cue).not.toHaveProperty("sourceLineId");
    expect(cue?.audio).toMatch(/^run:generated\/gen-c1-0-.+\.wav$/u);
    expect(cue?.durationMs).toBeGreaterThan(0);
    expect(host.waits[0]?.cueIds).toEqual(["gen-c1-0"]);
    expect(host.waits[0]?.timeoutMs).toBe((cue?.durationMs ?? 0) + 10_000 + 2_000);

    const phases = host.generation.map((status) => status?.phase ?? null);
    expect(phases[0]).toBe("thinking");
    expect(phases).toContain("preparing");
    expect(phases).toContain("ready");
    expect(phases.at(-1)).toBeNull();

    expect(host.texts).toHaveLength(1);
    expect(host.texts[0]).toMatchObject({
      event: "generated",
      commentId: "c1",
      cueId: "gen-c1-0",
      caption: "応答0",
      speech: "おうとう0",
    });
    expect(host.texts[0]).not.toHaveProperty("author");
    expect(host.logs.some((event) => event.type === "cue_generated")).toBe(true);
  });

  it("falls back once when the director fails and skips to the next candidate", async () => {
    const failing = directorWith(async () => {
      throw new DirectorGenerationError("invalid", "不正な出力");
    });
    const { responder, host } = await setup({ director: failing });
    responder.prepare([candidate("c1"), candidate("c2")]);
    await settle();

    await expect(responder.respond(candidate("c1"))).resolves.toBe("failed");
    expect(host.played).toHaveLength(1);
    expect(host.played[0]?.[0]).toMatchObject({
      source: "fallback",
      status: "ready",
      commentId: null,
    });
    await expect(responder.respond(candidate("c2"))).resolves.toBe("failed");
    expect(host.played).toHaveLength(1);
    expect(host.generation.some((status) => status?.phase === "failed")).toBe(true);
    expect(host.generation.at(-1)).toBeNull();
    expect(host.logs.some((event) => event.type === "error")).toBe(true);
    expect(host.notices.some((entry) => entry.level === "warning")).toBe(true);
  });

  it("falls back after a TTS failure and continues with the next candidate", async () => {
    let calls = 0;
    const adapter = fakeTtsAdapter(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("engine down");
      }
      return { data: wavBytes(), mediaType: "audio/wav" };
    });
    const { responder, host } = await setup({ adapter });
    responder.prepare([candidate("c1"), candidate("c2")]);
    await settle();

    await expect(responder.respond(candidate("c1"))).resolves.toBe("failed");
    await expect(responder.respond(candidate("c2"))).resolves.toBe("done");
    expect(host.played.map((cues) => cues[0]?.source)).toEqual(["fallback", "generated"]);
  });

  it("falls back when the response is not ready within maxThinkingMs", async () => {
    const slow = directorWith(
      async () => new Promise<Awaited<ReturnType<Director["generate"]>>>(() => undefined),
    );
    const scheduler = new FakeCommentScheduler();
    const { responder, host } = await setup({ director: slow, scheduler });
    responder.prepare([candidate("c1")]);
    const pending = responder.respond(candidate("c1"));
    await scheduler.advance(2_000);
    await settle();
    await expect(pending).resolves.toBe("failed");
    expect(host.played).toHaveLength(1);
    expect(host.played[0]?.[0]?.source).toBe("fallback");
  });

  it("falls back when waiting for generated playback times out", async () => {
    const { responder, host } = await setup();
    host.waitResults = ["stopped", "done"];
    responder.prepare([candidate("c1")]);
    await settle();

    await expect(responder.respond(candidate("c1"))).resolves.toBe("failed");
    expect(host.played.map((cues) => cues[0]?.source)).toEqual(["generated", "fallback"]);
  });

  it("keeps waiting through pause/resume and stops the current response", async () => {
    const { responder, host } = await setup();
    responder.prepare([candidate("c1")]);
    await settle();
    host.deferWaits = true;
    const pending = responder.respond(candidate("c1"));
    await settle();
    expect(host.played).toHaveLength(1);

    responder.pause();
    responder.resume();
    host.releaseWaits();
    await expect(pending).resolves.toBe("done");
    expect(host.generation.at(-1)).toBeNull();

    host.deferWaits = true;
    const stopped = responder.respond(candidate("c1"));
    await settle();
    responder.stop();
    await expect(stopped).resolves.toBe("stopped");
    host.releaseWaits();
  });

  it("never exceeds maxConcurrentTts even when several candidates are prepared", async () => {
    let active = 0;
    let maxActive = 0;
    const pending: Array<() => void> = [];
    const adapter = fakeTtsAdapter(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => {
        pending.push(resolve);
      });
      active -= 1;
      return { data: wavBytes(), mediaType: "audio/wav" };
    });
    const { responder } = await setup({
      director: directorWith(async () => output(2)),
      adapter,
      config: config({ maxConcurrentTts: 2 }),
    });
    responder.prepare([candidate("c1"), candidate("c2"), candidate("c3")]);
    await settle();
    expect(active).toBe(2);
    for (let index = 0; index < 20 && pending.length > 0; index += 1) {
      pending.shift()?.();
      await settle();
    }
    await settle();
    expect(maxActive).toBe(2);
  });
});
