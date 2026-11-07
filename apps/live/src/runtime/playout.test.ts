import type { LiveCue } from "@kakeai/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Playout, type PlayoutEvent } from "./playout.ts";

function cue(id: string, overrides: Partial<LiveCue> = {}): LiveCue {
  return {
    id,
    origin: "live",
    speaker: "left",
    caption: id,
    speech: id,
    expression: "normal",
    audio: `audio/prepared/${id}.wav`,
    durationMs: 1000,
    source: "prepared",
    status: "ready",
    commentId: null,
    ...overrides,
  };
}

interface Harness {
  playout: Playout;
  events: PlayoutEvent[];
}

function createPlayout(
  options: { maxThinkingMs?: number; following?: LiveCue[] } = {},
): Harness {
  const events: PlayoutEvent[] = [];
  const playout = new Playout({
    maxThinkingMs: options.maxThinkingMs ?? 2000,
    minBufferMs: 10_000,
    emit: (event) => events.push(event),
    followingCues: () => options.following ?? [],
  });
  return { playout, events };
}

function started(events: PlayoutEvent[]) {
  return events.filter((event) => event.type === "cue_started");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-07T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Playout cue progression", () => {
  it("starts with attempt 1 and returns the next two preloadable cues", () => {
    const { playout, events } = createPlayout({ following: [cue("next-segment")] });
    const a = cue("a");
    const b = cue("b");
    const c = cue("c");
    playout.setQueue([a, b, c]);
    playout.start();

    expect(playout.current).toBe(a);
    expect(playout.currentAttempt).toBe(1);
    expect(playout.currentSequenceValue).toBe(1);
    expect(a.status).toBe("playing");
    expect(started(events)[0]?.preload).toEqual([
      { cueId: "b", audioUrl: "audio/prepared/b.wav" },
      { cueId: "c", audioUrl: "audio/prepared/c.wav" },
    ]);
  });

  it("advances only for the exact cue, attempt and sequence", () => {
    const { playout, events } = createPlayout();
    const a = cue("a");
    const b = cue("b");
    playout.setQueue([a, b]);
    playout.start();
    const first = playout.currentSequenceValue!;

    expect(
      playout.handleAudioEnded({ cueId: "other", attempt: 1, sequence: first }),
    ).toEqual({ accepted: false, reason: "cue_mismatch" });
    expect(
      playout.handleAudioEnded({ cueId: "a", attempt: 2, sequence: first }),
    ).toEqual({ accepted: false, reason: "attempt_mismatch" });
    expect(
      playout.handleAudioEnded({ cueId: "a", attempt: 1, sequence: first + 1 }),
    ).toEqual({ accepted: false, reason: "future_sequence" });
    expect(
      playout.handleAudioEnded({ cueId: "a", attempt: 1, sequence: first - 1 }),
    ).toEqual({ accepted: false, reason: "stale_sequence" });
    expect(
      playout.handleAudioEnded({ cueId: "a", attempt: 1, sequence: first }),
    ).toEqual({ accepted: true });

    expect(a.status).toBe("done");
    expect(playout.current).toBe(b);
    expect(playout.currentAttempt).toBe(1);
    expect(playout.currentSequenceValue).toBe(first + 1);
    expect(
      playout.handleAudioEnded({ cueId: "a", attempt: 1, sequence: first }),
    ).toEqual({ accepted: false, reason: "cue_mismatch" });
    expect(events.filter((event) => event.type === "cue_finished")).toHaveLength(1);
  });

  it("does not advance twice for a duplicate audio_ended", () => {
    const { playout } = createPlayout();
    const a = cue("a");
    playout.setQueue([a, cue("b"), cue("c")]);
    playout.start();
    const sequence = playout.currentSequenceValue!;
    playout.handleAudioEnded({ cueId: "a", attempt: 1, sequence });
    const afterFirst = playout.current?.id;
    playout.handleAudioEnded({ cueId: "a", attempt: 1, sequence });
    expect(playout.current?.id).toBe(afterFirst);
  });

  it("skips the current cue on operator skip", () => {
    const { playout } = createPlayout();
    const a = cue("a");
    const b = cue("b");
    playout.setQueue([a, b]);
    playout.start();
    expect(playout.skipCurrent()).toBe(true);
    expect(a.status).toBe("skipped");
    expect(playout.current).toBe(b);
  });
});

describe("Playout watchdog and failures", () => {
  it("fails the attempt forward when audio_ended does not arrive in time", () => {
    const { playout, events } = createPlayout();
    const a = cue("a", { durationMs: 20_000 });
    const b = cue("b");
    playout.setQueue([a, b]);
    playout.start();

    vi.advanceTimersByTime(24_999);
    expect(playout.current).toBe(a);
    vi.advanceTimersByTime(1);

    expect(a.status).toBe("failed");
    expect(playout.current).toBe(b);
    const failure = events.find((event) => event.type === "failure");
    expect(failure).toMatchObject({
      type: "failure",
      reason: "watchdog",
      cue: a,
      consecutiveFailures: 1,
      suspended: false,
    });
  });

  it("uses a ten second minimum watchdog", () => {
    const { playout } = createPlayout();
    const a = cue("a", { durationMs: 1000 });
    playout.setQueue([a, cue("b")]);
    playout.start();
    vi.advanceTimersByTime(9999);
    expect(playout.current).toBe(a);
    vi.advanceTimersByTime(1);
    expect(playout.current?.id).toBe("b");
  });

  it("pauses after three consecutive audio failures", () => {
    const { playout, events } = createPlayout();
    playout.setQueue([cue("a"), cue("b"), cue("c"), cue("d")]);
    playout.start();
    for (let index = 0; index < 3; index += 1) {
      const current = playout.current!;
      const sequence = playout.currentSequenceValue!;
      expect(
        playout.handleAudioError({ cueId: current.id, attempt: 1, sequence }, "boom"),
      ).toEqual({ accepted: true });
    }
    expect(playout.isPaused).toBe(true);
    const failures = events.filter((event) => event.type === "failure");
    expect(failures).toHaveLength(3);
    expect(failures[2]).toMatchObject({ consecutiveFailures: 3, suspended: true });
  });

  it("resets the failure streak after a successful ending", () => {
    const { playout } = createPlayout();
    playout.setQueue([cue("a"), cue("b"), cue("c")]);
    playout.start();
    playout.handleAudioError({ cueId: "a", attempt: 1, sequence: 1 }, "boom");
    playout.handleAudioError({ cueId: "b", attempt: 1, sequence: 2 }, "boom");
    expect(
      playout.handleAudioEnded({ cueId: "c", attempt: 1, sequence: 3 }),
    ).toEqual({ accepted: true });
    expect(playout.failureCount).toBe(0);
  });
});

