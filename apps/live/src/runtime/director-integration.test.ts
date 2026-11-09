import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_LIVE_COMMENTS_CONFIG,
  livePackageShowSchema,
  liveRuntimeConfigSchema,
  type CommentCandidate,
  type LiveCue,
  type LivePackageShow,
} from "@kakeai/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { CommentFilter } from "../comments/filter.ts";
import { DirectorGenerationError, type Director } from "../director/director.ts";
import { GeneratedCueService } from "../director/generation-service.ts";
import { DirectorResponder } from "../director/response-responder.ts";
import type { CommentAnalyst } from "../llm/comment-analyst.ts";
import { RunStore } from "../runs/run-store.ts";
import { FakeCommentScheduler, flushMicrotasks } from "../testing/fake-scheduler.ts";
import { immediateTtsAdapter, wavBytes } from "../testing/fake-tts.ts";
import { ManualCommentSource } from "../testing/manual-comment-source.ts";
import { testCharacters, testShow } from "../testing/package-fixture.ts";
import { CommentCorner } from "./comment-corner.ts";
import { LiveController } from "./controller.ts";
import { DirectorRuntime } from "./director-runtime.ts";

const BASE_TIME = Date.parse("2026-11-07T12:00:00.000Z");
const tempRoots: string[] = [];

async function makeTemp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

async function removeTempRoot(dir: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      // RunStore logs are appended asynchronously; a write can land while the
      // temp tree is being removed. Retry briefly before failing the teardown.
      if ((error as NodeJS.ErrnoException).code !== "ENOTEMPTY" || attempt >= 9) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(removeTempRoot));
});

function candidate(commentId: string, score: number): CommentCandidate {
  return {
    commentId,
    score,
    safety: "ok",
    relevance: "high",
    isQuestion: true,
    reason: "理由",
    suggestedAngle: "補足する",
    safeSummary: `要約: ${commentId}`,
    safeQuestion: `質問: ${commentId}`,
    safeQuote: null,
    piiRedacted: true,
    urlsRemoved: true,
  };
}

function analyst(): CommentAnalyst {
  return {
    sourceKind: "fixture",
    async analyze(comments) {
      return {
        comments: comments.map((comment, index) =>
          candidate(comment.event.id, 0.9 - index * 0.1),
        ),
      };
    },
  };
}

function responseDirector(
  generate: (call: number) => Promise<Awaited<ReturnType<Director["generate"]>>>,
): { director: Director; calls: () => number } {
  let count = 0;
  return {
    director: {
      sourceKind: "fixture",
      generate: () => {
        count += 1;
        return generate(count);
      },
    },
    calls: () => count,
  };
}

function generatedCue(id: string, commentId: string, caption: string): LiveCue {
  return {
    id,
    origin: "live",
    speaker: "left",
    caption,
    speech: caption,
    expression: "normal",
    audio: "run:generated/placeholder.wav",
    durationMs: 1000,
    source: "generated",
    status: "ready",
    commentId,
  };
}

async function settle(rounds = 20): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await flushMicrotasks();
  }
}

async function waitForPlayback(
  controller: LiveController,
  cueId: string,
): Promise<void> {
  for (let index = 0; index < 200; index += 1) {
    if (controller.getState().playback?.cueId === cueId) {
      return;
    }
    await flushMicrotasks();
  }
  throw new Error(`playback did not reach ${cueId}`);
}

