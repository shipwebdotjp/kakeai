import { describe, expect, it } from "vitest";
import type { DirectorContext } from "./prompt.ts";
import { directorSafetyPolicyFromContext, validateDirectorOutput } from "./safety.ts";

function context(overrides: Partial<DirectorContext> = {}): DirectorContext {
  return {
    persona: "親しみやすい解説役",
    blockedTopics: ["政治"],
    maxResponseChars: 20,
    maxResponseCues: 2,
    segmentLabel: "コメントコーナー",
    segmentRemainingMs: 60_000,
    showRemainingMs: 300_000,
    recentCaptions: [],
    candidate: {
      safeSummary: "要約",
      safeQuestion: "質問",
      suggestedAngle: "補足する",
    },
    pinNote: null,
    materialLabel: null,
    expressions: ["normal", "smile"],
    speakerNames: { left: "みかん", right: null },
    ...overrides,
  };
}

function output(cues: unknown[], skip = false): unknown {
  return { cues, skip };
}

function cue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    speaker: "left",
    caption: "なるほど。",
    speech: "なるほど。",
    expression: "smile",
    ...overrides,
  };
}

describe("director safety", () => {
  it("accepts a valid output and skip", () => {
    const policy = directorSafetyPolicyFromContext(context());
    expect(validateDirectorOutput(output([cue()]), policy)).toMatchObject({ ok: true });
    expect(validateDirectorOutput(output([], true), policy)).toMatchObject({ ok: true });
    expect(
      validateDirectorOutput(output([cue({ speaker: "none" })]), policy),
    ).toMatchObject({ ok: true });
  });

  it("rejects schema violations and too many cues", () => {
    const policy = directorSafetyPolicyFromContext(context());
    expect(
      validateDirectorOutput(output([{ speaker: "left", caption: "x" }]), policy),
    ).toMatchObject({ ok: false, reason: "invalid" });
    expect(
      validateDirectorOutput(
        output([cue(), cue(), cue()]),
        policy,
      ),
    ).toMatchObject({ ok: false, reason: "unsafe" });
  });

  it("rejects overlong captions and speech", () => {
    const policy = directorSafetyPolicyFromContext(context());
    expect(
      validateDirectorOutput(output([cue({ caption: "あ".repeat(21) })]), policy),
    ).toMatchObject({ ok: false, reason: "unsafe" });
    expect(
      validateDirectorOutput(output([cue({ speech: "あ".repeat(41) })]), policy),
    ).toMatchObject({ ok: false, reason: "unsafe" });
  });

  it("rejects blocked topics in caption or speech", () => {
    const policy = directorSafetyPolicyFromContext(context());
    expect(
      validateDirectorOutput(output([cue({ caption: "政治の話です" })]), policy),
    ).toMatchObject({ ok: false, reason: "unsafe" });
    expect(
      validateDirectorOutput(output([cue({ speech: "せいじ" })]), directorSafetyPolicyFromContext(
        context({ blockedTopics: ["せいじ"] }),
      )),
    ).toMatchObject({ ok: false, reason: "unsafe" });
  });

  it("rejects URLs, HTML, Markdown links and PII", () => {
    const policy = directorSafetyPolicyFromContext(context({ maxResponseChars: 200 }));
    for (const caption of [
      "https://example.com を見て",
      "www.example.com",
      "example.com を見て",
      "<b>すごい</b>",
      "[ここ](https://example.com)",
      "taro@example.com",
      "03-1234-5678",
      "09012345678",
      "〒150-0001",
      "東京都渋谷区1-2-3",
    ]) {
      expect(validateDirectorOutput(output([cue({ caption })]), policy)).toMatchObject({
        ok: false,
        reason: "unsafe",
      });
    }
  });

  it("rejects strong assertions but allows ordinary hedged speech", () => {
    const policy = directorSafetyPolicyFromContext(context({ maxResponseChars: 100 }));
    for (const caption of [
      "絶対にそうなります",
      "間違いなく事実です",
      "100%確実です",
      "必ずそうなります",
    ]) {
      expect(validateDirectorOutput(output([cue({ caption })]), policy)).toMatchObject({
        ok: false,
        reason: "unsafe",
      });
    }
    expect(
      validateDirectorOutput(output([cue({ caption: "たぶんそうだと思います" })]), policy),
    ).toMatchObject({ ok: true });
    expect(
      validateDirectorOutput(output([cue({ caption: "必ずしもそうとは限りません" })]), policy),
    ).toMatchObject({ ok: true });
  });

  it("normalizes an unknown expression instead of dropping the output", () => {
    const policy = directorSafetyPolicyFromContext(context());
    const result = validateDirectorOutput(output([cue({ expression: "unknown-face" })]), policy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.normalized).toBe(true);
      expect(result.output.cues[0]?.expression).toBe("normal");
    }
  });

  it("allows an empty skip=false output only through schema rejection", () => {
    const policy = directorSafetyPolicyFromContext(context());
    expect(validateDirectorOutput(output([], false), policy)).toMatchObject({
      ok: false,
      reason: "invalid",
    });
  });
});
