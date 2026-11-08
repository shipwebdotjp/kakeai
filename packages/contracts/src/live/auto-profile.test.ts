import { describe, expect, it } from "vitest";
import {
  liveAutoProfileRequestSchema,
  liveAutoProfileResultSchema,
  liveShowProfileSchema,
} from "..";

function profile() {
  return liveShowProfileSchema.parse({
    schemaVersion: 1,
    show: {
      title: "自動生成テスト",
      locale: "ja-JP",
      targetDurationMs: 600_000,
      stageTemplate: "news-desk",
      characters: { left: "char-left", right: null },
      startAt: null,
    },
    commentSource: { kind: "youtube" },
    segments: [
      {
        id: "seg-opening",
        kind: "opening",
        label: "オープニング",
        targetDurationMs: 60_000,
        cues: ["cue-opening"],
      },
      {
        id: "seg-script",
        kind: "script",
        label: "本編",
        targetDurationMs: 300_000,
        cues: ["cue-script"],
      },
      {
        id: "seg-closing",
        kind: "closing",
        label: "クロージング",
        targetDurationMs: 60_000,
        cues: ["cue-closing"],
      },
    ],
    scriptCues: [{ id: "cue-script", lineId: "line-1" }],
    liveCues: [
      {
        id: "cue-opening",
        speaker: "left",
        caption: "始まります。",
        speech: "はじまります。",
        expression: "normal",
      },
      {
        id: "cue-closing",
        speaker: "left",
        caption: "終わります。",
        speech: "おわります。",
        expression: "normal",
      },
    ],
    materials: [],
    safety: {
      blockedTopics: [],
      persona: "解説役",
      maxResponseChars: 180,
      maxResponseCues: 2,
      fallbackCueId: "cue-opening",
    },
  });
}

describe("live auto profile contracts", () => {
  it("defaults includeCommentCorners to true", () => {
    const parsed = liveAutoProfileRequestSchema.parse({
      workId: "work-1",
      scriptVersionId: "script-1",
    });
    expect(parsed.includeCommentCorners).toBe(true);
  });

  it("round-trips a generated result", () => {
    const parsed = liveAutoProfileResultSchema.parse({
      profile: profile(),
      summary: {
        title: "自動生成テスト",
        targetDurationMs: 600_000,
        characters: { left: "左キャラ", right: null },
        segments: [
          {
            kind: "opening",
            label: "オープニング",
            cueCount: 1,
            materialLabel: null,
          },
          {
            kind: "script",
            label: "本編",
            cueCount: 1,
            materialLabel: null,
          },
          {
            kind: "closing",
            label: "クロージング",
            cueCount: 1,
            materialLabel: null,
          },
        ],
        materials: [],
      },
      warnings: ["opening cue を作成しました。"],
    });
    expect(parsed.profile.show.title).toBe("自動生成テスト");
    expect(parsed.summary.characters.left).toBe("左キャラ");
    expect(parsed.warnings).toHaveLength(1);
  });

  it("rejects a summary with a negative cue count", () => {
    expect(
      liveAutoProfileResultSchema.safeParse({
        profile: profile(),
        summary: {
          title: "自動生成テスト",
          targetDurationMs: 600_000,
          characters: { left: "左キャラ", right: null },
          segments: [
            {
              kind: "opening",
              label: "オープニング",
              cueCount: -1,
              materialLabel: null,
            },
          ],
          materials: [],
        },
        warnings: [],
      }).success,
    ).toBe(false);
  });
});
