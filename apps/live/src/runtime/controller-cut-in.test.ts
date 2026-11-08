import type { LivePackageShow, StageEvent } from "@kakeai/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testCharacters, testShow } from "../testing/package-fixture.ts";
import { LiveController, type LiveControllerChange } from "./controller.ts";

const START = "2026-11-07T12:00:00.000Z";

function createController(
  show: LivePackageShow = testShow({ includeCutIn: true }),
  leaseTtlMs = 24 * 60 * 60 * 1000,
) {
  const changes: LiveControllerChange[] = [];
  const controller = new LiveController({
    runId: "run-test",
    show,
    characters: testCharacters(),
    leaseTtlMs,
  });
  controller.subscribe((change) => changes.push(change));
  return { controller, changes };
}

function connectProgram(controller: LiveController): void {
  controller.connectStage("stage-1");
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

function endCurrentCue(controller: LiveController): void {
  controller.handleStageEvent("stage-1", audioEvent(controller));
}

function cutInEvent(
  controller: LiveController,
  overrides: Partial<StageEvent> = {},
): StageEvent {
  const cutIn = controller.getState().cutIn;
  if (cutIn === null) {
    throw new Error("no CutIn");
  }
  return {
    kind: "cut_in_ended",
    runId: "run-test",
    sessionId: "stage-1",
    cueId: null,
    cutInId: cutIn.cutInId,
    segmentId: cutIn.segmentId,
    attempt: cutIn.attempt,
    sequence: cutIn.sequence,
    ...overrides,
  };
}

/** opening → script → cut_in, leaving the CutIn playing. */
function enterCutIn(controller: LiveController): void {
  controller.handleCommand({ kind: "start" });
  endCurrentCue(controller);
  endCurrentCue(controller);
  expect(controller.getState().phase).toBe("cut_in");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(START));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LiveController CutIn runtime", () => {
  it("walks opening → cut_in → script/closing and exposes CutIn state", () => {
    const { controller } = createController();
    connectProgram(controller);
    enterCutIn(controller);

    const state = controller.getState();
    expect(state.phase).toBe("cut_in");
    expect(state.segment).toEqual({
      id: "seg-cut-in",
      label: "コメントコーナーへ",
    });
    expect(state.characters).toEqual({ left: null, right: null });
    expect(state.caption).toBeNull();
    expect(state.material).toBeNull();
    expect(state.comment).toBeNull();
    expect(state.status).toBe("idle");
    expect(state.playback).toBeNull();
    expect(state.cutIn).toEqual({
      cutInId: "jingle-1",
      segmentId: "seg-cut-in",
      label: "コメントコーナーへ",
      file: "media/assets/cutin.mp4",
      durationMs: 4000,
      hasAudio: true,
      attempt: 1,
      sequence: 3,
      startedAt: START,
    });

    const snapshot = controller.getSnapshot();
    expect(snapshot.cutIn).toEqual({
      cutInId: "jingle-1",
      segmentId: "seg-cut-in",
      label: "コメントコーナーへ",
      durationMs: 4000,
      attempt: 1,
      sequence: 3,
      startedAt: START,
    });
    expect(snapshot.currentCueId).toBeNull();
    expect(snapshot.status).toBe("idle");

    const meta = controller
      .getShowMeta()
      .segments.find((segment) => segment.id === "seg-cut-in");
    expect(meta?.targetDurationMs).toBe(4000);

    controller.handleStageEvent("stage-1", cutInEvent(controller));
    expect(controller.getState().phase).toBe("closing");
    expect(controller.getState().cutIn).toBeNull();
  });

  it("ignores stale or mismatched CutIn events", () => {
    const { controller } = createController();
    connectProgram(controller);
    enterCutIn(controller);
    const cutIn = controller.getState().cutIn!;

    controller.handleStageEvent(
      "stage-1",
      cutInEvent(controller, { sequence: cutIn.sequence + 5 }),
    );
    controller.handleStageEvent(
      "stage-1",
      cutInEvent(controller, { attempt: cutIn.attempt + 3 }),
    );
    expect(controller.getState().phase).toBe("cut_in");
    expect(controller.getState().cutIn?.sequence).toBe(cutIn.sequence);

    controller.handleStageEvent("stage-1", cutInEvent(controller));
    expect(controller.getState().phase).toBe("closing");
  });

  it("advances on cut_in_error without pausing the show", () => {
    const { controller, changes } = createController();
    connectProgram(controller);
    enterCutIn(controller);

    controller.handleStageEvent(
      "stage-1",
      cutInEvent(controller, { kind: "cut_in_error", error: "decode failed" }),
    );

    expect(controller.getState().phase).toBe("closing");
    expect(controller.getState().cutIn).toBeNull();
    expect(
      changes.some(
        (change) => change.type === "notice" && change.level === "warning",
      ),
    ).toBe(true);
  });

  it("advances on the CutIn watchdog", async () => {
    const { controller } = createController();
    connectProgram(controller);
    enterCutIn(controller);

    await vi.advanceTimersByTimeAsync(5499);
    expect(controller.getState().phase).toBe("cut_in");

    await vi.advanceTimersByTimeAsync(1);
    expect(controller.getState().phase).toBe("closing");
    expect(controller.getState().cutIn).toBeNull();
  });

  it("restarts the CutIn from the beginning on pause and resume", () => {
    const { controller } = createController();
    connectProgram(controller);
    enterCutIn(controller);
    const before = controller.getState().cutIn!;

    vi.advanceTimersByTime(1000);
    expect(controller.handleCommand({ kind: "pause" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("paused");
    expect(controller.getState().cutIn?.attempt).toBe(before.attempt);

    expect(controller.handleCommand({ kind: "resume" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("cut_in");
    const resumed = controller.getState().cutIn!;
    expect(resumed.attempt).toBe(2);
    expect(resumed.sequence).toBeGreaterThan(before.sequence);
    expect(resumed.startedAt).toBe("2026-11-07T12:00:01.000Z");

    controller.handleStageEvent(
      "stage-1",
      cutInEvent(controller, {
        attempt: before.attempt,
        sequence: before.sequence,
      }),
    );
    expect(controller.getState().phase).toBe("cut_in");

    controller.handleStageEvent("stage-1", cutInEvent(controller));
    expect(controller.getState().phase).toBe("closing");
  });

  it("restarts the CutIn from the beginning after stop", () => {
    const { controller } = createController();
    connectProgram(controller);
    enterCutIn(controller);
    const before = controller.getState().cutIn!;

    expect(controller.handleCommand({ kind: "stop" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("paused");
    expect(controller.handleCommand({ kind: "resume" })).toEqual({ ok: true });
    const resumed = controller.getState().cutIn!;
    expect(controller.getState().phase).toBe("cut_in");
    expect(resumed.attempt).toBe(before.attempt + 1);
    expect(resumed.sequence).toBeGreaterThan(before.sequence);
  });

  it("skips only through skip_cut_in, never skip_cue", () => {
    const { controller } = createController();
    connectProgram(controller);
    enterCutIn(controller);

    const skipCue = controller.handleCommand({ kind: "skip_cue" });
    expect(skipCue.ok).toBe(false);
    expect(controller.getState().phase).toBe("cut_in");

    expect(controller.handleCommand({ kind: "skip_cut_in" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("closing");
    expect(controller.getState().cutIn).toBeNull();
  });

  it("lets end wait for the CutIn's natural end, then closes", () => {
    const { controller } = createController();
    connectProgram(controller);
    enterCutIn(controller);

    expect(controller.handleCommand({ kind: "end" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("cut_in");

    controller.handleStageEvent("stage-1", cutInEvent(controller));
    expect(controller.getState().phase).toBe("closing");
    expect(controller.getState().segment?.id).toBe("seg-closing");

    expect(controller.handleCommand({ kind: "end" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("post_show");
  });

  it("skips a CutIn when end is requested before it is entered", () => {
    const { controller } = createController();
    connectProgram(controller);
    controller.handleCommand({ kind: "start" });
    endCurrentCue(controller);
    expect(controller.getState().phase).toBe("script");

    expect(controller.handleCommand({ kind: "end" })).toEqual({ ok: true });
    endCurrentCue(controller);

    expect(controller.getState().phase).toBe("closing");
    expect(controller.getState().segment?.id).toBe("seg-closing");
    expect(controller.getState().cutIn).toBeNull();
  });

  it("advances safely out of a CutIn when safe mode starts", () => {
    const { controller } = createController();
    connectProgram(controller);
    enterCutIn(controller);

    expect(controller.handleCommand({ kind: "safe_mode" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("safe_mode");
    expect(controller.getState().segment?.id).toBe("seg-closing");
    expect(controller.getState().cutIn).toBeNull();
    expect(controller.getState().playback?.cueId).toBe("cue-closing");
  });

  it("clears a paused CutIn so resume continues in safe mode", () => {
    const { controller } = createController();
    connectProgram(controller);
    enterCutIn(controller);

    expect(controller.handleCommand({ kind: "pause" })).toEqual({ ok: true });
    expect(controller.handleCommand({ kind: "safe_mode" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("paused");
    expect(controller.getState().cutIn).toBeNull();

    expect(controller.handleCommand({ kind: "resume" })).toEqual({ ok: true });
    expect(controller.getState().phase).toBe("safe_mode");
    expect(controller.getState().segment?.id).toBe("seg-closing");
    expect(controller.getState().cutIn).toBeNull();
  });

  it("pauses on lease loss and restarts after an explicit takeover and resume", () => {
    const { controller } = createController(testShow({ includeCutIn: true }), 1000);
    connectProgram(controller);
    enterCutIn(controller);
    const before = controller.getState().cutIn!;

    vi.advanceTimersByTime(1500);
    // Any lease query expires the program and pauses the show.
    controller.getStageConnections();
    expect(controller.getState().phase).toBe("paused");
    expect(controller.getState().cutIn?.attempt).toBe(before.attempt);

    expect(
      controller.handleCommand({ kind: "takeover_program", sessionId: "stage-1" }),
    ).toEqual({ ok: true });
    expect(controller.handleCommand({ kind: "resume" })).toEqual({ ok: true });

    expect(controller.getState().phase).toBe("cut_in");
    expect(controller.getState().cutIn?.attempt).toBe(before.attempt + 1);
    expect(controller.getState().cutIn?.sequence).toBeGreaterThan(before.sequence);

    controller.handleStageEvent("stage-1", cutInEvent(controller));
    expect(controller.getState().phase).toBe("closing");
  });

  it("exposes startedAt and duration to a reconnecting program and accepts a late end", async () => {
    const { controller } = createController();
    connectProgram(controller);
    enterCutIn(controller);
    const before = controller.getState().cutIn!;

    await vi.advanceTimersByTimeAsync(4500);
    const reconnected = controller.connectStage("stage-2");
    expect(reconnected.state.phase).toBe("cut_in");
    expect(reconnected.state.cutIn?.startedAt).toBe(before.startedAt);
    expect(reconnected.state.cutIn?.durationMs).toBe(4000);
    expect(reconnected.state.cutIn?.attempt).toBe(before.attempt);
    expect(reconnected.state.cutIn?.sequence).toBe(before.sequence);

    // A late event that still matches the occurrence advances the spine.
    controller.handleStageEvent("stage-1", cutInEvent(controller));
    expect(controller.getState().phase).toBe("closing");
  });
});
