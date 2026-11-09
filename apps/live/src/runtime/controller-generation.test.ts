import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  liveRuntimeConfigSchema,
  type LiveCue,
  type LivePackageShow,
  type TtsAdapter,
} from "@kakeai/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { Director } from "../director/director.ts";
import { GeneratedCueService } from "../director/generation-service.ts";
import { flushMicrotasks } from "../testing/fake-scheduler.ts";
import { immediateTtsAdapter, wavBytes } from "../testing/fake-tts.ts";
import { testCharacters, testShow } from "../testing/package-fixture.ts";
import { LiveController } from "./controller.ts";

const tempRoots: string[] = [];

async function makeTemp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function generatedCue(id: string, caption: string): LiveCue {
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
    commentId: "c1",
  };
}

async function settle(rounds = 20): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await flushMicrotasks();
  }
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

async function setup(
  options: { adapter?: TtsAdapter; director?: Director; show?: LivePackageShow } = {},
) {
  const packageRoot = await makeTemp("kakeai-live-pkg-");
  const runDir = await makeTemp("kakeai-live-run-");
  const show = options.show ?? testShow();
  const config = liveRuntimeConfigSchema.parse({
    llm: { mode: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "test-model" },
    tts: { adapters: { voicevox: { baseUrl: "http://127.0.0.1:50021" } } },
    port: 3010,
    dataDir: "/tmp/kakeai-live-test",
  });
  const director: Director = options.director ?? {
    sourceKind: "fixture",
    async generate() {
      return {
        cues: [
          { speaker: "left", caption: "再生成応答", speech: "さいせいせい", expression: "normal" },
        ],
        skip: false,
      };
    },
  };
  const controller = new LiveController({
    runId: "run-test",
    show,
    characters: testCharacters(),
    leaseTtlMs: 24 * 60 * 60 * 1000,
  });
  controller.connectStage("stage-1");
  controller.setGeneratedCueCommands(
    new GeneratedCueService({
      show,
      config,
      packageRoot,
      runDir,
      director,
      host: {
        getCue: (cueId) => controller.getCue(cueId),
        updateCue: (cueId, patch) => controller.updateCue(cueId, patch),
        setGeneration: (status) => controller.setGeneration(status),
        log: (input) => controller.recordEvent(input),
        notice: (level, message) => controller.notify(level, message),
        appendGeneratedText: () => undefined,
        contextFor: () => ({
          persona: "解説役",
          blockedTopics: [],
          maxResponseChars: 180,
          maxResponseCues: 2,
          segmentLabel: "コメント",
          segmentRemainingMs: 60_000,
          showRemainingMs: 300_000,
          recentCaptions: [],
          candidate: { safeSummary: "要約", safeQuestion: "質問", suggestedAngle: "補足" },
          pinNote: null,
          materialLabel: null,
          expressions: ["normal"],
          speakerNames: { left: "左", right: "右" },
        }),
        candidateFor: () => ({
          commentId: "c1",
          score: 0.5,
          safety: "ok",
          relevance: "high",
          isQuestion: false,
          reason: "理由",
          suggestedAngle: "補足",
          safeSummary: "要約",
          safeQuestion: "質問",
          safeQuote: null,
          piiRedacted: true,
          urlsRemoved: true,
        }),
      },
      adapterFor: () => options.adapter ?? immediateTtsAdapter(),
    }),
  );
  return { controller };
}

