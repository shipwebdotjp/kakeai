import type { LivePackageCutIn, StageEvent } from "@kakeai/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CutInRuntime,
  type CutInEndReason,
  type CutInOccurrence,
} from "./cut-in-runtime.ts";
import type { PlayoutScheduler } from "./playout.ts";

const CUT_IN: LivePackageCutIn = {
  id: "jingle-1",
  file: "media/assets/cutin.mp4",
  durationMs: 4000,
  hasAudio: true,
  width: 1920,
  height: 1080,
};

const SEGMENT = {
  id: "seg-cut",
  kind: "cut_in" as const,
  label: "コメントコーナーへ",
  cutInId: "jingle-1",
};

const OTHER_SEGMENT = { ...SEGMENT, id: "seg-cut-2" };

interface Finished {
  occurrence: CutInOccurrence;
  reason: CutInEndReason;
  message?: string;
}

function createRuntime(scheduler?: PlayoutScheduler) {
  let sequence = 0;
  const started: CutInOccurrence[] = [];
  const finished: Finished[] = [];
  const runtime = new CutInRuntime({
    now: () => Date.now(),
    nextSequence: () => {
      sequence += 1;
      return sequence;
    },
    onStarted: (occurrence) => started.push(occurrence),
    onFinished: (occurrence, reason, message) =>
      finished.push({
        occurrence,
        reason,
        ...(message === undefined ? {} : { message }),
      }),
    ...(scheduler === undefined ? {} : { scheduler }),
  });
  return { runtime, started, finished };
}

function event(overrides: Partial<StageEvent> = {}): StageEvent {
  return {
    kind: "cut_in_ended",
    runId: "run-test",
    sessionId: "stage-1",
    cueId: null,
    cutInId: CUT_IN.id,
    segmentId: SEGMENT.id,
    attempt: 1,
    sequence: 1,
    ...overrides,
  };
}

/**
 * Simulates a timer that has already been queued on the platform timer queue
 * and therefore still fires even after `clearTimeout`. The runtime must reject
 * stale callbacks by attempt/sequence instead of relying on cancellation.
 */
