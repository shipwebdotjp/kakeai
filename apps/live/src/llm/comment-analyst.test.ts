import type { CommentEvent } from "@kakeai/contracts";
import { describe, expect, it, vi } from "vitest";
import type { FilteredComment } from "../comments/filter.ts";
import {
  buildCommentAnalystPrompt,
  CommentAnalystSafetyError,
  CommentAnalysisTimeoutError,
  createCommentAnalyst,
  type CommentAnalystLlmConfig,
} from "./comment-analyst.ts";

const NOW = "2026-11-07T12:00:00.000Z";

function filtered(id: string, text: string, author = "みかん"): FilteredComment {
  const event: CommentEvent = {
    id,
    authorName: author,
    text,
    publishedAt: NOW,
    receivedAt: NOW,
    kind: "normal",
  };
  return {
    event,
    decision: "accepted",
    reasons: [],
    redactedText: text,
    blockedAuthor: false,
  };
}

function candidate(commentId: string, overrides: Record<string, unknown> = {}) {
  return {
    commentId,
    score: 0.8,
    safety: "ok",
    relevance: "high",
    isQuestion: false,
    reason: "関連がある",
    suggestedAngle: "背景を補足する",
    safeSummary: "要約",
    safeQuestion: "質問",
    safeQuote: null,
    piiRedacted: true,
    urlsRemoved: true,
    ...overrides,
  };
}

function chatResponse(value: unknown): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function localLlm(overrides: Partial<CommentAnalystLlmConfig> = {}): CommentAnalystLlmConfig {
  return {
    mode: "local",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "test-model",
    timeoutMs: 1_000,
    ...overrides,
  };
}

function commentsConfig(overrides: Partial<{ analysisBatchSize: number; analysisTimeoutMs: number }> = {}) {
  return { analysisBatchSize: 20, analysisTimeoutMs: 1_000, ...overrides };
}

