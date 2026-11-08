import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_LIVE_COMMENTS_CONFIG,
  liveRuntimeConfigSchema,
  type CommentCandidate,
  type LiveCue,
  type LivePackageShow,
  type RunLogEvent,
} from "@kakeai/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { CommentFilter } from "../comments/filter.ts";
import type { Director } from "../director/director.ts";
import { GeneratedCueService } from "../director/generation-service.ts";
import type { DirectorContext } from "../director/prompt.ts";
import { DirectorResponder } from "../director/response-responder.ts";
import type { CommentAnalyst } from "../llm/comment-analyst.ts";
import { RunStore } from "../runs/run-store.ts";
import { FakeCommentScheduler, flushMicrotasks } from "../testing/fake-scheduler.ts";
import { fakeTtsAdapter, wavBytes } from "../testing/fake-tts.ts";
import { ManualCommentSource } from "../testing/manual-comment-source.ts";
import { createTestPackage } from "../testing/package-fixture.ts";
import { CommentCorner } from "./comment-corner.ts";
import { LiveController } from "./controller.ts";
import { DirectorRuntime } from "./director-runtime.ts";
import type { PlayoutScheduler } from "./playout.ts";

const BASE_TIME = Date.parse("2026-11-07T12:00:00.000Z");
const SHOW_DURATION_MS = 30 * 60 * 1000;
const tempRoots: string[] = [];

const RAW_COMMENT_TEXTS = [
  "今日のニュースについてどう思いますか？",
  "解説わかりやすいです",
  "http://example.com を見てください",
  "東京都渋谷区に住んでいます",
  "TTS失敗の質問です",
  "お前は無能だ",
  "2つ目のニュースも気になります",
];
const RAW_AUTHORS = ["みかん", "ゆず", "わるい人", "個人", "失敗さん", "攻撃", "まさ"];

async function makeTemp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function candidate(commentId: string, score: number): CommentCandidate {
  return {
    commentId,
    score,
    safety: "ok",
    relevance: "high",
    isQuestion: true,
    reason: "テスト候補",
    suggestedAngle: "短く補足する",
    safeSummary: `要約: ${commentId}`,
    safeQuestion: `質問: ${commentId}`,
    safeQuote: null,
    piiRedacted: true,
    urlsRemoved: true,
  };
}

function fakeAnalyst(): CommentAnalyst {
  return {
    sourceKind: "fixture",
    async analyze(comments) {
      return {
        comments: comments.map((comment, index) =>
          candidate(comment.event.id, 0.9 - index * 0.01),
        ),
      };
    },
  };
}

function fakeDirector(contexts: DirectorContext[]): Director {
  let calls = 0;
  return {
    sourceKind: "fixture",
    async generate(context) {
      contexts.push(context);
      calls += 1;
      if (context.candidate.safeSummary.includes("fail-tts")) {
        return {
          cues: [
            {
              speaker: "left",
              caption: "失敗する応答です。",
              speech: "TTS失敗",
              expression: "normal",
            },
          ],
          skip: false,
        };
      }
      if (context.candidate.safeSummary.includes("c1")) {
        return {
          cues: [
            {
              speaker: "left",
              caption: "ピンへの応答です。",
              speech: "ぴんへの おうとうです。",
              expression: "smile",
            },
            {
              speaker: "right",
              caption: "続けて補足します。",
              speech: "つづけて ほそくします。",
              expression: "normal",
            },
          ],
          skip: false,
        };
      }
      return {
        cues: [
          {
            speaker: "right",
            caption: `通常の応答${calls}です。`,
            speech: `つうじょうの おうとう${calls}です。`,
            expression: "normal",
          },
        ],
        skip: false,
      };
    },
  };
}

function manualGeneratedCue(id: string, caption: string): LiveCue {
  return {
    id,
    origin: "live",
    speaker: "left",
    caption,
    speech: caption,
    expression: "normal",
    audio: "run:generated/manual-delete.wav",
    durationMs: 1000,
    source: "generated",
    status: "ready",
    commentId: null,
  };
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

async function settle(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await flushMicrotasks();
  }
}

