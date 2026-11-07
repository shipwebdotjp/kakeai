import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_LIVE_COMMENTS_CONFIG,
  liveRuntimeConfigSchema,
  type CommentCandidate,
  type LiveFixtureComment,
} from "@kakeai/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CommentFilter } from "../comments/filter.ts";
import { createCommentSource } from "../comments/factory.ts";
import type { CommentAnalyst } from "../llm/comment-analyst.ts";
import { loadLivePackage, type LoadedLivePackage } from "../package/loader.ts";
import { CommentCorner } from "../runtime/comment-corner.ts";
import { RunStore } from "../runs/run-store.ts";
import { FakeCommentScheduler, flushMicrotasks } from "../testing/fake-scheduler.ts";
import { createTestPackage, type TestPackage } from "../testing/package-fixture.ts";
import { createLiveServer, type LiveServer } from "./server.ts";

const BASE_TIME = Date.parse("2026-11-07T12:00:00.000Z");

const FIXTURE: LiveFixtureComment[] = [
  { atMs: 500, author: "みかん", text: "質問です。次の話題は何ですか？", kind: "normal" },
  { atMs: 1_000, author: "ゆず", text: "とても分かりやすかったです", kind: "normal" },
  { atMs: 1_500, author: "spam", text: "連絡先は taro@example.com です", kind: "normal" },
];

function candidate(commentId: string, score: number): CommentCandidate {
  return {
    commentId,
    score,
    safety: "ok",
    relevance: "high",
    isQuestion: commentId.endsWith("1"),
    reason: "理由",
    suggestedAngle: "補足する",
    safeSummary: `要約: ${commentId}`,
    safeQuestion: `質問: ${commentId}`,
    safeQuote: null,
    piiRedacted: true,
    urlsRemoved: true,
  };
}

const tempRoots: string[] = [];
let pkg: TestPackage;
let loaded: LoadedLivePackage;
let server: LiveServer;
let scheduler: FakeCommentScheduler;

async function makeTemp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

beforeEach(async () => {
  pkg = await createTestPackage({
    includeCommentCorner: true,
    fixtureComments: FIXTURE,
  });
  tempRoots.push(pkg.rootDir);
  loaded = await loadLivePackage(pkg.rootDir);
  const dataDir = await makeTemp("kakeai-live-data-");
  const distDir = await makeTemp("kakeai-live-dist-");
  const config = liveRuntimeConfigSchema.parse({
    llm: { mode: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "test-model" },
    tts: { adapters: {} },
    port: 3010,
    dataDir,
  });
  scheduler = new FakeCommentScheduler();
  const now = () => new Date(BASE_TIME + scheduler.currentTimeMs);
  const source = await createCommentSource({
    show: loaded.show,
    packageRoot: loaded.rootDir,
    testMode: true,
    config,
    scheduler,
    now,
  });
  const runStore = await RunStore.create({
    dataDir,
    showTitle: loaded.show.show.title,
    packageId: loaded.manifest.packageId,
    packagePath: loaded.rootDir,
    now,
  });
  const analyst: CommentAnalyst = {
    sourceKind: "fixture",
    async analyze(comments) {
      return {
        comments: comments.map((comment, index) =>
          candidate(comment.event.id, index === 0 ? 0.9 : 0.4),
        ),
      };
    },
  };
  const corner = new CommentCorner({
    source,
    analyst,
    filter: new CommentFilter({
      ngWords: [],
      blockedTopics: [],
      maxLength: 300,
      maxPerAuthorPerMinute: 3,
    }),
    commentsConfig: { ...DEFAULT_LIVE_COMMENTS_CONFIG, ngWords: [], cornerHoldMs: 4_000 },
    policy: loaded.show.commentPolicy,
    safety: loaded.show.safety,
    now,
    scheduler,
    log: (input) => {
      runStore.appendEvent(input);
    },
    appendComment: (entry) => runStore.appendComment(entry),
  });
  server = await createLiveServer({
    package: loaded,
    config,
    port: 0,
    distDir,
    testMode: true,
    runStore,
    now,
    commentCorner: corner,
  });
});

afterEach(async () => {
  await server?.close();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("comment corner integration", () => {
  it("runs a fixture-backed corner from the 10-minute-style package", async () => {
    expect(server.controller.handleCommand({ kind: "start" })).toEqual({ ok: true });
    await scheduler.advance(1_500);
    expect(server.controller.getSnapshot().comments.map((entry) => entry.comment.id)).toEqual([
      "fixture-g1-1",
      "fixture-g1-2",
      "fixture-g1-3",
    ]);
    expect(
      server.controller
        .getSnapshot()
        .comments.find((entry) => entry.comment.id === "fixture-g1-3")?.decision,
    ).toBe("blocked");

    expect(server.controller.handleCommand({ kind: "skip_cue" })).toEqual({ ok: true });
    expect(server.controller.handleCommand({ kind: "skip_cue" })).toEqual({ ok: true });
    await flushMicrotasks();

    expect(server.controller.getState().phase).toBe("comment");
    expect(server.controller.getSnapshot().commentCorner.state).toBe("running");
    expect(server.controller.getSnapshot().commentCorner.selectedCommentIds).toEqual([
      "fixture-g1-1",
      "fixture-g1-2",
    ]);
    expect(server.controller.getState().comment).toMatchObject({
      commentId: "fixture-g1-1",
      text: "要約: fixture-g1-1",
    });

    await scheduler.advance(4_000);
    expect(server.controller.getState().comment?.commentId).toBe("fixture-g1-2");
    await scheduler.advance(4_000);
    await flushMicrotasks();
    expect(server.controller.getSnapshot().commentCorner.state).toBe("finished");
    expect(server.controller.getState().phase).toBe("closing");

    // `close` drains the append-only log queue before the files are read.
    await server.close();
    const commentsLog = await readFile(join(server.runStore.dir, "comments.jsonl"), "utf8");
    expect(commentsLog).toContain("fixture-g1-1");
    expect(commentsLog).toContain("[メール]");
    expect(commentsLog).not.toContain("taro@example.com");
    expect(commentsLog).not.toContain("みかん");

    const eventsLog = await readFile(join(server.runStore.dir, "events.jsonl"), "utf8");
    expect(eventsLog).toContain("corner_started");
    expect(eventsLog).toContain("comment_selected");
    expect(eventsLog).toContain("corner_finished");
    expect(eventsLog).not.toContain("taro@example.com");
    expect(eventsLog).not.toContain("みかん");
  });
});