async function setup(options: { director?: Director; show?: LivePackageShow } = {}) {
  const dataDir = await makeTemp("kakeai-live-data-");
  const packageRoot = await makeTemp("kakeai-live-pkg-");
  const show = options.show ?? testShow({ includeCommentCorner: true });
  const scheduler = new FakeCommentScheduler();
  const now = () => new Date(BASE_TIME + scheduler.currentTimeMs);
  const runStore = await RunStore.create({
    dataDir,
    showTitle: show.show.title,
    packageId: "livepkg-test",
    packagePath: packageRoot,
    now,
  });
  const source = new ManualCommentSource(now);
  const holder: { current: DirectorRuntime | null } = { current: null };
  const director = options.director ?? responseDirector(async () => ({
    cues: [
      { speaker: "left", caption: "生成応答", speech: "せいせいおうとう", expression: "normal" },
    ],
    skip: false,
  })).director;
  const config = liveRuntimeConfigSchema.parse({
    llm: { mode: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "test-model" },
    tts: { adapters: { voicevox: { baseUrl: "http://127.0.0.1:50021" } } },
    port: 3010,
    dataDir,
  });
  const responder = new DirectorResponder({
    director,
    config,
    show,
    packageRoot,
    runDir: runStore.dir,
    fallbackCue: show.cues.find((cue) => cue.id === show.safety.fallbackCueId)!,
    host: () => holder.current,
    scheduler,
    now,
    adapterFor: () => immediateTtsAdapter(),
  });
  const corner = new CommentCorner({
    source,
    analyst: analyst(),
    filter: new CommentFilter({
      ngWords: [],
      blockedTopics: [],
      maxLength: 300,
      maxPerAuthorPerMinute: 3,
    }),
    commentsConfig: { ...DEFAULT_LIVE_COMMENTS_CONFIG, ngWords: [], cornerHoldMs: 4_000 },
    policy: show.commentPolicy,
    safety: show.safety,
    now,
    scheduler,
    responder,
    log: (input) => {
      runStore.appendEvent(input);
    },
    appendComment: (entry) => runStore.appendComment(entry),
  });
  const controller = new LiveController({
    runId: runStore.runId,
    show,
    characters: testCharacters(),
    runStore,
    now,
    comments: corner,
    leaseTtlMs: 24 * 60 * 60 * 1000,
  });
  const runtime = new DirectorRuntime({
    controller,
    runStore,
    show,
    characters: testCharacters(),
    comments: corner,
    scheduler,
    now,
  });
  holder.current = runtime;
  controller.setGeneratedCueCommands(
    new GeneratedCueService({
      show,
      config,
      packageRoot,
      runDir: runStore.dir,
      director,
      host: {
        getCue: (cueId) => controller.getCue(cueId),
        updateCue: (cueId, patch) => controller.updateCue(cueId, patch),
        setGeneration: (status) => controller.setGeneration(status),
        log: (input) => controller.recordEvent(input),
        notice: (level, message) => controller.notify(level, message),
        appendGeneratedText: (entry) => runStore.appendGeneratedText(entry),
        contextFor: (contextCandidate) => runtime.contextFor(contextCandidate),
        candidateFor: (commentId) => corner.getCandidate(commentId),
      },
      now,
      adapterFor: () => immediateTtsAdapter(),
    }),
  );
  controller.connectStage("stage-1");
  return { controller, source, corner, runStore, scheduler, show, runtime };
}

function audioEvent(controller: LiveController) {
  const playback = controller.getState().playback;
  if (playback === null) {
    throw new Error("no playback");
  }
  return {
    kind: "audio_ended" as const,
    runId: controller.runId,
    sessionId: "stage-1",
    cueId: playback.cueId,
    attempt: playback.attempt,
    sequence: playback.sequence,
  };
}

function endCurrent(controller: LiveController): void {
  controller.handleStageEvent("stage-1", audioEvent(controller));
}

async function reachCommentCorner(controller: LiveController): Promise<void> {
  expect(controller.handleCommand({ kind: "start" })).toEqual({ ok: true });
  endCurrent(controller);
  endCurrent(controller);
  await settle();
}