describe("generated cue commands", () => {
  it("updates a caption without TTS and re-synthesizes a speech change", async () => {
    const calls: string[] = [];
    const adapter: TtsAdapter = {
      id: "voicevox",
      async listVoices() {
        return { voices: [], engineVersion: null };
      },
      async synthesize(_context, request) {
        calls.push(request.text);
        return { data: wavBytes(), mediaType: "audio/wav" };
      },
    };
    const { controller } = await setup({ adapter });
    controller.handleCommand({ kind: "start" });
    controller.enqueueGeneratedCues([generatedCue("g1", "元の字幕")]);

    expect(
      controller.handleCommand({ kind: "edit_cue", cueId: "g1", caption: "字幕だけ" }),
    ).toEqual({ ok: true });
    expect(controller.getCue("g1")?.caption).toBe("字幕だけ");
    expect(calls).toHaveLength(0);

    expect(
      controller.handleCommand({ kind: "edit_cue", cueId: "g1", expression: "smile" }),
    ).toEqual({ ok: true });
    expect(controller.getCue("g1")?.expression).toBe("smile");
    expect(calls).toHaveLength(0);

    expect(
      controller.handleCommand({ kind: "edit_cue", cueId: "g1", speech: "新しい読み" }),
    ).toEqual({ ok: true });
    expect(controller.getCue("g1")?.status).toBe("preparing");
    await settle();
    expect(controller.getCue("g1")).toMatchObject({
      caption: "字幕だけ",
      speech: "新しい読み",
      status: "ready",
    });
    expect(controller.getCue("g1")?.audio).toMatch(/^run:generated\//u);
    expect(calls).toContain("新しい読み");
    expect(controller.getSnapshot().generation?.phase).toBe("ready");
    controller.dispose();
  });

  it("rejects edits, cancels, moves and deletes once a cue is playing", async () => {
    const { controller } = await setup();
    const notices: string[] = [];
    controller.subscribe((change) => {
      if (change.type === "notice") {
        notices.push(change.message);
      }
    });
    controller.handleCommand({ kind: "start" });
    controller.enqueueGeneratedCues([
      generatedCue("g1", "一"),
      generatedCue("g2", "二"),
      generatedCue("g3", "三"),
    ]);
    expect(controller.handleCommand({ kind: "move_cue", cueId: "g3", beforeCueId: "g1" })).toEqual(
      { ok: true },
    );
    expect(controller.getUpcomingCues(3).map((cue) => cue.id)).toEqual([
      "g3",
      "g1",
      "g2",
    ]);
    expect(controller.handleCommand({ kind: "cancel_cue", cueId: "g1" })).toEqual({ ok: true });
    expect(controller.handleCommand({ kind: "delete_cue", cueId: "g2" })).toEqual({ ok: true });
    expect(controller.handleCommand({ kind: "cancel_cue", cueId: "missing" })).toEqual({
      ok: false,
      message: "キャンセルできる生成キューがありません。再生開始後は停止・訂正を使ってください。",
    });
    expect(notices.some((message) => message.includes("キャンセルできる生成キュー"))).toBe(true);

    endCurrent(controller);
    expect(controller.getState().playback?.cueId).toBe("g3");
    expect(controller.handleCommand({ kind: "edit_cue", cueId: "g3", caption: "不可" })).toEqual({
      ok: false,
      message: "再生中・再生済みのキューは編集できません。",
    });
    expect(controller.handleCommand({ kind: "cancel_cue", cueId: "g3" }).ok).toBe(false);
    expect(controller.handleCommand({ kind: "delete_cue", cueId: "g3" }).ok).toBe(false);
    expect(controller.handleCommand({ kind: "move_cue", cueId: "g3", beforeCueId: null }).ok).toBe(
      false,
    );
    controller.dispose();
  });

  it("inserts a correction copy of a live cue and rejects unknown cues", async () => {
    const { controller } = await setup();
    controller.handleCommand({ kind: "start" });
    expect(controller.getState().playback?.cueId).toBe("cue-opening");

    expect(controller.handleCommand({ kind: "play_correction", cueId: "cue-opening" })).toEqual({
      ok: true,
    });
    const correction = controller.getUpcomingCues(1)[0];
    expect(correction).toMatchObject({
      id: "cue-opening-correction-1",
      source: "fallback",
      status: "ready",
      origin: "live",
    });
    expect(correction?.audio).toBe("audio/prepared/cue-opening.wav");

    endCurrent(controller);
    expect(controller.getState().playback?.cueId).toBe("cue-opening-correction-1");
    endCurrent(controller);
    expect(controller.getState().playback?.cueId).toBe("cue-script");

    expect(controller.handleCommand({ kind: "play_correction", cueId: "missing" }).ok).toBe(false);
    controller.dispose();
  });

  it("exposes generation state and generated cues in the console snapshot", async () => {
    const { controller } = await setup();
    controller.handleCommand({ kind: "start" });
    controller.enqueueGeneratedCues([generatedCue("g1", "表示される")]);
    controller.setGeneration({
      phase: "preparing",
      commentId: "c1",
      cueIds: ["g1"],
      error: null,
      updatedAt: "2026-11-07T12:00:00.000Z",
    });
    const snapshot = controller.getSnapshot();
    expect(snapshot.generation).toMatchObject({ phase: "preparing", cueIds: ["g1"] });
    expect(snapshot.queue.find((cue) => cue.id === "g1")?.caption).toBe("表示される");
    controller.dispose();
  });
});