async function driveShow(
  controller: LiveController,
  scheduler: FakeCommentScheduler,
  onPlayback: (cueId: string) => Promise<void> | void,
): Promise<void> {
  let idleRounds = 0;
  for (let step = 0; step < 400; step += 1) {
    await settle();
    if (controller.getState().phase === "post_show") {
      return;
    }
    const playback = controller.getState().playback;
    if (playback !== null) {
      await onPlayback(playback.cueId);
      await settle();
      if (controller.getState().phase === "post_show") {
        return;
      }
      if (controller.getState().playback === null) {
        idleRounds = 0;
        continue;
      }
      endCurrent(controller);
      await settle();
      await scheduler.advance(100);
      idleRounds = 0;
      continue;
    }
    await scheduler.advance(100);
    await settle();
    const state = controller.getState();
    if (state.phase === "post_show") {
      return;
    }
    if (state.playback === null) {
      idleRounds += 1;
      if (idleRounds > 25) {
        throw new Error(
          `show did not progress: phase=${state.phase} corner=${controller.getSnapshot().commentCorner.state}`,
        );
      }
    } else {
      idleRounds = 0;
    }
  }
  throw new Error("show did not reach post_show");
}

async function setup() {
  const pkg = await createTestPackage({
    includeCommentCorner: true,
    commentCorners: 2,
    targetDurationMs: SHOW_DURATION_MS,
    fixtureComments: [
      { atMs: 1_000, author: "みかん", text: RAW_COMMENT_TEXTS[0]!, kind: "normal" },
      { atMs: 2_000, author: "ゆず", text: RAW_COMMENT_TEXTS[1]!, kind: "normal" },
    ],
  });
  tempRoots.push(pkg.rootDir);
  const show: LivePackageShow = pkg.show;
  const dataDir = await makeTemp("kakeai-live-p5-data-");
  const scheduler = new FakeCommentScheduler();
  const now = () => new Date(BASE_TIME + scheduler.currentTimeMs);
  const playoutScheduler: PlayoutScheduler = {
    setTimeout: (callback, ms) => scheduler.setTimeout(callback, ms),
    clearTimeout: (handle) => scheduler.clearTimeout(handle),
    now: () => BASE_TIME + scheduler.currentTimeMs,
  };
  const runStore = await RunStore.create({
    dataDir,
    showTitle: show.show.title,
    packageId: pkg.manifest.packageId,
    packagePath: pkg.rootDir,
    now,
  });
  const source = new ManualCommentSource(now);
  const holder: { current: DirectorRuntime | null } = { current: null };
  const contexts: DirectorContext[] = [];
  const director = fakeDirector(contexts);
  const tts = fakeTtsAdapter(async (request) => {
    if (request.text.includes("TTS失敗")) {
      throw new Error("TTS failure fixture");
    }
    return { data: wavBytes(), mediaType: "audio/wav" };
  });
  const config = liveRuntimeConfigSchema.parse({
    llm: { mode: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "test-model" },
    tts: { adapters: { voicevox: { baseUrl: "http://127.0.0.1:50021" } } },
    port: 3010,
    dataDir,
  });
  const fallbackCue = show.cues.find((cue) => cue.id === show.safety.fallbackCueId);
  if (fallbackCue === undefined) {
    throw new Error("fallback cue missing");
  }
  const responder = new DirectorResponder({
    director,
    config,
    show,
    packageRoot: pkg.rootDir,
    runDir: runStore.dir,
    fallbackCue,
    host: () => holder.current,
    scheduler,
    now,
    adapterFor: () => tts,
  });
  const corner = new CommentCorner({
    source,
    analyst: fakeAnalyst(),
    filter: new CommentFilter({
      ngWords: [],
      blockedTopics: [],
      maxLength: 300,
      maxPerAuthorPerMinute: 10,
    }),
    commentsConfig: { ...DEFAULT_LIVE_COMMENTS_CONFIG, ngWords: [], cornerHoldMs: 4_000 },
    policy: show.commentPolicy,
    safety: show.safety,
    now,
    scheduler,
    responder,
    log: (input) => runStore.appendEvent(input),
    appendComment: (entry) => runStore.appendComment(entry),
  });
  const controller = new LiveController({
    runId: runStore.runId,
    show,
    characters: pkg.characters,
    runStore,
    now,
    comments: corner,
    playoutScheduler,
    leaseTtlMs: 24 * 60 * 60 * 1000,
  });
  const runtime = new DirectorRuntime({
    controller,
    runStore,
    show,
    characters: pkg.characters,
    comments: corner,
    scheduler,
    now,
  });
  holder.current = runtime;
  controller.setGeneratedCueCommands(
    new GeneratedCueService({
      show,
      config,
      packageRoot: pkg.rootDir,
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
      adapterFor: () => tts,
    }),
  );
  controller.connectStage("stage-1");
  return { controller, source, scheduler, runStore, contexts, show };
}

