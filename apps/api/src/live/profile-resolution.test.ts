import { describe, expect, it } from "vitest";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import type {
  LiveShowProfile,
  LiveVoiceProfileSnapshot,
} from "@kakeai/contracts";
import { resolveLiveProfile, type ResolvedAssetFile } from "./profile-resolution";
import { LiveExportError } from "./errors";

const audioAsset: ResolvedAssetFile = {
  assetId: "asset-audio-1",
  path: "/tmp/audio.wav",
  kind: "audio",
  mediaType: "audio/wav",
  sha256: "a".repeat(64),
  byteSize: 10,
  durationMs: 3000,
  widthPx: null,
  heightPx: null,
  hasAudio: true,
};

const voice: LiveVoiceProfileSnapshot = {
  id: "voice-1",
  name: "声",
  adapterId: "voicevox",
  voiceId: "voice-1",
  locale: "ja-JP",
  settings: {},
};

function profile(lineId = "line-p1-1"): LiveShowProfile {
  return {
    schemaVersion: 1,
    show: {
      title: "テスト",
      locale: "ja-JP",
      targetDurationMs: 600_000,
      stageTemplate: "news-desk",
      theme: "theme.css",
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
    scriptCues: [{ id: "cue-script", lineId }],
    liveCues: [
      {
        id: "cue-opening",
        speaker: "left",
        caption: "始まります。",
        speech: "はじまります。",
        expression: "normal",
        audioAssetId: "asset-audio-1",
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
    commentPolicy: {
      mode: "corner",
      freshnessMin: 10,
      maxCommentsPerCorner: 4,
      maxHumanPinsPerCorner: 4,
      maxExtraSlots: 2,
      allowImmediateInterrupt: false,
      skipWhenEmpty: true,
    },
    safety: {
      blockedTopics: [],
      persona: "解説役",
      maxResponseChars: 180,
      maxResponseCues: 2,
      fallbackCueId: "cue-opening",
    },
    playout: {
      minBufferMs: 10_000,
      maxThinkingMs: 2000,
      closingReserveMs: 120_000,
      noApprovalDelay: true,
    },
  };
}

describe("resolveLiveProfile", () => {
  it("resolves script lines by lineId and keeps live cues as origin live", () => {
    const content = validContentDocument();
    content.speakers[0]!.characterId = "char-left";
    content.speakers[0]!.voiceProfileId = "voice-1";
    const resolved = resolveLiveProfile(
      content,
      profile(),
      new Map([["asset-audio-1", audioAsset]]),
      new Map([["voice-1", voice]]),
    );
    expect(resolved.cues).toHaveLength(3);
    const script = resolved.cues.find((cue) => cue.id === "cue-script");
    expect(script?.origin).toBe("script");
    expect(script?.sourceLineId).toBe("line-p1-1");
    expect(script?.speaker).toBe("left");
    expect(script?.audio.kind).toBe("asset");
    const live = resolved.cues.find((cue) => cue.id === "cue-closing");
    expect(live?.origin).toBe("live");
    expect(live?.audio.kind).toBe("tts");
    expect(resolved.speakers).toHaveLength(1);
    expect(resolved.speakers[0]?.side).toBe("left");
  });

  it("rejects a missing lineId", () => {
    const content = validContentDocument();
    content.speakers[0]!.characterId = "char-left";
    content.speakers[0]!.voiceProfileId = "voice-1";
    expect(() =>
      resolveLiveProfile(
        content,
        profile("line-missing"),
        new Map([["asset-audio-1", audioAsset]]),
        new Map([["voice-1", voice]]),
      ),
    ).toThrow(LiveExportError);
  });
});
