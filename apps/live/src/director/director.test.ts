import { describe, expect, it } from "vitest";
import {
  createDirector,
  DirectorSafetyError,
  generateDirectorOutput,
  generatedCueLogData,
  type DirectorLlmConfig,
} from "./director.ts";
import type { DirectorContext } from "./prompt.ts";

function context(overrides: Partial<DirectorContext> = {}): DirectorContext {
  return {
    persona: "親しみやすい解説役",
    blockedTopics: ["政治"],
    maxResponseChars: 40,
    maxResponseCues: 2,
    segmentLabel: "コメントコーナー",
    segmentRemainingMs: 60_000,
    showRemainingMs: 300_000,
    recentCaptions: [],
    candidate: {
      safeSummary: "背景を聞きたい",
      safeQuestion: "なぜ起きたのか",
      suggestedAngle: "背景を補足する",
    },
    pinNote: null,
    materialLabel: null,
    expressions: ["normal", "smile"],
    speakerNames: { left: "みかん", right: null },
    ...overrides,
  };
}

function llm(overrides: Partial<DirectorLlmConfig> = {}): DirectorLlmConfig {
  return {
    mode: "local",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "test-model",
    timeoutMs: 2_000,
    ...overrides,
  };
}

function cue(overrides: Record<string, unknown> = {}) {
  return {
    speaker: "left",
    caption: "なるほど。",
    speech: "なるほど。",
    expression: "smile",
    ...overrides,
  };
}

function chatResponse(value: unknown): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("director generation", () => {
  it("returns a valid structured output", async () => {
    const output = await generateDirectorOutput({
      llm: llm(),
      context: context(),
      fetch: async () => chatResponse({ cues: [cue()], skip: false }),
    });
    expect(output.cues).toHaveLength(1);
    expect(output.skip).toBe(false);
  });

  it("returns skip as-is", async () => {
    const output = await generateDirectorOutput({
      llm: llm(),
      context: context(),
      fetch: async () => chatResponse({ cues: [], skip: true }),
    });
    expect(output).toEqual({ cues: [], skip: true });
  });

  it("retries invalid JSON once and succeeds", async () => {
    let calls = 0;
    const output = await generateDirectorOutput({
      llm: llm(),
      context: context(),
      fetch: async () => {
        calls += 1;
        return calls === 1
          ? new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }))
          : chatResponse({ cues: [cue()], skip: false });
      },
    });
    expect(calls).toBe(2);
    expect(output.cues).toHaveLength(1);
  });

  it("fails with invalid after two bad outputs", async () => {
    let calls = 0;
    await expect(
      generateDirectorOutput({
        llm: llm(),
        context: context(),
        fetch: async () => {
          calls += 1;
          return new Response(
            JSON.stringify({ choices: [{ message: { content: "{broken" } }] }),
          );
        },
      }),
    ).rejects.toMatchObject({ reason: "invalid" });
    expect(calls).toBe(2);
  });

  it("regenerates once after a safety violation", async () => {
    let calls = 0;
    const output = await generateDirectorOutput({
      llm: llm(),
      context: context(),
      fetch: async () => {
        calls += 1;
        return calls === 1
          ? chatResponse({ cues: [cue({ caption: "https://example.com" })], skip: false })
          : chatResponse({ cues: [cue()], skip: false });
      },
    });
    expect(calls).toBe(2);
    expect(output.cues[0]?.caption).toBe("なるほど。");
  });

  it("does not retry on timeout", async () => {
    let calls = 0;
    await expect(
      generateDirectorOutput({
        llm: llm({ timeoutMs: 10 }),
        context: context(),
        fetch: async () => {
          calls += 1;
          return new Promise<Response>(() => undefined);
        },
      }),
    ).rejects.toMatchObject({ reason: "timeout" });
    expect(calls).toBe(1);
  });

  it("does not retry on LLM transport errors", async () => {
    let calls = 0;
    await expect(
      generateDirectorOutput({
        llm: llm(),
        context: context(),
        fetch: async () => {
          calls += 1;
          return new Response("nope", { status: 500 });
        },
      }),
    ).rejects.toMatchObject({ reason: "llm" });
    expect(calls).toBe(1);
  });

  it("rejects external LLMs for a real YouTube source", () => {
    expect(() =>
      createDirector({
        llm: llm({ mode: "external", baseUrl: "https://llm.example.com/v1" }),
        sourceKind: "youtube",
      }),
    ).toThrow(DirectorSafetyError);
    expect(() =>
      createDirector({
        llm: llm({ mode: "local", baseUrl: "https://llm.example.com/v1" }),
        sourceKind: "youtube",
      }),
    ).toThrow(DirectorSafetyError);
    expect(() =>
      createDirector({
        llm: llm({ mode: "external", baseUrl: "https://llm.example.com/v1" }),
        sourceKind: "fixture",
      }),
    ).not.toThrow();
  });

  it("builds cue_generated log data without raw comments", async () => {
    const output = await generateDirectorOutput({
      llm: llm(),
      context: context(),
      fetch: async () => chatResponse({ cues: [cue()], skip: false }),
    });
    expect(
      generatedCueLogData(output, { commentId: "yt-1", reason: "generated" }),
    ).toMatchObject({
      commentId: "yt-1",
      cueCount: 1,
      skip: false,
      cues: [{ speaker: "left", caption: "なるほど。" }],
    });
  });
});