describe("director runtime integration", () => {
  it("plays generated cues for every comment and then reaches closing", async () => {
    const { controller, source, runStore, scheduler } = await setup();
    source.emit({ id: "c1", author: "みかん", text: "質問です" });
    source.emit({ id: "c2", author: "ゆず", text: "二つ目" });
    await reachCommentCorner(controller);
    await settle();
    await waitForPlayback(controller, "gen-c1-0");

    const snapshot = controller.getSnapshot();
    expect(snapshot.generation).toMatchObject({ phase: "ready", commentId: "c1" });
    expect(snapshot.queue.some((cue) => cue.source === "generated")).toBe(true);
    expect(snapshot.currentCueId).toBe("gen-c1-0");

    endCurrent(controller);
    await scheduler.advance(100);
    await settle();
    await waitForPlayback(controller, "gen-c2-0");
    expect(controller.getSnapshot().generation).toMatchObject({
      phase: "ready",
      commentId: "c2",
    });

    endCurrent(controller);
    await scheduler.advance(100);
    await settle();
    expect(controller.getState().phase).toBe("closing");
    expect(controller.getState().playback?.cueId).toBe("cue-closing");
    expect(controller.getSnapshot().generation).toBeNull();

    await runStore.finish({ status: "completed", phase: "closing" });
    const events = await readFile(join(runStore.dir, "events.jsonl"), "utf8");
    expect(events).toContain("cue_generated");
    expect(events).toContain("corner_started");
    expect(events).toContain("corner_finished");
    expect(events).not.toContain("質問です");
    expect(events).not.toContain("みかん");

    const generated = await readFile(join(runStore.dir, "generated-text.jsonl"), "utf8");
    expect(generated).toContain("生成応答");
    expect(generated).toContain("gen-c1-0");
    expect(generated).not.toContain("質問です");
    expect(generated).not.toContain("みかん");
    controller.dispose();
  });

  it("falls back once and keeps the script moving when generation fails", async () => {
    const first = responseDirector(async (call) => {
      if (call === 1) {
        throw new DirectorGenerationError("invalid", "不正な出力");
      }
      return {
        cues: [
          { speaker: "right", caption: "立て直し", speech: "たてなおし", expression: "normal" },
        ],
        skip: false,
      };
    });
    const { controller, source, runStore, scheduler } = await setup({
      director: first.director,
    });
    source.emit({ id: "c1", text: "失敗する質問" });
    source.emit({ id: "c2", text: "次の質問" });
    await reachCommentCorner(controller);
    await settle();
    await waitForPlayback(controller, "cue-fallback-fallback-1");

    expect(controller.getSnapshot().queue.some((cue) => cue.source === "fallback")).toBe(true);
    endCurrent(controller);
    await scheduler.advance(100);
    await settle();
    await waitForPlayback(controller, "gen-c2-0");
    expect(
      controller.getSnapshot().comments.find((entry) => entry.comment.id === "c1")?.state,
    ).toBe("skipped");

    endCurrent(controller);
    await scheduler.advance(100);
    await settle();
    expect(controller.getState().phase).toBe("closing");

    await runStore.finish({ status: "completed", phase: "closing" });
    const events = await readFile(join(runStore.dir, "events.jsonl"), "utf8");
    expect(events).toContain('"source":"fallback"');
    expect(events).toContain("error");
    controller.dispose();
  });

  it("clears generated cues and ends the corner in safe mode", async () => {
    const { controller, source, scheduler } = await setup();
    source.emit({ id: "c1", text: "質問" });
    await reachCommentCorner(controller);
    await settle();
    await waitForPlayback(controller, "gen-c1-0");

    expect(controller.handleCommand({ kind: "safe_mode" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("safe_mode");
    expect(controller.getState().comment).toBeNull();
    expect(controller.getSnapshot().commentCorner.state).toBe("finished");
    expect(controller.getSnapshot().queue.some((cue) => cue.source === "generated")).toBe(false);
    expect(controller.getSnapshot().generation).toBeNull();
    expect(controller.getState().playback?.cueId).toBe("cue-closing");
    await scheduler.advance(100);
    await settle();
    endCurrent(controller);
    expect(controller.getState().phase).toBe("post_show");
    controller.dispose();
  });

  it("finishes the current generated cue and enters closing when end is requested", async () => {
    const { controller, source, scheduler } = await setup();
    source.emit({ id: "c1", text: "最後の質問" });
    await reachCommentCorner(controller);
    await settle();
    await waitForPlayback(controller, "gen-c1-0");

    expect(controller.handleCommand({ kind: "end" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("comment");
    endCurrent(controller);
    await scheduler.advance(100);
    await settle();
    expect(controller.getState().phase).toBe("closing");
    expect(controller.getState().playback?.cueId).toBe("cue-closing");
    expect(controller.getSnapshot().generation).toBeNull();
    controller.dispose();
  });

  it("builds the director context from the corner, clock, captions and character sheet", async () => {
    const { controller, source, corner, runtime } = await setup();
    source.emit({ id: "c1", author: "みかん", text: "質問です" });
    controller.handleCommand({
      kind: "pin_comment",
      commentId: "c1",
      note: "質問として",
    });
    await reachCommentCorner(controller);
    await settle();
    await waitForPlayback(controller, "gen-c1-0");

    const contextCandidate = corner.getCandidate("c1");
    expect(contextCandidate).not.toBeNull();
    const context = runtime.contextFor(contextCandidate!);
    expect(context).toMatchObject({
      persona: "親しみやすい解説役",
      segmentLabel: "コメント",
      pinNote: "質問として",
      materialLabel: null,
      speakerNames: { left: "左", right: "右" },
    });
    expect(context.candidate.safeSummary).toBe("要約: c1");
    expect(context.expressions).toContain("normal");
    expect(context.recentCaptions).toContain("本編の話題です。");
    expect(context.segmentRemainingMs).toBeGreaterThan(0);
    expect(context.showRemainingMs).toBeGreaterThan(0);
    controller.dispose();
  });

  it("uses the current cue visual override for the director material label", async () => {
    const base = testShow({ includeMaterial: true });
    const show = livePackageShowSchema.parse({
      ...base,
      cues: base.cues.map((cue) =>
        cue.id === "cue-script" ? { ...cue, visual: null } : cue,
      ),
    });
    const { controller, runtime } = await setup({ show });
    expect(controller.handleCommand({ kind: "start" })).toEqual({ ok: true });
    endCurrent(controller);
    expect(controller.getState().playback?.cueId).toBe("cue-script");
    // The segment default is a material, but the current cue hides it.
    expect(controller.getState().visual).toBeNull();
    expect(runtime.contextFor(candidate("c1", 0.9)).materialLabel).toBeNull();
    controller.dispose();
  });

  it("removes generated cues on stop and continues with the next candidate on resume", async () => {
    const { controller, source, scheduler } = await setup();
    source.emit({ id: "c1", text: "一つ目" });
    source.emit({ id: "c2", text: "二つ目" });
    await reachCommentCorner(controller);
    await settle();
    await waitForPlayback(controller, "gen-c1-0");

    expect(controller.handleCommand({ kind: "stop" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("paused");
    expect(controller.getSnapshot().queue.some((cue) => cue.source === "generated")).toBe(false);
    expect(controller.getSnapshot().generation).toBeNull();

    expect(controller.handleCommand({ kind: "resume" })).toEqual({ ok: true });
    await scheduler.advance(100);
    await settle();
    await waitForPlayback(controller, "gen-c2-0");
    controller.dispose();
  });

  it("regenerates a queued generated cue and marks a failed regeneration", async () => {
    const scripted = responseDirector(async (call) => {
      if (call >= 3) {
        throw new DirectorGenerationError("llm", "再生成に失敗");
      }
      return {
        cues: [
          {
            speaker: "left",
            caption: `応答${call}`,
            speech: `おうとう${call}`,
            expression: "normal",
          },
        ],
        skip: false,
      };
    });
    const { controller, source, scheduler } = await setup({ director: scripted.director });
    source.emit({ id: "c1", text: "質問" });
    await reachCommentCorner(controller);
    await settle();
    await waitForPlayback(controller, "gen-c1-0");

    controller.enqueueGeneratedCues([
      generatedCue("regen-target", "c1", "初期応答"),
      generatedCue("regen-fail", "c1", "失敗応答"),
    ]);
    expect(
      controller.handleCommand({ kind: "regenerate_cue", cueId: "regen-target" }),
    ).toEqual({ ok: true });
    await settle();
    const regenerated = controller.getCue("regen-target");
    expect(regenerated).toMatchObject({
      caption: "応答2",
      speech: "おうとう2",
      status: "ready",
    });
    expect(regenerated?.audio).toMatch(/^run:generated\//u);

    expect(controller.handleCommand({ kind: "regenerate_cue", cueId: "regen-fail" })).toEqual({
      ok: true,
    });
    await settle();
    expect(controller.getCue("regen-fail")?.status).toBe("failed");

    endCurrent(controller);
    await scheduler.advance(100);
    await settle();
    controller.dispose();
  });
});