function queuedScheduler() {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; callback: () => void; fired: boolean }>();
  const scheduler: PlayoutScheduler = {
    setTimeout(callback, ms) {
      nextId += 1;
      timers.set(nextId, { at: now + ms, callback, fired: false });
      return nextId as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout() {
      // Intentionally keep queued callbacks alive.
    },
    now: () => now,
  };
  return {
    scheduler,
    advance(ms: number) {
      now += ms;
      for (const timer of timers.values()) {
        if (!timer.fired && timer.at <= now) {
          timer.fired = true;
          timer.callback();
        }
      }
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-07T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CutInRuntime", () => {
  it("increments attempt per segment occurrence and uses one sequence source", () => {
    const { runtime } = createRuntime();
    const first = runtime.start(3, SEGMENT, CUT_IN);
    expect(first.attempt).toBe(1);
    expect(first.sequence).toBe(1);
    expect(first.startedAt.toISOString()).toBe("2026-11-07T12:00:00.000Z");

    runtime.cancel();
    const other = runtime.start(5, OTHER_SEGMENT, CUT_IN);
    expect(other.attempt).toBe(1);
    expect(other.sequence).toBe(2);

    runtime.cancel();
    const again = runtime.start(7, SEGMENT, CUT_IN);
    expect(again.attempt).toBe(2);
    expect(again.sequence).toBe(3);
    expect(runtime.current).toBe(again);
  });

  it("throws while an occurrence is playing and keeps it current", () => {
    const { runtime, started } = createRuntime();
    const first = runtime.start(3, SEGMENT, CUT_IN);

    expect(() => runtime.start(5, OTHER_SEGMENT, CUT_IN)).toThrow(
      `CutIn already playing: ${CUT_IN.id}`,
    );
    expect(runtime.current).toBe(first);
    expect(started).toHaveLength(1);
  });

  it("clears the occurrence and watchdog when onStarted throws", async () => {
    const finished: Finished[] = [];
    const runtime = new CutInRuntime({
      now: () => Date.now(),
      nextSequence: () => 1,
      onStarted: () => {
        throw new Error("publish failed");
      },
      onFinished: (occurrence, reason, message) =>
        finished.push({
          occurrence,
          reason,
          ...(message === undefined ? {} : { message }),
        }),
    });

    expect(() => runtime.start(3, SEGMENT, CUT_IN)).toThrow("publish failed");
    expect(runtime.current).toBeNull();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(finished).toHaveLength(0);
    expect(runtime.current).toBeNull();
  });

  it("clears the occurrence and watchdog when onStarted throws during resume", async () => {
    let started = 0;
    const finished: Finished[] = [];
    const runtime = new CutInRuntime({
      now: () => Date.now(),
      nextSequence: () => started + 1,
      onStarted: () => {
        started += 1;
        if (started === 2) {
          throw new Error("publish failed");
        }
      },
      onFinished: (occurrence, reason, message) =>
        finished.push({
          occurrence,
          reason,
          ...(message === undefined ? {} : { message }),
        }),
    });

    runtime.start(3, SEGMENT, CUT_IN);
    runtime.pause();
    expect(() => runtime.resume()).toThrow("publish failed");
    expect(runtime.current).toBeNull();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(finished).toHaveLength(0);
    expect(runtime.current).toBeNull();
  });

  it("accepts an exact cut_in_ended and clears before the callback", () => {
    const { runtime, finished } = createRuntime();
    const occurrence = runtime.start(3, SEGMENT, CUT_IN);

    expect(runtime.handleStageEvent(event())).toEqual({ accepted: true });
    expect(runtime.current).toBeNull();
    expect(finished).toHaveLength(1);
    expect(finished[0]?.occurrence).toBe(occurrence);
    expect(finished[0]?.reason).toBe("ended");
  });

  it("ignores stale attempts, sequences and identity mismatches", () => {
    const { runtime, finished } = createRuntime();
    runtime.start(3, SEGMENT, CUT_IN);

    expect(runtime.handleStageEvent(event({ sequence: 2 }))).toEqual({
      accepted: false,
      reason: "sequence_mismatch",
    });
    expect(runtime.handleStageEvent(event({ attempt: 2 }))).toEqual({
      accepted: false,
      reason: "attempt_mismatch",
    });
    expect(runtime.handleStageEvent(event({ segmentId: OTHER_SEGMENT.id }))).toEqual({
      accepted: false,
      reason: "segmentId_mismatch",
    });
    expect(runtime.handleStageEvent(event({ cutInId: "other" }))).toEqual({
      accepted: false,
      reason: "cutInId_mismatch",
    });
    expect(runtime.current).not.toBeNull();
    expect(finished).toHaveLength(0);

    expect(runtime.handleStageEvent(event())).toEqual({ accepted: true });
    expect(finished[0]?.reason).toBe("ended");
  });

  it("fires the watchdog at duration + 1500ms", async () => {
    const { runtime, finished } = createRuntime();
    runtime.start(3, SEGMENT, CUT_IN);

    await vi.advanceTimersByTimeAsync(5499);
    expect(finished).toHaveLength(0);
    expect(runtime.current).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    expect(finished).toHaveLength(1);
    expect(finished[0]?.reason).toBe("watchdog");
    expect(runtime.current).toBeNull();
  });

  it("never fires the watchdog below 3000ms", async () => {
    const { runtime, finished } = createRuntime();
    runtime.start(3, SEGMENT, { ...CUT_IN, durationMs: 100 });

    await vi.advanceTimersByTimeAsync(2999);
    expect(finished).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(finished[0]?.reason).toBe("watchdog");
  });

  it("rejects a queued watchdog from an older attempt", () => {
    const queued = queuedScheduler();
    const { runtime, finished } = createRuntime(queued.scheduler);
    runtime.start(3, SEGMENT, CUT_IN);

    queued.advance(1000);
    runtime.pause();
    const resumed = runtime.resume();
    expect(resumed?.attempt).toBe(2);
    expect(resumed?.sequence).toBe(2);

    // The old attempt's timer was due at 5500ms and is still queued.
    queued.advance(4500);
    expect(finished).toHaveLength(0);
    expect(runtime.current?.attempt).toBe(2);

    queued.advance(1000);
    expect(finished).toHaveLength(1);
    expect(finished[0]?.reason).toBe("watchdog");
    expect(finished[0]?.occurrence.attempt).toBe(2);
  });

  it("pauses without clearing and resumes from the beginning with new identity", async () => {
    const { runtime, started, finished } = createRuntime();
    const first = runtime.start(3, SEGMENT, CUT_IN);
    await vi.advanceTimersByTimeAsync(1000);

    runtime.pause();
    expect(runtime.isPaused).toBe(true);
    expect(runtime.current).toBe(first);
    expect(runtime.handleStageEvent(event())).toEqual({
      accepted: false,
      reason: "paused",
    });

    await vi.advanceTimersByTimeAsync(500);
    const resumed = runtime.resume();
    expect(resumed).not.toBeNull();
    expect(resumed?.attempt).toBe(2);
    expect(resumed?.sequence).toBe(2);
    expect(resumed?.startedAt.toISOString()).toBe("2026-11-07T12:00:01.500Z");
    expect(started).toHaveLength(2);
    expect(finished).toHaveLength(0);

    // The paused attempt's event must not advance the resumed occurrence.
    expect(runtime.handleStageEvent(event({ attempt: 1, sequence: 1 }))).toEqual({
      accepted: false,
      reason: "attempt_mismatch",
    });
    expect(
      runtime.handleStageEvent(event({ attempt: 2, sequence: 2 })),
    ).toEqual({ accepted: true });
  });

  it("skips and reports the skip reason", () => {
    const { runtime, finished } = createRuntime();
    runtime.start(3, SEGMENT, CUT_IN);
    expect(runtime.skip()).toBe(true);
    expect(finished[0]?.reason).toBe("skip");
    expect(runtime.current).toBeNull();
    expect(runtime.skip()).toBe(false);
    expect(finished).toHaveLength(1);
  });

  it("reports cut_in_error with the stage message", () => {
    const { runtime, finished } = createRuntime();
    runtime.start(3, SEGMENT, CUT_IN);
    expect(
      runtime.handleStageEvent(
        event({ kind: "cut_in_error", error: "decode failed" }),
      ),
    ).toEqual({ accepted: true });
    expect(finished[0]?.reason).toBe("error");
    expect(finished[0]?.message).toBe("decode failed");
  });

  it("finishes for safe mode and clears without callbacks on cancel/dispose", async () => {
    const { runtime, finished } = createRuntime();
    runtime.start(3, SEGMENT, CUT_IN);
    expect(runtime.finishForSafeMode()).toBe(true);
    expect(finished[0]?.reason).toBe("safe_mode");

    runtime.start(3, SEGMENT, CUT_IN);
    runtime.cancel();
    expect(runtime.current).toBeNull();
    expect(finished).toHaveLength(1);

    runtime.start(3, SEGMENT, CUT_IN);
    runtime.dispose();
    expect(runtime.current).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(finished).toHaveLength(1);
  });

  it("rejects events when no occurrence is current", () => {
    const { runtime } = createRuntime();
    expect(runtime.handleStageEvent(event())).toEqual({
      accepted: false,
      reason: "no_current",
    });
  });
});
