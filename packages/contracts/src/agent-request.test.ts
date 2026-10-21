import { describe, expect, it } from "vitest";
import {
  agentCompositionPublishInputSchema,
  agentRenderStartInputSchema,
  agentTtsCreateBulkInputSchema,
  agentTtsCreateInputSchema,
} from "./agent";
import {
  agentRequestHashPayload,
  agentRequestIdSchema,
  canonicalAgentRequestJson,
} from "./agent-request";

describe("optional requestId on the high-cost operations", () => {
  it("accepts a requestId and keeps it optional", () => {
    expect(agentRequestIdSchema.safeParse("req-1").success).toBe(true);
    expect(agentRequestIdSchema.safeParse("  req-1  ").success).toBe(true);
    expect(agentRequestIdSchema.safeParse("   ").success).toBe(false);
    expect(agentRequestIdSchema.safeParse("").success).toBe(false);

    expect(
      agentTtsCreateInputSchema.safeParse({
        scriptVersionId: "scr-1",
        narrationSegmentId: "line-1",
        requestId: "req-1",
      }).success,
    ).toBe(true);
    expect(
      agentTtsCreateInputSchema.safeParse({
        scriptVersionId: "scr-1",
        narrationSegmentId: "line-1",
      }).success,
    ).toBe(true);
    expect(
      agentTtsCreateBulkInputSchema.safeParse({
        scriptVersionId: "scr-1",
        requestId: "req-1",
      }).success,
    ).toBe(true);
    expect(
      agentTtsCreateBulkInputSchema.safeParse({ scriptVersionId: "scr-1" }).success,
    ).toBe(true);
    expect(
      agentRenderStartInputSchema.safeParse({
        scriptVersionId: "scr-1",
        requestId: "req-1",
      }).success,
    ).toBe(true);
    expect(
      agentRenderStartInputSchema.safeParse({ scriptVersionId: "scr-1" }).success,
    ).toBe(true);
    expect(
      agentCompositionPublishInputSchema.safeParse({
        compositionId: "cmp-1",
        requestId: "req-1",
      }).success,
    ).toBe(true);
    expect(
      agentCompositionPublishInputSchema.safeParse({ compositionId: "cmp-1" }).success,
    ).toBe(true);
  });

  it("still rejects unknown keys and blank request ids", () => {
    expect(
      agentTtsCreateInputSchema.safeParse({
        scriptVersionId: "scr-1",
        narrationSegmentId: "line-1",
        requestId: "req-1",
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      agentTtsCreateBulkInputSchema.safeParse({
        scriptVersionId: "scr-1",
        requestId: "req-1",
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      agentRenderStartInputSchema.safeParse({
        scriptVersionId: "scr-1",
        requestId: "req-1",
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      agentCompositionPublishInputSchema.safeParse({
        compositionId: "cmp-1",
        requestId: "req-1",
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      agentTtsCreateInputSchema.safeParse({
        scriptVersionId: "scr-1",
        narrationSegmentId: "line-1",
        requestId: "   ",
      }).success,
    ).toBe(false);
    expect(
      agentCompositionPublishInputSchema.safeParse({
        compositionId: "cmp-1",
        dryRun: true,
        requestId: "req-1",
      }).success,
    ).toBe(true);
  });
});

describe("request hash payload", () => {
  it("ignores the requestId so the same logical request hashes identically", () => {
    const withId = agentRequestHashPayload("tts.create", {
      scriptVersionId: "scr-1",
      narrationSegmentId: "line-1",
      requestId: "req-1",
    });
    const withoutId = agentRequestHashPayload("tts.create", {
      scriptVersionId: "scr-1",
      narrationSegmentId: "line-1",
    });
    expect(canonicalAgentRequestJson(withId)).toBe(
      canonicalAgentRequestJson(withoutId),
    );
  });

  it("is stable and independent of the key order", () => {
    const first = agentRequestHashPayload("render.start", {
      scriptVersionId: "scr-1",
    });
    const second = agentRequestHashPayload("render.start", {
      scriptVersionId: "scr-1",
    });
    expect(canonicalAgentRequestJson(first)).toBe(canonicalAgentRequestJson(second));
    expect(
      canonicalAgentRequestJson({
        b: 1,
        a: { d: 2, c: 3 },
      }),
    ).toBe(canonicalAgentRequestJson({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("separates the operations from each other", () => {
    expect(
      canonicalAgentRequestJson(agentRequestHashPayload("tts.create", { a: 1 })),
    ).not.toBe(
      canonicalAgentRequestJson(agentRequestHashPayload("tts.createBulk", { a: 1 })),
    );
  });

  it("drops undefined members so an absent optional field hashes like one", () => {
    expect(
      canonicalAgentRequestJson(agentRequestHashPayload("tts.create", { a: 1 })),
    ).toBe(
      canonicalAgentRequestJson(
        agentRequestHashPayload("tts.create", { a: 1, b: undefined }),
      ),
    );
  });
});
