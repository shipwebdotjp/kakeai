import type {
  LiveCard,
  LiveListCard,
  LiveProgramDocument,
} from "@kakeai/contracts";

export function makeListCard(): LiveListCard {
  return {
    id: "card-1",
    type: "list",
    name: "ポイント",
    animation: {
      enter: { preset: "fade", durationMs: 400, delayMs: 0, staggerMs: 0 },
      update: { preset: "slide-up", durationMs: 300, delayMs: 0, staggerMs: 120 },
    },
    states: [
      {
        id: "state-1",
        title: "今日のポイント",
        items: [{ id: "item-1", text: "ひとつめ" }],
        activeItemId: "item-1",
        ordered: false,
      },
      {
        id: "state-2",
        title: "今日のポイント",
        items: [
          { id: "item-1", text: "ひとつめ" },
          { id: "item-2", text: "ふたつめ" },
        ],
        activeItemId: "item-2",
        ordered: false,
      },
    ],
  };
}

export function makeProgramDocument(): LiveProgramDocument {
  return {
    schemaVersion: 1,
    title: "テスト番組",
    locale: "ja-JP",
    targetDurationMs: 1_800_000,
    stageTemplate: "news-desk",
    theme: { id: "theme-news", version: 1 },
    cast: {
      left: { characterId: "char-left", voiceProfileId: "voice-left" },
      right: null,
    },
    segments: [
      {
        id: "seg-opening",
        kind: "opening",
        label: "オープニング",
        targetDurationMs: 120_000,
        cues: ["cue-opening"],
      },
      {
        id: "seg-script",
        kind: "script",
        label: "ニュース",
        targetDurationMs: 480_000,
        visual: { kind: "card", cardId: "card-1", stateId: "state-1" },
        cues: ["cue-news"],
      },
      {
        id: "seg-cut",
        kind: "cut_in",
        label: "コメントへ",
        cutInId: "cut-1",
      },
      {
        id: "seg-comment",
        kind: "comment",
        label: "コメント",
        targetDurationMs: 300_000,
      },
      {
        id: "seg-closing",
        kind: "closing",
        label: "クロージング",
        targetDurationMs: 120_000,
        cues: ["cue-closing"],
      },
    ],
    cues: [
      {
        id: "cue-opening",
        speaker: "left",
        caption: "始まりました。",
        speech: "はじまりました。",
        expression: "normal",
      },
      {
        id: "cue-news",
        speaker: "left",
        caption: "今日のポイントです。",
        speech: "きょうの ぽいんとです。",
        expression: "smile",
        visual: { kind: "card", cardId: "card-1", stateId: "state-2" },
      },
      {
        id: "cue-closing",
        speaker: "left",
        caption: "ここまでです。",
        speech: "ここまでです。",
        expression: "normal",
      },
      {
        id: "cue-fallback",
        speaker: "left",
        caption: "補足します。",
        speech: "ほそくします。",
        expression: "normal",
      },
    ],
    cards: [makeListCard()],
    materials: [{ id: "mat-1", name: "ニュース図版" }],
    cutIns: [{ id: "cut-1", assetId: "asset-video" }],
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
      persona: "親しみやすい解説。",
      maxResponseChars: 180,
      maxResponseCues: 2,
      fallbackCueId: "cue-fallback",
    },
    playout: {
      minBufferMs: 10_000,
      maxThinkingMs: 2_000,
      closingReserveMs: 120_000,
      noApprovalDelay: true,
    },
  };
}

export function makeCards(): LiveCard[] {
  return [makeListCard()];
}
