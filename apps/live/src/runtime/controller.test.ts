import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testCharacters, testShow } from "../testing/package-fixture.ts";
import { LiveController } from "./controller.ts";

const START = "2026-11-07T12:00:00.000Z";

function createController(includeMaterial = false): LiveController {
  return new LiveController({
    runId: "run-test",
    show: testShow({ includeMaterial }),
    characters: testCharacters(),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(START));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LiveController phases", () => {
  it("walks pre_show → opening → script → closing → post_show", () => {
    const controller = createController();
    expect(controller.getState().phase).toBe("pre_show");
    expect(controller.getState().show.title).toBe("テスト配信");

    expect(controller.handleCommand({ kind: "start" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("opening");
    expect(controller.getState().playback?.cueId).toBe("cue-opening");

    vi.advanceTimersByTime(1000);
    expect(controller.getState().phase).toBe("script");
    expect(controller.getState().playback?.cueId).toBe("cue-script");
    expect(controller.getState().clock.elapsedMs).toBe(1000);

    vi.advanceTimersByTime(1000);
    expect(controller.getState().phase).toBe("closing");
    expect(controller.getState().playback?.cueId).toBe("cue-closing");

    vi.advanceTimersByTime(1000);
    expect(controller.getState().phase).toBe("post_show");
    expect(controller.getState().playback).toBeNull();
  });

  it("enters the material phase for a focused card", () => {
    const controller = createController(true);
    controller.handleCommand({ kind: "start" });
    vi.advanceTimersByTime(1000);
    expect(controller.getState().phase).toBe("material");
    expect(controller.getState().material).toEqual({ id: "material-1", focus: true });
  });

  it("keeps the attempt and restarts the cue on pause and resume", () => {
    const controller = createController();
    controller.handleCommand({ kind: "start" });
    const before = controller.getState().playback;

    vi.advanceTimersByTime(300);
    expect(controller.handleCommand({ kind: "pause" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("paused");
    expect(controller.getState().playback).toEqual(before);

    vi.advanceTimersByTime(5000);
    expect(controller.getState().playback?.cueId).toBe("cue-opening");
    expect(controller.getState().playback?.attempt).toBe(1);

    controller.handleCommand({ kind: "resume" });
    expect(controller.getState().phase).toBe("opening");
    expect(controller.getState().playback?.cueId).toBe("cue-opening");
    expect(controller.getState().playback?.attempt).toBe(1);
    expect(controller.getState().playback?.startedAt).not.toBe(before?.startedAt);

    vi.advanceTimersByTime(1000);
    expect(controller.getState().phase).toBe("script");
  });

  it("stop keeps the current cue paused and resume restarts it", () => {
    const controller = createController();
    controller.handleCommand({ kind: "start" });
    const before = controller.getState().playback;
    expect(controller.handleCommand({ kind: "stop" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("paused");
    expect(controller.getState().playback).toEqual(before);

    vi.advanceTimersByTime(5000);
    expect(controller.getState().playback?.cueId).toBe("cue-opening");

    controller.handleCommand({ kind: "resume" });
    expect(controller.getState().phase).toBe("opening");
    vi.advanceTimersByTime(1000);
    expect(controller.getState().phase).toBe("script");
  });

  it("end waits for the current cue and then moves to closing", () => {
    const controller = createController();
    controller.handleCommand({ kind: "start" });
    expect(controller.handleCommand({ kind: "end" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("opening");

    vi.advanceTimersByTime(1000);
    expect(controller.getState().phase).toBe("closing");
    expect(controller.getState().playback?.cueId).toBe("cue-closing");

    vi.advanceTimersByTime(1000);
    expect(controller.getState().phase).toBe("post_show");
  });

  it("safe mode keeps prepared cues flowing without entering script phases", () => {
    const controller = createController();
    controller.handleCommand({ kind: "start" });
    expect(controller.handleCommand({ kind: "safe_mode" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("safe_mode");

    vi.advanceTimersByTime(1000);
    expect(controller.getState().phase).toBe("safe_mode");
    expect(controller.getState().playback?.cueId).toBe("cue-script");

    vi.advanceTimersByTime(1000);
    expect(controller.getState().phase).toBe("safe_mode");
    expect(controller.getState().playback?.cueId).toBe("cue-closing");

    vi.advanceTimersByTime(1000);
    expect(controller.getState().phase).toBe("post_show");
  });

  it("allows safe mode before the show starts", () => {
    const controller = createController();
    expect(controller.handleCommand({ kind: "safe_mode" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("safe_mode");
    expect(controller.handleCommand({ kind: "start" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("safe_mode");
    expect(controller.getState().playback?.cueId).toBe("cue-opening");
  });

  it("rejects commands that do not fit the phase", () => {
    const controller = createController();
    expect(controller.handleCommand({ kind: "pause" }).ok).toBe(false);
    expect(controller.handleCommand({ kind: "end" }).ok).toBe(false);
    controller.handleCommand({ kind: "start" });
    expect(controller.handleCommand({ kind: "start" }).ok).toBe(false);
    expect(controller.handleCommand({ kind: "resume" }).ok).toBe(false);
  });
});

describe("LiveController leases and stage events", () => {
  it("ignores preview stage events and accepts program events", () => {
    const controller = createController();
    const program = controller.connectStage("stage-1");
    const preview = controller.connectStage("stage-2");
    expect(program.lease.role).toBe("program");
    expect(preview.lease.role).toBe("preview");

    controller.handleCommand({ kind: "start" });
    vi.advanceTimersByTime(1000);
    expect(controller.getState().playback?.cueId).toBe("cue-script");

    const event = {
      kind: "audio_ended" as const,
      runId: "run-test",
      sessionId: "stage-2",
      cueId: "cue-script",
      attempt: 1,
      sequence: 1,
    };
    controller.handleStageEvent("stage-2", event);
    expect(controller.getState().playback?.cueId).toBe("cue-script");

    controller.handleStageEvent("stage-1", { ...event, sessionId: "stage-1" });
    expect(controller.getState().phase).toBe("closing");
    expect(controller.getState().playback?.cueId).toBe("cue-closing");
  });

  it("ignores audio events while paused", () => {
    const controller = createController();
    controller.connectStage("stage-1");
    controller.handleCommand({ kind: "start" });
    const playback = controller.getState().playback!;
    controller.handleCommand({ kind: "pause" });

    controller.handleStageEvent("stage-1", {
      kind: "audio_ended",
      runId: "run-test",
      sessionId: "stage-1",
      cueId: playback.cueId,
      attempt: playback.attempt,
      sequence: 1,
    });
    expect(controller.getState().phase).toBe("paused");
    expect(controller.getState().playback?.cueId).toBe(playback.cueId);
  });

  it("ignores a stale attempt and accepts the current one", () => {
    const controller = createController();
    controller.connectStage("stage-1");
    controller.handleCommand({ kind: "start" });
    const playback = controller.getState().playback!;

    controller.handleStageEvent("stage-1", {
      kind: "audio_ended",
      runId: "run-test",
      sessionId: "stage-1",
      cueId: playback.cueId,
      attempt: 2,
      sequence: 1,
    });
    expect(controller.getState().phase).toBe("opening");

    controller.handleStageEvent("stage-1", {
      kind: "audio_ended",
      runId: "run-test",
      sessionId: "stage-1",
      cueId: playback.cueId,
      attempt: 1,
      sequence: 1,
    });
    expect(controller.getState().phase).toBe("script");
  });

  it("pauses when the program disconnects and requires explicit takeover", () => {
    const controller = createController();
    controller.connectStage("stage-1");
    controller.connectStage("stage-2");
    controller.handleCommand({ kind: "start" });

    controller.disconnectStage("stage-1");
    expect(controller.getState().phase).toBe("paused");
    const snapshot = controller.getSnapshot();
    expect(snapshot.stages).toHaveLength(1);
    expect(snapshot.stages[0]?.role).toBe("preview");

    expect(
      controller.handleCommand({ kind: "takeover_program", sessionId: "stage-2" }),
    ).toEqual({ ok: true });
    expect(controller.getSnapshot().stages[0]?.role).toBe("program");

    expect(controller.handleCommand({ kind: "resume" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("opening");
  });

  it("publishes a console snapshot with queue and stage roles", () => {
    const controller = createController();
    controller.connectStage("stage-1");
    controller.connectStage("stage-2");
    controller.handleCommand({ kind: "start" });
    const snapshot = controller.getSnapshot();
    expect(snapshot.runId).toBe("run-test");
    expect(snapshot.phase).toBe("opening");
    expect(snapshot.show.segments).toHaveLength(3);
    expect(snapshot.queue.map((cue) => cue.id)).toEqual([
      "cue-opening",
      "cue-script",
      "cue-closing",
    ]);
    expect(snapshot.queue[0]?.status).toBe("playing");
    expect(snapshot.currentCueId).toBe("cue-opening");
    expect(snapshot.stages.map((stage) => stage.role)).toEqual(["program", "preview"]);
    expect(snapshot.status).toBe("speaking");
  });
});
