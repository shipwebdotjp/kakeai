import type { LivePackageShow, StageEvent } from "@kakeai/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testCharacters, testShow } from "../testing/package-fixture.ts";
import { testV2Show } from "../testing/v2-show.ts";
import { LiveController, type LiveControllerChange } from "./controller.ts";

const START = "2026-11-07T12:00:00.000Z";

function createController(show: LivePackageShow = testV2Show()) {
  const changes: LiveControllerChange[] = [];
  const controller = new LiveController({
    runId: "run-test",
    show,
    characters: testCharacters(),
    leaseTtlMs: 24 * 60 * 60 * 1000,
  });
  controller.subscribe((change) => changes.push(change));
  return { controller, changes };
}

function audioEvent(controller: LiveController): StageEvent {
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
  };
}

function endCurrent(controller: LiveController): void {
  controller.handleStageEvent("stage-1", audioEvent(controller));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(START));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LiveController visual state", () => {
  it("walks segment default, same-card state change and card switch with a monotonic sequence", () => {
    const { controller } = createController();
    controller.connectStage("stage-1");
    expect(controller.handleCommand({ kind: "start" })).toEqual({ ok: true });
    expect(controller.getState().visual).toBeNull();

    endCurrent(controller);
    const first = controller.getState().visual;
    expect(first).toEqual({
      kind: "card",
      cardId: "card-list",
      stateId: "state-list-title",
      sequence: 1,
    });
    // Republishing the same cue state must not advance the sequence.
    expect(controller.getState().visual).toEqual(first);
    expect(controller.getSnapshot().status).toBe("speaking");

    endCurrent(controller);
    expect(controller.getState().visual).toEqual({
      kind: "card",
      cardId: "card-list",
      stateId: "state-list-item",
      sequence: 2,
    });

    endCurrent(controller);
    expect(controller.getState().visual).toEqual({
      kind: "card",
      cardId: "card-quote",
      stateId: "state-quote",
      sequence: 3,
    });

    endCurrent(controller);
    expect(controller.getState().phase).toBe("closing");
    expect(controller.getState().visual).toBeNull();

    endCurrent(controller);
    expect(controller.getState().phase).toBe("post_show");
    expect(controller.getState().visual).toBeNull();
  });

  it("hides the visual while a CutIn plays", () => {
    const { controller } = createController(
      testShow({ includeMaterial: true, includeCutIn: true }),
    );
    controller.connectStage("stage-1");
    controller.handleCommand({ kind: "start" });
    endCurrent(controller);
    expect(controller.getState().visual).toMatchObject({
      kind: "material",
      materialId: "material-1",
    });

    endCurrent(controller);
    expect(controller.getState().phase).toBe("cut_in");
    expect(controller.getState().visual).toBeNull();
  });

  it("deduplicates card failure notices and keeps the show running", () => {
    const { controller, changes } = createController();
    controller.connectStage("stage-1");
    controller.handleCommand({ kind: "start" });
    endCurrent(controller);
    const event: StageEvent = {
      kind: "card_error",
      runId: "run-test",
      sessionId: "stage-1",
      cueId: null,
      cardId: "card-list",
      stateId: "state-list-title",
      attempt: 0,
      sequence: 1,
      error: "画像を読み込めませんでした",
    };

    expect(() => controller.handleStageEvent("stage-1", event)).not.toThrow();
    controller.handleStageEvent("stage-1", event);

    const notices = changes.filter(
      (change) => change.type === "notice" && change.level === "warning",
    );
    expect(notices).toHaveLength(1);
    expect(controller.getState().phase).toBe("script");

    // Audio progression is unaffected by the card failure.
    endCurrent(controller);
    expect(controller.getState().visual).toMatchObject({
      stateId: "state-list-item",
      sequence: 2,
    });
  });

  it("truncates card error notices and bounds the dedupe set", () => {
    const { controller, changes } = createController();
    controller.connectStage("stage-1");
    controller.handleCommand({ kind: "start" });
    endCurrent(controller);

    const event = (error: string): StageEvent => ({
      kind: "card_error",
      runId: "run-test",
      sessionId: "stage-1",
      cueId: null,
      cardId: "card-list",
      stateId: "state-list-title",
      attempt: 0,
      sequence: 1,
      error,
    });

    controller.handleStageEvent("stage-1", event("x".repeat(600)));
    const firstNotice = changes.find((change) => change.type === "notice");
    expect(firstNotice?.type === "notice" ? firstNotice.message.length : 0).toBe(500);

    for (let index = 0; index < 130; index += 1) {
      controller.handleStageEvent("stage-1", event(`失敗-${index}`));
    }
    const internals = controller as unknown as {
      cardErrorNotices: Set<string>;
    };
    expect(internals.cardErrorNotices.size).toBeLessThanOrEqual(100);
  });
});