describe("P5 30-minute fixture flow", () => {
  it("runs multiple comment corners with pins, AI responses, a fallback and logs", async () => {
    const { controller, source, scheduler, runStore, contexts, show } = await setup();
    expect(show.show.targetDurationMs).toBe(SHOW_DURATION_MS);
    expect(show.segments.map((segment) => segment.kind)).toEqual([
      "opening",
      "script",
      "comment",
      "script",
      "comment",
      "closing",
    ]);

    source.emit({ id: "c1", author: RAW_AUTHORS[0]!, text: RAW_COMMENT_TEXTS[0]!, kind: "normal" });
    source.emit({ id: "c2", author: RAW_AUTHORS[1]!, text: RAW_COMMENT_TEXTS[1]!, kind: "normal" });
    source.emit({ id: "c3", author: RAW_AUTHORS[2]!, text: RAW_COMMENT_TEXTS[2]!, kind: "normal" });
    expect(
      controller.handleCommand({ kind: "pin_comment", commentId: "c1", note: "質問として" }),
    ).toEqual({ ok: true });

    const flags = {
      deletedManualCue: false,
      edited: false,
      pinPlayed: false,
      editedPlayed: false,
      aiPlayed: false,
      secondCommentsSent: false,
      fallbackPlayed: false,
      recoveryPlayed: false,
      closingPlayed: false,
      nullAtScript2: false,
      nullAtClosing: false,
    };
    expect(controller.handleCommand({ kind: "start" })).toEqual({ ok: true });
    const generatedAudios: string[] = [];

    await driveShow(controller, scheduler, async (cueId) => {
      const playingCue = controller.getSnapshot().queue.find((cue) => cue.id === cueId);
      if (playingCue?.source === "generated" && playingCue.audio !== null) {
        generatedAudios.push(playingCue.audio);
      }
      if (cueId === "cue-opening" && !flags.deletedManualCue) {
        controller.enqueueGeneratedCues([manualGeneratedCue("manual-delete", "削除する生成キュー")]);
        expect(controller.handleCommand({ kind: "delete_cue", cueId: "manual-delete" })).toEqual({
          ok: true,
        });
        flags.deletedManualCue = true;
        return;
      }

      if (cueId === "gen-c1-0") {
        flags.pinPlayed = true;
        const snapshot = controller.getSnapshot();
        expect(snapshot.generation).toMatchObject({
          phase: "ready",
          commentId: "c1",
          cueIds: ["gen-c1-0", "gen-c1-1"],
        });
        expect(snapshot.commentCorner.selectedCommentIds.slice(0, 2)).toEqual(["c1", "c2"]);
        expect(controller.handleCommand({
          kind: "edit_cue",
          cueId: "gen-c1-1",
          caption: "編集した補足です。",
        })).toEqual({ ok: true });
        expect(controller.getCue("gen-c1-1")?.caption).toBe("編集した補足です。");
        flags.edited = true;
        return;
      }

      if (cueId === "gen-c1-1") {
        expect(controller.getCue("gen-c1-1")?.caption).toBe("編集した補足です。");
        flags.editedPlayed = true;
        return;
      }

      if (cueId === "gen-c2-0") {
        flags.aiPlayed = true;
        return;
      }

      if (cueId === "cue-script-2" && !flags.secondCommentsSent) {
        expect(controller.getSnapshot().generation).toBeNull();
        flags.nullAtScript2 = true;
        source.emit({ id: "c4", author: RAW_AUTHORS[3]!, text: RAW_COMMENT_TEXTS[3]! });
        source.emit({ id: "fail-tts", author: RAW_AUTHORS[4]!, text: RAW_COMMENT_TEXTS[4]! });
        source.emit({ id: "c6", author: RAW_AUTHORS[5]!, text: RAW_COMMENT_TEXTS[5]! });
        source.emit({ id: "c7", author: RAW_AUTHORS[6]!, text: RAW_COMMENT_TEXTS[6]! });
        flags.secondCommentsSent = true;
        return;
      }

      if (cueId === "cue-opening-fallback-1") {
        flags.fallbackPlayed = true;
        const snapshot = controller.getSnapshot();
        expect(snapshot.generation).toMatchObject({ phase: "failed", commentId: "fail-tts" });
        expect(snapshot.generation?.error).not.toBeNull();
        expect(snapshot.queue.find((cue) => cue.id === cueId)?.source).toBe("fallback");
        expect(snapshot.commentCorner.selectedCommentIds).toEqual(["fail-tts", "c7"]);
        return;
      }

      if (cueId.startsWith("gen-c7-")) {
        flags.recoveryPlayed = true;
        return;
      }

      if (cueId === "cue-closing") {
        flags.closingPlayed = true;
        expect(controller.getSnapshot().generation).toBeNull();
        flags.nullAtClosing = true;
      }
    });

    expect(controller.getState().phase).toBe("post_show");
    expect(flags).toMatchObject({
      deletedManualCue: true,
      edited: true,
      pinPlayed: true,
      editedPlayed: true,
      aiPlayed: true,
      secondCommentsSent: true,
      fallbackPlayed: true,
      recoveryPlayed: true,
      closingPlayed: true,
      nullAtScript2: true,
      nullAtClosing: true,
    });
    expect(controller.getSnapshot().generation).toBeNull();

    await runStore.finish({ status: "completed", phase: "post_show" });

    expect(generatedAudios.length).toBeGreaterThanOrEqual(4);
    for (const audio of generatedAudios) {
      expect(audio).toMatch(/^run:generated\/.+\.wav$/u);
    }
    const generatedFiles = await readdir(join(runStore.dir, "generated"));
    expect(generatedFiles.some((file) => file.endsWith(".wav"))).toBe(true);
    expect(controller.getSnapshot().comments.find((entry) => entry.comment.id === "c3")?.decision).toBe(
      "blocked",
    );
    expect(controller.getSnapshot().comments.find((entry) => entry.comment.id === "c4")?.decision).toBe(
      "blocked",
    );
    expect(controller.getSnapshot().comments.find((entry) => entry.comment.id === "c6")?.decision).toBe(
      "blocked",
    );
    expect(contexts.length).toBeGreaterThan(0);
    for (const context of contexts) {
      for (const raw of RAW_COMMENT_TEXTS) {
        expect(context.candidate.safeSummary).not.toContain(raw);
      }
    }

    const eventsText = await readFile(join(runStore.dir, "events.jsonl"), "utf8");
    const generatedText = await readFile(join(runStore.dir, "generated-text.jsonl"), "utf8");
    const events = eventsText
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as RunLogEvent);
    const types = events.map((event) => event.type);
    expect(types.filter((type) => type === "corner_started")).toHaveLength(2);
    expect(types.filter((type) => type === "corner_finished")).toHaveLength(2);
    expect(types).toContain("cue_generated");
    expect(types).toContain("cue_edited");
    expect(types).toContain("cue_deleted");
    expect(
      events.some((event) => event.type === "cue_generated" && event.data.source === "fallback"),
    ).toBe(true);
    const selected = events.filter((event) => event.type === "comment_selected");
    expect(selected[0]).toMatchObject({ commentId: "c1", data: { pinned: true, index: 0 } });

    for (const raw of [...RAW_COMMENT_TEXTS, ...RAW_AUTHORS]) {
      expect(eventsText).not.toContain(raw);
      expect(generatedText).not.toContain(raw);
    }
    expect(generatedText).toContain("ピンへの応答です。");
    expect(generatedText).toContain("gen-c1-1");

    controller.dispose();
  });
});
