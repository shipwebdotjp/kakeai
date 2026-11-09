import {
  livePackageShowSchema,
  type LiveCue,
  type LivePackageShow,
  type PreparedCue,
  type StageEvent,
} from "@kakeai/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testCharacters, testShow } from "../testing/package-fixture.ts";
import { LiveController, type LiveControllerChange } from "./controller.ts";
import { shouldStartCommentCorner } from "./segments.ts";

const START = "2026-11-07T12:00:00.000Z";

function createController(show: LivePackageShow = testShow()) {
  const changes: LiveControllerChange[] = [];
  const controller = new LiveController({
    runId: "run-test",
    show,
    characters: testCharacters(),
    // Unit tests advance the wall clock without heartbeats; lease expiry is
    // covered separately by lease.test.ts.
    leaseTtlMs: 24 * 60 * 60 * 1000,
  });
  controller.subscribe((change) => changes.push(change));
  return { controller, changes };
}

function preparedCue(id: string, overrides: Partial<PreparedCue> = {}): PreparedCue {
  return {
    id,
    origin: "live",
    speaker: "left",
    caption: id,
    speech: id,
    expression: "normal",
    audio: `audio/prepared/${id}.wav`,
    durationMs: 1000,
    ...overrides,
  };
}

function generatedCue(id: string, overrides: Partial<LiveCue> = {}): LiveCue {
  return {
    id,
    origin: "live",
    speaker: "left",
    caption: id,
    speech: id,
    expression: "normal",
    audio: null,
    durationMs: null,
    source: "generated",
    status: "preparing",
    commentId: null,
    ...overrides,
  };
}

function showWithComment(options: { secondScript: boolean }): LivePackageShow {
  const base = testShow();
  const cues = options.secondScript
    ? [...base.cues, preparedCue("cue-script-2")]
    : [...base.cues];
  const segments: unknown[] = [
    base.segments[0],
    base.segments[1],
    {
      id: "seg-comments",
      kind: "comment",
      label: "コメント",
      targetDurationMs: 300_000,
    },
  ];
  if (options.secondScript) {
    segments.push({
      id: "seg-script-2",
      kind: "script",
      label: "本編2",
      targetDurationMs: 300_000,
      cues: ["cue-script-2"],
    });
  }
  segments.push(base.segments[2]);
  return livePackageShowSchema.parse({ ...base, segments, cues });
}

function showWithLongOpening(): LivePackageShow {
  const base = testShow();
  return livePackageShowSchema.parse({
    ...base,
    cues: base.cues.map((cue) =>
      cue.id === "cue-opening" ? { ...cue, durationMs: 20_000 } : cue,
    ),
  });
}

function showWithCueMaterials(): LivePackageShow {
  const base = testShow({ includeMaterial: true });
  return livePackageShowSchema.parse({
    ...base,
    segments: base.segments.map((segment, index) =>
      index === 1
        ? { ...segment, cues: ["cue-script", "cue-script-2", "cue-script-3"] }
        : segment,
    ),
    cues: [
      ...base.cues,
      preparedCue("cue-script-2", {
        visual: { kind: "material", materialId: "material-2" },
      }),
      preparedCue("cue-script-3", { visual: null }),
    ],
    materials: [
      ...base.materials,
      {
        id: "material-2",
        kind: "image",
        file: "materials/card-2.png",
        hasAudio: false,
        focus: false,
        width: 1,
        height: 1,
      },
    ],
  });
}

function audioEvent(
  controller: LiveController,
  overrides: Partial<StageEvent> = {},
): StageEvent {
  const playback = controller.getState().playback;
  if (playback === null) {
    throw new Error("no playback");
  }
  return {
    kind: "audio_ended",
    runId: "run-test",
    sessionId: "stage-1",
    cueId: playback.cueId,
    attempt: playback.attempt,
    sequence: playback.sequence,
    ...overrides,
  };
}

function endCurrent(controller: LiveController, sessionId = "stage-1"): void {
  controller.handleStageEvent(sessionId, audioEvent(controller, { sessionId }));
}