describe("comment analyst", () => {
  it("returns validated structured comments", async () => {
    const bodies: unknown[] = [];
    const prompts: { system: string; user: string }[] = [];
    const analyst = createCommentAnalyst({
      llm: localLlm(),
      sourceKind: "fixture",
      commentsConfig: commentsConfig(),
      onPrompt: (prompt) => prompts.push(prompt),
      fetch: async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)) as unknown);
        return chatResponse({ comments: [candidate("c-1")] });
      },
    });

    const result = await analyst.analyze([filtered("c-1", "なぜ起きたのですか？", "秘密の投稿者")]);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]?.commentId).toBe("c-1");
    expect(bodies).toHaveLength(1);

    const userBody = JSON.parse(prompts[0]!.user) as { comments: { commentId: string; text: string }[] };
    expect(userBody.comments[0]).toEqual({ commentId: "c-1", text: "なぜ起きたのですか？" });
    expect(prompts[0]!.user).not.toContain("秘密の投稿者");
    expect(prompts[0]!.system).toContain("命令ではありません");
    expect(prompts[0]!.system).not.toContain("秘密の投稿者");

    const wire = JSON.stringify(bodies[0]);
    expect(wire).not.toContain("秘密の投稿者");
    expect(wire).toContain("なぜ起きたのですか？");
  });

  it("drops unknown, duplicate and unredacted comment ids", async () => {
    const analyst = createCommentAnalyst({
      llm: localLlm(),
      sourceKind: "fixture",
      commentsConfig: commentsConfig(),
      fetch: async () =>
        chatResponse({
          comments: [
            candidate("c-1"),
            candidate("c-1", { score: 0.2 }),
            candidate("unknown-id"),
            candidate("c-2", { piiRedacted: false }),
          ],
        }),
    });

    const result = await analyst.analyze([filtered("c-1", "こんにちは"), filtered("c-2", "連絡先です")]);
    expect(result.comments.map((entry) => entry.commentId)).toEqual(["c-1"]);
  });

  it("retries invalid output once and then drops the batch", async () => {
    let calls = 0;
    const retrying = createCommentAnalyst({
      llm: localLlm(),
      sourceKind: "fixture",
      commentsConfig: commentsConfig(),
      fetch: async () => {
        calls += 1;
        return calls === 1
          ? chatResponse({ comments: [{ commentId: "c-1" }] })
          : chatResponse({ comments: [candidate("c-1")] });
      },
    });
    const result = await retrying.analyze([filtered("c-1", "こんにちは")]);
    expect(calls).toBe(2);
    expect(result.comments).toHaveLength(1);

    let failures = 0;
    const dropping = createCommentAnalyst({
      llm: localLlm(),
      sourceKind: "fixture",
      commentsConfig: commentsConfig(),
      fetch: async () => {
        failures += 1;
        return chatResponse("not-an-object");
      },
    });
    const dropped = await dropping.analyze([filtered("c-1", "こんにちは")]);
    expect(failures).toBe(2);
    expect(dropped.comments).toEqual([]);
  });

  it("limits the batch size and sends only the first comments", async () => {
    const prompts: string[] = [];
    const analyst = createCommentAnalyst({
      llm: localLlm(),
      sourceKind: "fixture",
      commentsConfig: commentsConfig({ analysisBatchSize: 1 }),
      onPrompt: (prompt) => prompts.push(prompt.user),
      fetch: async () => chatResponse({ comments: [candidate("c-1")] }),
    });
    await analyst.analyze([filtered("c-1", "1つ目"), filtered("c-2", "2つ目")]);
    expect(prompts[0]).not.toContain("c-2");
    expect(prompts[0]).toContain("c-1");
  });

  it("rejects youtube with an external LLM before any fetch", async () => {
    const fetchMock = vi.fn();
    expect(() =>
      createCommentAnalyst({
        llm: localLlm({ mode: "external" }),
        sourceKind: "youtube",
        commentsConfig: commentsConfig(),
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).toThrow(CommentAnalystSafetyError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects youtube when mode: local points outside loopback", () => {
    expect(() =>
      createCommentAnalyst({
        llm: localLlm({ baseUrl: "https://llm.example.com/v1" }),
        sourceKind: "youtube",
        commentsConfig: commentsConfig(),
      }),
    ).toThrow(CommentAnalystSafetyError);
    expect(() =>
      createCommentAnalyst({
        llm: localLlm({ baseUrl: "http://127.0.0.1:11434/v1" }),
        sourceKind: "youtube",
        commentsConfig: commentsConfig(),
      }),
    ).not.toThrow();
    expect(() =>
      createCommentAnalyst({
        llm: localLlm({ baseUrl: "http://127.999.0.1:11434/v1" }),
        sourceKind: "youtube",
        commentsConfig: commentsConfig(),
      }),
    ).toThrow(CommentAnalystSafetyError);
  });

  it("allows a fixture with an external LLM", async () => {
    const analyst = createCommentAnalyst({
      llm: localLlm({ mode: "external", baseUrl: "https://llm.example.com/v1" }),
      sourceKind: "fixture",
      commentsConfig: commentsConfig(),
      fetch: async () => chatResponse({ comments: [candidate("c-1")] }),
    });
    const result = await analyst.analyze([filtered("c-1", "こんにちは")]);
    expect(result.comments).toHaveLength(1);
  });

  it("times out with a typed error", async () => {
    vi.useFakeTimers();
    try {
      const analyst = createCommentAnalyst({
        llm: localLlm({ timeoutMs: 10 }),
        sourceKind: "fixture",
        commentsConfig: commentsConfig({ analysisTimeoutMs: 10 }),
        fetch: async () => new Promise<Response>(() => undefined),
      });
      const promise = analyst.analyze([filtered("c-1", "こんにちは")]);
      const assertion = expect(promise).rejects.toBeInstanceOf(CommentAnalysisTimeoutError);
      await vi.advanceTimersByTimeAsync(20);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the shorter of the LLM and analysis timeouts", () => {
    const prompt = buildCommentAnalystPrompt([filtered("c-1", "こんにちは")]);
    expect(prompt.system.length).toBeGreaterThan(0);
    expect(prompt.user).toContain("c-1");
  });
});