describe("Playout pause, resume and stop", () => {
  it("keeps the attempt on pause and resumes with a new sequence", () => {
    const { playout, events } = createPlayout();
    const a = cue("a");
    playout.setQueue([a, cue("b")]);
    playout.start();
    const before = playout.currentStartedAt;
    const firstSequence = playout.currentSequenceValue!;
    vi.advanceTimersByTime(300);

    playout.pause();
    vi.advanceTimersByTime(60_000);
    expect(playout.current).toBe(a);
    expect(events.some((event) => event.type === "failure")).toBe(false);

    playout.resume();
    expect(playout.current).toBe(a);
    expect(playout.currentAttempt).toBe(1);
    expect(playout.currentSequenceValue).not.toBe(firstSequence);
    expect(playout.currentStartedAt).not.toEqual(before);
    expect(
      playout.handleAudioEnded({
        cueId: "a",
        attempt: 1,
        sequence: firstSequence,
      }),
    ).toEqual({ accepted: false, reason: "stale_sequence" });
  });

  it("ignores audio events while paused", () => {
    const { playout } = createPlayout();
    playout.setQueue([cue("a"), cue("b")]);
    playout.start();
    const sequence = playout.currentSequenceValue!;
    playout.pause();
    expect(
      playout.handleAudioEnded({ cueId: "a", attempt: 1, sequence }),
    ).toEqual({ accepted: false, reason: "paused" });
    expect(playout.current?.id).toBe("a");
  });

  it("stop keeps the queue and the current cue", () => {
    const { playout } = createPlayout();
    const a = cue("a");
    playout.setQueue([a, cue("b")]);
    playout.start();
    playout.stop();
    vi.advanceTimersByTime(60_000);
    expect(playout.isPaused).toBe(true);
    expect(playout.current).toBe(a);
    expect(a.status).toBe("playing");
  });
});

describe("Playout thinking wait", () => {
  it("waits up to maxThinkingMs and then skips a cue that is not ready", () => {
    const { playout, events } = createPlayout({ maxThinkingMs: 500 });
    const a = cue("a");
    const pending = cue("b", { status: "preparing", audio: null });
    const c = cue("c");
    playout.setQueue([a, pending, c]);
    playout.start();
    playout.handleAudioEnded({ cueId: "a", attempt: 1, sequence: 1 });

    expect(playout.isThinking).toBe(true);
    expect(playout.current).toBe(pending);
    expect(events.some((event) => event.type === "thinking")).toBe(true);
    vi.advanceTimersByTime(499);
    expect(playout.current).toBe(pending);
    vi.advanceTimersByTime(1);

    expect(pending.status).toBe("skipped");
    expect(playout.current).toBe(c);
    expect(events.some((event) => event.type === "cue_skipped")).toBe(true);
  });

  it("starts the cue as soon as it becomes ready during the wait", () => {
    const { playout } = createPlayout({ maxThinkingMs: 2000 });
    const pending = cue("b", { status: "preparing", audio: null });
    playout.setQueue([cue("a"), pending]);
    playout.start();
    playout.handleAudioEnded({ cueId: "a", attempt: 1, sequence: 1 });
    expect(playout.isThinking).toBe(true);

    pending.status = "ready";
    pending.audio = "audio/generated/b.wav";
    vi.advanceTimersByTime(100);

    expect(playout.isThinking).toBe(false);
    expect(playout.current).toBe(pending);
    expect(playout.currentAttempt).toBe(1);
    expect(pending.status).toBe("playing");
  });

  it("skips immediately when maxThinkingMs is zero", () => {
    const { playout } = createPlayout({ maxThinkingMs: 0 });
    const pending = cue("b", { status: "preparing", audio: null });
    playout.setQueue([cue("a"), pending, cue("c")]);
    playout.start();
    playout.handleAudioEnded({ cueId: "a", attempt: 1, sequence: 1 });
    expect(pending.status).toBe("skipped");
    expect(playout.current?.id).toBe("c");
  });
});

describe("Playout generated cue removal", () => {
  it("discards generated cues and continues with the prepared cue", () => {
    const { playout } = createPlayout();
    const a = cue("a");
    const generated = cue("g", { source: "generated", status: "ready" });
    const b = cue("b");
    playout.setQueue([a, generated, b]);
    playout.start();
    playout.skipCurrent();
    expect(playout.current).toBe(generated);

    const removed = playout.discardGeneratedCues({ continuePlaying: true });
    expect(removed).toEqual([generated]);
    expect(playout.current).toBe(b);
    expect(b.status).toBe("playing");
  });
});