function failCurrent(controller: LiveController, error = "boom", sessionId = "stage-1"): void {
  controller.handleStageEvent(
    sessionId,
    audioEvent(controller, { kind: "audio_error", error, sessionId }),
  );
}

function connectProgram(controller: LiveController): void {
  controller.connectStage("stage-1");
}

function lastPreload(changes: LiveControllerChange[]) {
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    const change = changes[index];
    if (change?.type === "preload") {
      return change.cues;
    }
  }
  return [];
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(START));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LiveController phases", () => {
  it("walks pre_show → opening → script → closing → post_show on audio events", () => {
    const { controller } = createController();
    connectProgram(controller);
    expect(controller.getState().phase).toBe("pre_show");

    expect(controller.handleCommand({ kind: "start" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("opening");
    expect(controller.getState().playback?.cueId).toBe("cue-opening");
    expect(controller.getState().playback?.attempt).toBe(1);
    expect(controller.getState().playback?.sequence).toBe(1);

    endCurrent(controller);
    expect(controller.getState().phase).toBe("script");
    expect(controller.getState().playback?.cueId).toBe("cue-script");

    endCurrent(controller);
    expect(controller.getState().phase).toBe("closing");
    expect(controller.getState().playback?.cueId).toBe("cue-closing");

    endCurrent(controller);
    expect(controller.getState().phase).toBe("post_show");
    expect(controller.getState().playback).toBeNull();
  });

  it("keeps the script phase while showing a focused card", () => {
    const { controller } = createController(testShow({ includeMaterial: true }));
    connectProgram(controller);
    controller.handleCommand({ kind: "start" });
    endCurrent(controller);
    expect(controller.getState().phase).toBe("script");
    expect(controller.getState().visual).toMatchObject({
      kind: "material",
      materialId: "material-1",
      focus: true,
    });
  });

  it("resolves the current cue material over the segment default", () => {
    const { controller } = createController(showWithCueMaterials());
    connectProgram(controller);
    controller.handleCommand({ kind: "start" });
    endCurrent(controller);
    expect(controller.getState().visual).toMatchObject({
      kind: "material",
      materialId: "material-1",
      focus: true,
    });

    endCurrent(controller);
    expect(controller.getState().visual).toMatchObject({
      kind: "material",
      materialId: "material-2",
      focus: false,
    });

    endCurrent(controller);
    expect(controller.getState().visual).toBeNull();
  });

  it("freezes the show clock at the final value in post_show", () => {
    const { controller } = createController();
    connectProgram(controller);
    controller.handleCommand({ kind: "start" });
    endCurrent(controller);
    endCurrent(controller);
    endCurrent(controller);
    const finalClock = controller.getState().clock;
    vi.advanceTimersByTime(30_000);
    expect(controller.getState().clock).toEqual(finalClock);
    expect(controller.getUpcomingCues(5)).toEqual([]);
  });

  it("keeps the attempt and issues a new sequence on pause and resume", () => {
    const { controller } = createController();
    connectProgram(controller);
    controller.handleCommand({ kind: "start" });
    const before = controller.getState().playback!;

    vi.advanceTimersByTime(300);
    expect(controller.handleCommand({ kind: "pause" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("paused");
    expect(controller.getState().playback).toEqual(before);

    vi.advanceTimersByTime(60_000);
    expect(controller.getState().playback).toEqual(before);

    expect(controller.handleCommand({ kind: "resume" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("opening");
    const resumed = controller.getState().playback!;
    expect(resumed.cueId).toBe("cue-opening");
    expect(resumed.attempt).toBe(1);
    expect(resumed.sequence).toBeGreaterThan(before.sequence);
    expect(resumed.startedAt).not.toBe(before.startedAt);

    endCurrent(controller);
    expect(controller.getState().phase).toBe("script");
  });

  it("stop keeps prepared cues paused and resumable", () => {
    const { controller } = createController();
    connectProgram(controller);
    controller.handleCommand({ kind: "start" });
    const before = controller.getState().playback!;

    expect(controller.handleCommand({ kind: "stop" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("paused");
    expect(controller.getState().playback).toEqual(before);

    expect(controller.handleCommand({ kind: "resume" })).toEqual({ ok: true });
    expect(controller.getState().playback?.cueId).toBe("cue-opening");
    expect(controller.getState().playback?.attempt).toBe(1);
  });

  it("end waits for the current cue and then moves to closing", () => {
    const { controller } = createController();
    connectProgram(controller);
    controller.handleCommand({ kind: "start" });
    expect(controller.handleCommand({ kind: "end" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("opening");

    endCurrent(controller);
    expect(controller.getState().phase).toBe("closing");
    expect(controller.getState().playback?.cueId).toBe("cue-closing");

    endCurrent(controller);
    expect(controller.getState().phase).toBe("post_show");
  });

  it("moves from closing to post_show on end", () => {
    const { controller } = createController();
    connectProgram(controller);
    controller.handleCommand({ kind: "start" });
    endCurrent(controller);
    endCurrent(controller);
    expect(controller.getState().phase).toBe("closing");
    expect(controller.handleCommand({ kind: "end" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("post_show");
  });

  it("rejects commands that do not fit the phase", () => {
    const { controller } = createController();
    expect(controller.handleCommand({ kind: "pause" }).ok).toBe(false);
    expect(controller.handleCommand({ kind: "end" }).ok).toBe(false);
    expect(controller.handleCommand({ kind: "skip_cue" }).ok).toBe(false);
    controller.handleCommand({ kind: "start" });
    expect(controller.handleCommand({ kind: "start" }).ok).toBe(false);
    expect(controller.handleCommand({ kind: "resume" }).ok).toBe(false);
  });
});

describe("LiveController safe mode", () => {
  it("keeps prepared cues flowing and skips comment corners", () => {
    const { controller } = createController(showWithComment({ secondScript: false }));
    connectProgram(controller);
    controller.handleCommand({ kind: "start" });
    expect(controller.handleCommand({ kind: "safe_mode" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("safe_mode");

    endCurrent(controller);
    expect(controller.getState().phase).toBe("safe_mode");
    expect(controller.getState().playback?.cueId).toBe("cue-script");

    endCurrent(controller);
    expect(controller.getState().phase).toBe("safe_mode");
    expect(controller.getState().playback?.cueId).toBe("cue-closing");

    endCurrent(controller);
    expect(controller.getState().phase).toBe("post_show");
  });

  it("allows safe mode before the show starts", () => {
    const { controller } = createController();
    expect(controller.handleCommand({ kind: "safe_mode" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("safe_mode");
    expect(controller.handleCommand({ kind: "start" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("safe_mode");
    expect(controller.getState().playback?.cueId).toBe("cue-opening");
  });

  it("removes a generated current cue and continues with prepared cues", () => {
    const { controller } = createController();
    connectProgram(controller);
    controller.handleCommand({ kind: "start" });
    endCurrent(controller);
    controller.enqueueGeneratedCues([
      generatedCue("generated-1", { status: "ready", audio: "audio/generated/generated-1.wav" }),
    ]);
    endCurrent(controller);
    expect(controller.getState().playback?.cueId).toBe("generated-1");

    expect(controller.handleCommand({ kind: "safe_mode" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("safe_mode");
    expect(controller.getState().playback?.cueId).toBe("cue-closing");
    expect(controller.getSnapshot().queue.some((cue) => cue.id === "generated-1")).toBe(false);
  });
});

describe("LiveController end and closing reserve", () => {
  it("skips an empty comment corner and continues on the spine when time remains", () => {
    const { controller } = createController(showWithComment({ secondScript: true }));
    connectProgram(controller);
    controller.handleCommand({ kind: "start" });
    endCurrent(controller);
    endCurrent(controller);
    expect(controller.getState().phase).toBe("script");
    expect(controller.getState().playback?.cueId).toBe("cue-script-2");
  });

  it("goes to closing instead of a new comment corner inside closingReserveMs", () => {
    const { controller } = createController(showWithComment({ secondScript: true }));
    connectProgram(controller);
    controller.handleCommand({ kind: "start" });
    vi.setSystemTime(new Date(Date.parse(START) + 500_000));
    endCurrent(controller);
    endCurrent(controller);
    expect(controller.getState().phase).toBe("closing");
    expect(controller.getState().playback?.cueId).toBe("cue-closing");
  });

  it("exposes the pure closing reserve decision", () => {
    expect(shouldStartCommentCorner(100_000, 120_000)).toBe(false);
    expect(shouldStartCommentCorner(120_000, 120_000)).toBe(true);
  });
});

describe("LiveController failures and watchdog", () => {
  it("fails forward on an audio error and pauses after three failures", () => {
    const { controller, changes } = createController();
    connectProgram(controller);
    controller.handleCommand({ kind: "start" });

    failCurrent(controller, "first");
    expect(controller.getState().phase).toBe("script");
    expect(controller.getState().playback?.cueId).toBe("cue-script");

    failCurrent(controller, "second");
    expect(controller.getState().phase).toBe("closing");
    expect(controller.getState().playback?.cueId).toBe("cue-closing");

    failCurrent(controller, "third");
    expect(controller.getState().phase).toBe("paused");
    expect(controller.getState().playback).toBeNull();
    expect(
      changes.some((change) => change.type === "notice" && change.level === "error"),
    ).toBe(true);
  });

  it("advances when audio_ended does not arrive before the watchdog", () => {
    const { controller, changes } = createController(showWithLongOpening());
    connectProgram(controller);
    controller.handleCommand({ kind: "start" });

    vi.advanceTimersByTime(24_999);
    expect(controller.getState().phase).toBe("opening");
    vi.advanceTimersByTime(1);

    expect(controller.getState().phase).toBe("script");
    expect(controller.getState().playback?.cueId).toBe("cue-script");
    expect(
      changes.some((change) => change.type === "notice" && change.level === "warning"),
    ).toBe(true);
  });

  it("does not let a stale watchdog advance after pause and resume", () => {
    const { controller } = createController(showWithLongOpening());
    connectProgram(controller);
    controller.handleCommand({ kind: "start" });
    controller.handleCommand({ kind: "pause" });
    vi.advanceTimersByTime(60_000);
    expect(controller.getState().phase).toBe("paused");
    controller.handleCommand({ kind: "resume" });
    expect(controller.getState().phase).toBe("opening");
    endCurrent(controller);
    expect(controller.getState().phase).toBe("script");
  });
});

describe("LiveController thinking wait", () => {
  it("waits maxThinkingMs and skips a generated cue that never becomes ready", () => {
    const { controller, changes } = createController();
    connectProgram(controller);
    controller.handleCommand({ kind: "start" });
    controller.enqueueGeneratedCues([generatedCue("generated-1")]);
    endCurrent(controller);

    expect(controller.getState().status).toBe("thinking");
    expect(controller.getState().playback).toBeNull();
    vi.advanceTimersByTime(1999);
    expect(controller.getState().status).toBe("thinking");
    vi.advanceTimersByTime(1);

    expect(controller.getState().phase).toBe("script");
    expect(controller.getState().playback?.cueId).toBe("cue-script");
    expect(
      changes.some((change) => change.type === "notice" && change.level === "warning"),
    ).toBe(true);
  });

  it("continues with the next cue after removing the thinking cue", () => {
    const { controller } = createController();
    connectProgram(controller);
    controller.handleCommand({ kind: "start" });
    controller.enqueueGeneratedCues([generatedCue("generated-1")]);
    endCurrent(controller);
    expect(controller.getState().status).toBe("thinking");

    expect(controller.removeCue("generated-1")).toBe(true);
    expect(controller.getState().phase).toBe("script");
    expect(controller.getState().playback?.cueId).toBe("cue-script");
  });

  it("starts a generated cue when it becomes ready during the wait", () => {
    const { controller } = createController();
    connectProgram(controller);
    controller.handleCommand({ kind: "start" });
    controller.enqueueGeneratedCues([generatedCue("generated-1")]);
    endCurrent(controller);
    expect(controller.getState().status).toBe("thinking");

    vi.advanceTimersByTime(500);
    expect(
      controller.updateCue("generated-1", {
        status: "ready",
        audio: "audio/generated/generated-1.wav",
        durationMs: 1000,
      }),
    ).toBe(true);
    vi.advanceTimersByTime(100);

    expect(controller.getState().phase).toBe("opening");
    expect(controller.getState().playback?.cueId).toBe("generated-1");
    expect(controller.getState().playback?.attempt).toBe(1);
  });
});

describe("LiveController stage event idempotency", () => {
  it("ignores preview events, mismatched attempts and stale sequences", () => {
    const { controller } = createController();
    controller.connectStage("stage-1");
    controller.connectStage("stage-2");
    controller.handleCommand({ kind: "start" });
    const opening = controller.getState().playback!;

    controller.handleStageEvent("stage-2", {
      ...audioEvent(controller),
      sessionId: "stage-2",
    });
    expect(controller.getState().playback).toEqual(opening);

    controller.handleStageEvent(
      "stage-1",
      audioEvent(controller, { attempt: opening.attempt + 1 }),
    );
    controller.handleStageEvent(
      "stage-1",
      audioEvent(controller, { sequence: opening.sequence + 5 }),
    );
    controller.handleStageEvent(
      "stage-1",
      audioEvent(controller, { cueId: "not-current" }),
    );
    expect(controller.getState().playback).toEqual(opening);

    endCurrent(controller);
    expect(controller.getState().playback?.cueId).toBe("cue-script");

    controller.handleStageEvent("stage-1", {
      kind: "audio_ended",
      runId: "run-test",
      sessionId: "stage-1",
      cueId: opening.cueId,
      attempt: opening.attempt,
      sequence: opening.sequence,
    });
    expect(controller.getState().playback?.cueId).toBe("cue-script");

    endCurrent(controller);
    expect(controller.getState().playback?.cueId).toBe("cue-closing");
  });

  it("pauses on program disconnect and resumes on the taken-over stage", () => {
    const { controller } = createController();
    controller.connectStage("stage-1");
    controller.connectStage("stage-2");
    controller.handleCommand({ kind: "start" });
    const before = controller.getState().playback!;

    controller.disconnectStage("stage-1");
    expect(controller.getState().phase).toBe("paused");
    expect(controller.getState().playback).toEqual(before);
    expect(controller.getSnapshot().stages[0]?.role).toBe("preview");

    expect(
      controller.handleCommand({ kind: "takeover_program", sessionId: "stage-2" }),
    ).toEqual({ ok: true });
    expect(controller.handleCommand({ kind: "resume" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("opening");
    expect(controller.getState().playback?.attempt).toBe(1);
    expect(controller.getState().playback?.sequence).toBeGreaterThan(before.sequence);

    endCurrent(controller, "stage-2");
    expect(controller.getState().phase).toBe("script");
  });
});

describe("LiveController queue operations", () => {
  it("enqueues, edits, moves and removes generated cues", () => {
    const { controller } = createController();
    connectProgram(controller);
    controller.handleCommand({ kind: "start" });

    controller.enqueueGeneratedCues([
      generatedCue("generated-1", { status: "ready", audio: "audio/generated/1.wav" }),
      generatedCue("generated-2", { status: "ready", audio: "audio/generated/2.wav" }),
    ]);
    expect(controller.getUpcomingCues(5).map((cue) => cue.id)).toEqual([
      "generated-1",
      "generated-2",
      "cue-script",
      "cue-closing",
    ]);
    expect(controller.getSnapshot().queue.map((cue) => cue.id)).toEqual([
      "cue-opening",
      "generated-1",
      "generated-2",
      "cue-script",
      "cue-closing",
    ]);
    expect(controller.getSnapshot().queuePosition).toBe(0);

    expect(controller.updateCue("generated-1", { caption: "編集後" })).toBe(true);
    expect(controller.getCue("generated-1")?.caption).toBe("編集後");
    expect(controller.updateCue("generated-1", { status: "playing" })).toBe(false);
    expect(controller.getCue("generated-1")?.status).toBe("ready");
    expect(controller.updateCue("cue-opening", { caption: "再生中は不可" })).toBe(false);
    expect(controller.moveCue("generated-2", "generated-1")).toBe(true);
    expect(controller.getUpcomingCues(2).map((cue) => cue.id)).toEqual([
      "generated-2",
      "generated-1",
    ]);

    expect(controller.moveCue("cue-opening", "generated-1")).toBe(false);
    expect(controller.removeCue("cue-opening")).toBe(false);
    expect(controller.removeCue("generated-1")).toBe(true);
    expect(controller.getCue("generated-1")).toBeNull();
    expect(controller.getCue("missing")).toBeNull();

    endCurrent(controller);
    expect(controller.getState().playback?.cueId).toBe("generated-2");
    expect(controller.getSnapshot().queuePosition).toBe(1);
    expect(controller.updateCue("cue-opening", { caption: "終了後は不可" })).toBe(false);
  });

  it("stop removes generated cues and keeps the prepared queue", () => {
    const { controller } = createController();
    connectProgram(controller);
    controller.handleCommand({ kind: "start" });
    controller.enqueueGeneratedCues([
      generatedCue("generated-1", { status: "ready", audio: "audio/generated/1.wav" }),
    ]);
    expect(controller.getSnapshot().queue.some((cue) => cue.id === "generated-1")).toBe(true);

    controller.handleCommand({ kind: "stop" });
    expect(controller.getSnapshot().queue.some((cue) => cue.id === "generated-1")).toBe(false);
    expect(controller.getState().playback?.cueId).toBe("cue-opening");

    controller.handleCommand({ kind: "resume" });
    endCurrent(controller);
    expect(controller.getState().phase).toBe("script");
  });

  it("removes a generated current cue on stop and resumes at the prepared boundary", () => {
    const { controller } = createController();
    connectProgram(controller);
    controller.handleCommand({ kind: "start" });
    endCurrent(controller);
    controller.enqueueGeneratedCues([
      generatedCue("generated-1", { status: "ready", audio: "audio/generated/1.wav" }),
    ]);
    endCurrent(controller);
    expect(controller.getState().playback?.cueId).toBe("generated-1");

    controller.handleCommand({ kind: "stop" });
    expect(controller.getState().phase).toBe("paused");
    expect(controller.getState().playback).toBeNull();
    expect(controller.getSnapshot().queue.some((cue) => cue.id === "generated-1")).toBe(false);

    controller.handleCommand({ kind: "resume" });
    expect(controller.getState().phase).toBe("closing");
    expect(controller.getState().playback?.cueId).toBe("cue-closing");
  });

  it("emits preload changes for the next ready cues, including across segments", () => {
    const { controller, changes } = createController();
    connectProgram(controller);
    controller.handleCommand({ kind: "start" });
    expect(controller.getPreloadCues().map((cue) => cue.cueId)).toEqual([
      "cue-script",
      "cue-closing",
    ]);
    expect(lastPreload(changes).map((cue) => cue.cueId)).toEqual(["cue-script", "cue-closing"]);

    controller.enqueueGeneratedCues([
      generatedCue("generated-1", { status: "ready", audio: "audio/generated/1.wav" }),
    ]);
    expect(controller.getPreloadCues().map((cue) => cue.cueId)).toEqual([
      "generated-1",
      "cue-script",
    ]);

    endCurrent(controller);
    expect(controller.getPreloadCues().map((cue) => cue.cueId)).toEqual([
      "cue-script",
      "cue-closing",
    ]);

    endCurrent(controller);
    expect(controller.getPreloadCues().map((cue) => cue.cueId)).toEqual(["cue-closing"]);
  });
});
