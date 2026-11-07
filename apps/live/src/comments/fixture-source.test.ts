import type { CommentEvent, LiveFixtureComment } from "@kakeai/contracts";
import { describe, expect, it } from "vitest";
import { FakeCommentScheduler } from "../testing/fake-scheduler.ts";
import { FixtureCommentSource } from "./fixture-source.ts";

const comments: LiveFixtureComment[] = [
  { atMs: 1_000, author: "みかん", text: "こんにちは", kind: "normal" },
  { atMs: 4_000, author: "ゆず", text: "質問です", kind: "normal" },
];

function setup(fixture: LiveFixtureComment[], speed = 1) {
  const scheduler = new FakeCommentScheduler();
  const base = Date.parse("2026-11-07T12:00:00.000Z");
  const source = new FixtureCommentSource({
    comments: fixture,
    initialSpeed: speed,
    scheduler,
    now: () => new Date(base + scheduler.currentTimeMs),
  });
  const received: CommentEvent[] = [];
  source.onComment((comment) => received.push(comment));
  return { scheduler, source, received };
}

describe("FixtureCommentSource", () => {
  it("emits comments at atMs relative to start", async () => {
    const { scheduler, source, received } = setup(comments);
    const statuses: string[] = [];
    source.onStatus((status) => statuses.push(status.state));

    expect(source.getStatus()).toMatchObject({
      kind: "fixture",
      state: "idle",
      quota: null,
      authExpiresAt: null,
      needsReauth: false,
    });

    await source.start();
    expect(source.getStatus().state).toBe("polling");
    expect(received).toHaveLength(0);
    expect(scheduler.pendingDelaysMs).toEqual([1_000]);

    await scheduler.advance(999);
    expect(received).toHaveLength(0);
    await scheduler.advance(1);
    expect(received.map((comment) => comment.id)).toEqual(["fixture-g1-1"]);
    expect(received[0]).toMatchObject({ authorName: "みかん", text: "こんにちは" });

    await scheduler.advance(3_000);
    expect(received.map((comment) => comment.text)).toEqual(["こんにちは", "質問です"]);
    expect(statuses).toContain("polling");
    expect(scheduler.pendingCount).toBe(0);
  });

  it("changes speed for the remaining schedule", async () => {
    const { scheduler, source, received } = setup(comments, 2);
    await source.start();
    // atMs 1000 at 2x is 500ms of wall time.
    expect(scheduler.pendingDelaysMs).toEqual([500]);

    source.setSpeed(0.5);
    // atMs 1000 at 0.5x is 2000ms of wall time.
    expect(scheduler.pendingDelaysMs).toEqual([2_000]);

    await scheduler.advance(2_000);
    expect(received).toHaveLength(1);
    expect(scheduler.pendingDelaysMs).toEqual([6_000]);
  });

  it("does not emit after stop and resumes on start", async () => {
    const { scheduler, source, received } = setup(comments);
    await source.start();
    await scheduler.advance(1_000);
    expect(received).toHaveLength(1);

    source.stop();
    expect(source.getStatus().state).toBe("stopped");
    await scheduler.advance(10_000);
    expect(received).toHaveLength(1);
    expect(scheduler.pendingCount).toBe(0);

    source.start();
    await scheduler.advance(3_000);
    expect(received.map((comment) => comment.text)).toEqual(["こんにちは", "質問です"]);
  });

  it("resets to the beginning and can start again", async () => {
    const { scheduler, source, received } = setup(comments);
    await source.start();
    await scheduler.advance(1_000);
    expect(received).toHaveLength(1);

    source.reset();
    expect(source.getStatus().state).toBe("idle");
    expect(scheduler.pendingCount).toBe(0);

    await source.start();
    await scheduler.advance(1_000);
    expect(received.map((comment) => comment.id)).toEqual(["fixture-g1-1", "fixture-g2-1"]);
  });

  it("does not advance while stopped when the speed changes", async () => {
    const { scheduler, source, received } = setup(comments);
    await source.start();
    await scheduler.advance(1_000);
    source.stop();
    source.setSpeed(2);
    await scheduler.advance(10_000);
    expect(received).toHaveLength(1);

    await source.start();
    await scheduler.advance(1_500);
    expect(received.map((comment) => comment.text)).toEqual(["こんにちは", "質問です"]);
  });

  it("works with an empty fixture", async () => {
    const { scheduler, source, received } = setup([]);
    await source.start();
    expect(source.getStatus().state).toBe("polling");
    expect(scheduler.pendingCount).toBe(0);
    await scheduler.advance(10_000);
    expect(received).toHaveLength(0);
    source.stop();
    expect(source.getStatus().state).toBe("stopped");
  });

  it("rejects an invalid atMs", () => {
    expect(
      () =>
        new FixtureCommentSource({
          comments: [{ atMs: Number.NaN, author: "a", text: "b", kind: "normal" }],
        }),
    ).toThrow(/atMs/);
  });
});
