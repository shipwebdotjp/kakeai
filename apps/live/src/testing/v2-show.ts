import { livePackageShowSchema, type LivePackageShow } from "@kakeai/contracts";

/**
 * Minimal valid v2 package show for runtime tests. It has three script cues so
 * a test can walk a segment default, a same-card state change and a card
 * switch without building package files.
 */
export function testV2Show(): LivePackageShow {
  return livePackageShowSchema.parse({
    schemaVersion: 2,
    show: {
      title: "テスト配信 v2",
      locale: "ja-JP",
      targetDurationMs: 600_000,
      stageTemplate: "news-desk",
      theme: "theme.css",
      characters: { left: "char-left", right: null },
    },
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
        cues: ["cue-script-1", "cue-script-2", "cue-script-3"],
        visual: { kind: "card", cardId: "card-list", stateId: "state-list-title" },
      },
      {
        id: "seg-closing",
        kind: "closing",
        label: "クロージング",
        targetDurationMs: 60_000,
        cues: ["cue-closing"],
      },
    ],
    cues: [
      {
        id: "cue-opening",
        origin: "live",
        speaker: "left",
        caption: "始まります。",
        speech: "はじまります。",
        expression: "normal",
        audio: "audio/prepared/cue-opening.wav",
        durationMs: 1000,
      },
      {
        id: "cue-script-1",
        origin: "live",
        speaker: "left",
        caption: "本編です。",
        speech: "ほんぺんです。",
        expression: "normal",
        audio: "audio/prepared/cue-script-1.wav",
        durationMs: 1000,
      },
      {
        id: "cue-script-2",
        origin: "live",
        speaker: "left",
        caption: "項目が増えます。",
        speech: "こうもくが ふえます。",
        expression: "smile",
        visual: { kind: "card", cardId: "card-list", stateId: "state-list-item" },
        audio: "audio/prepared/cue-script-2.wav",
        durationMs: 1000,
      },
      {
        id: "cue-script-3",
        origin: "live",
        speaker: "left",
        caption: "別のカードです。",
        speech: "べつの かーどです。",
        expression: "normal",
        visual: { kind: "card", cardId: "card-quote", stateId: "state-quote" },
        audio: "audio/prepared/cue-script-3.wav",
        durationMs: 1000,
      },
      {
        id: "cue-closing",
        origin: "live",
        speaker: "left",
        caption: "終わります。",
        speech: "おわります。",
        expression: "normal",
        audio: "audio/prepared/cue-closing.wav",
        durationMs: 1000,
      },
      {
        id: "cue-fallback",
        origin: "live",
        speaker: "left",
        caption: "補足します。",
        speech: "ほそくします。",
        expression: "normal",
        audio: "audio/prepared/cue-fallback.wav",
        durationMs: 1000,
      },
    ],
    cards: [
      {
        id: "card-list",
        type: "list",
        states: [
          { id: "state-list-title", title: "今日のポイント", items: [] },
          {
            id: "state-list-item",
            title: "今日のポイント",
            items: [{ id: "item-1", text: "新しい取り組み" }],
            activeItemId: "item-1",
          },
        ],
      },
      {
        id: "card-quote",
        type: "quote",
        states: [{ id: "state-quote", quote: "継続は力なり" }],
      },
    ],
    cardAssets: [],
    materials: [],
    cutIns: [],
    speakers: [],
    commentPolicy: {},
    safety: {
      blockedTopics: [],
      persona: "解説役",
      maxResponseChars: 180,
      maxResponseCues: 2,
      fallbackCueId: "cue-fallback",
    },
    playout: {
      minBufferMs: 10_000,
      maxThinkingMs: 2000,
      closingReserveMs: 120_000,
      noApprovalDelay: true,
    },
  });
}
