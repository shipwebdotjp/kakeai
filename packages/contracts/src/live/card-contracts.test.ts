import { describe, expect, it } from "vitest";
import {
  liveCardSchema,
  livePackageShowSchema,
  resolveLiveCardState,
  type LiveCard,
} from "..";

function headlineCard(): LiveCard {
  return liveCardSchema.parse({
    id: "card-headline",
    type: "headline",
    states: [{ id: "state-1", title: "今日のニュース" }],
  });
}

function packageShow() {
  return {
    schemaVersion: 2,
    show: {
      title: "テスト配信",
      locale: "ja-JP",
      targetDurationMs: 600_000,
      stageTemplate: "news-desk",
      characters: { left: "char-left", right: null },
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
        id: "cue-script",
        origin: "live",
        speaker: "left",
        caption: "本編です。",
        speech: "ほんぺんです。",
        expression: "normal",
        visual: { kind: "card", cardId: "card-headline", stateId: "state-1" },
        audio: "audio/prepared/cue-script.wav",
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
        caption: "少し補足します。",
        speech: "すこし ほそくします。",
        expression: "normal",
        audio: "audio/prepared/cue-fallback.wav",
        durationMs: 1000,
      },
    ],
    cards: [headlineCard()],
    cardAssets: [],
    materials: [],
    cutIns: [],
    speakers: [
      {
        id: "speaker-left",
        name: "左",
        side: "left",
        characterId: "char-left",
        voice: {
          adapterId: "voicevox",
          voiceId: "voice-1",
          speedScale: 1,
          settings: {},
        },
      },
    ],
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
      persona: "親しみやすい解説役",
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

describe("live card contracts", () => {
  it("applies headline defaults and resolves card states", () => {
    const card = headlineCard();
    expect(card.type).toBe("headline");
    expect(card.animation.enter.preset).toBe("fade");
    expect(card.animation.update.durationMs).toBe(300);
    if (card.type !== "headline") {
      throw new Error("expected a headline card");
    }
    expect(card.states[0]?.align).toBe("center");
    expect(card.states[0]?.tone).toBe("primary");

    const resolved = resolveLiveCardState([card], {
      cardId: "card-headline",
      stateId: "state-1",
    });
    expect(resolved?.card.id).toBe("card-headline");
    expect(resolveLiveCardState([card], { cardId: "missing", stateId: "state-1" })).toBeNull();
    expect(
      resolveLiveCardState([card], { cardId: "card-headline", stateId: "missing" }),
    ).toBeNull();
  });

  it("rejects duplicate card state ids", () => {
    const result = liveCardSchema.safeParse({
      id: "card-1",
      type: "headline",
      states: [
        { id: "state-1", title: "A" },
        { id: "state-1", title: "B" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("validates list snapshots and active items", () => {
    const valid = liveCardSchema.safeParse({
      id: "card-list",
      type: "list",
      states: [
        {
          id: "state-1",
          title: "ポイント",
          items: [
            { id: "item-1", text: "一つ目" },
            { id: "item-2", text: "二つ目" },
          ],
          activeItemId: "item-2",
        },
      ],
    });
    expect(valid.success).toBe(true);

    const duplicateItem = liveCardSchema.safeParse({
      id: "card-list",
      type: "list",
      states: [
        {
          id: "state-1",
          items: [
            { id: "item-1", text: "一つ目" },
            { id: "item-1", text: "二つ目" },
          ],
        },
      ],
    });
    expect(duplicateItem.success).toBe(false);

    const missingActive = liveCardSchema.safeParse({
      id: "card-list",
      type: "list",
      states: [
        {
          id: "state-1",
          items: [{ id: "item-1", text: "一つ目" }],
          activeItemId: "item-missing",
        },
      ],
    });
    expect(missingActive.success).toBe(false);
  });

  it("validates chart categories, values and highlights", () => {
    const valid = liveCardSchema.safeParse({
      id: "card-chart",
      type: "chart",
      variant: "bar",
      states: [
        {
          id: "state-1",
          categories: [
            { key: "q1", label: "Q1" },
            { key: "q2", label: "Q2" },
          ],
          series: [
            {
              key: "sales",
              label: "売上",
              values: { q1: 10, q2: 20 },
            },
          ],
          highlight: { seriesKeys: ["sales"], categoryKeys: ["q2"] },
        },
      ],
    });
    expect(valid.success).toBe(true);

    const missingValue = liveCardSchema.safeParse({
      id: "card-chart",
      type: "chart",
      variant: "line",
      states: [
        {
          id: "state-1",
          categories: [
            { key: "q1", label: "Q1" },
            { key: "q2", label: "Q2" },
          ],
          series: [{ key: "sales", label: "売上", values: { q1: 10 } }],
        },
      ],
    });
    expect(missingValue.success).toBe(false);

    const unknownHighlight = liveCardSchema.safeParse({
      id: "card-chart",
      type: "chart",
      variant: "bar",
      states: [
        {
          id: "state-1",
          categories: [{ key: "q1", label: "Q1" }],
          series: [{ key: "sales", label: "売上", values: { q1: 10 } }],
          highlight: { categoryKeys: ["missing"] },
        },
      ],
    });
    expect(unknownHighlight.success).toBe(false);
  });

  it("validates image card assets in a package show", () => {
    const show = packageShow();
    const imageCard = liveCardSchema.parse({
      id: "card-image",
      type: "image",
      states: [{ id: "state-1", assetId: "asset-1", caption: "図版" }],
    });
    const withImage = {
      ...show,
      cards: [...show.cards, imageCard],
      cardAssets: [
        {
          id: "asset-1",
          file: "cards/asset-1.png",
          mediaType: "image/png",
          width: 1920,
          height: 1080,
        },
      ],
    };
    expect(livePackageShowSchema.safeParse(withImage).success).toBe(true);
    expect(
      livePackageShowSchema.safeParse({ ...withImage, cardAssets: [] }).success,
    ).toBe(false);
  });

  it("requires package schema version 2 when cards or visual are present", () => {
    const show = packageShow();
    expect(livePackageShowSchema.safeParse({ ...show, schemaVersion: 1 }).success).toBe(false);

    const legacyMaterial = {
      ...show,
      cues: show.cues.map((cue) => ({ ...cue, materialId: "material-1" })),
    };
    expect(livePackageShowSchema.safeParse(legacyMaterial).success).toBe(false);
  });

  it("rejects unknown card and state references in a package show", () => {
    const show = packageShow();
    expect(livePackageShowSchema.safeParse(show).success).toBe(true);

    const unknownCard = {
      ...show,
      cues: show.cues.map((cue) =>
        cue.id === "cue-script"
          ? { ...cue, visual: { kind: "card", cardId: "missing", stateId: "state-1" } }
          : cue,
      ),
    };
    expect(livePackageShowSchema.safeParse(unknownCard).success).toBe(false);

    const unknownState = {
      ...show,
      cues: show.cues.map((cue) =>
        cue.id === "cue-script"
          ? { ...cue, visual: { kind: "card", cardId: "card-headline", stateId: "missing" } }
          : cue,
      ),
    };
    expect(livePackageShowSchema.safeParse(unknownState).success).toBe(false);
  });

  it("accepts segment default visuals and null cue overrides", () => {
    const show = packageShow();
    const withSegmentVisual = {
      ...show,
      segments: show.segments.map((segment) =>
        segment.kind === "script"
          ? {
              ...segment,
              visual: { kind: "card", cardId: "card-headline", stateId: "state-1" },
            }
          : segment,
      ),
      cues: show.cues.map((cue) => ({ ...cue, visual: null })),
    };
    expect(livePackageShowSchema.safeParse(withSegmentVisual).success).toBe(true);

    const missingSegmentState = {
      ...withSegmentVisual,
      segments: withSegmentVisual.segments.map((segment) =>
        segment.kind === "script"
          ? {
              ...segment,
              visual: { kind: "card", cardId: "card-headline", stateId: "missing" },
            }
          : segment,
      ),
    };
    expect(livePackageShowSchema.safeParse(missingSegmentState).success).toBe(false);
  });

  it("validates the v2 spine and dedicated fallback cue", () => {
    const show = packageShow();
    expect(livePackageShowSchema.safeParse(show).success).toBe(true);

    const withoutOpening = {
      ...show,
      segments: show.segments.filter((segment) => segment.kind !== "opening"),
      cues: show.cues.filter((cue) => cue.id !== "cue-opening"),
    };
    expect(livePackageShowSchema.safeParse(withoutOpening).success).toBe(false);

    const reusedFallback = {
      ...show,
      safety: { ...show.safety, fallbackCueId: "cue-opening" },
    };
    expect(livePackageShowSchema.safeParse(reusedFallback).success).toBe(false);

    const wrongStage = {
      ...show,
      show: { ...show.show, stageTemplate: "studio" },
    };
    expect(livePackageShowSchema.safeParse(wrongStage).success).toBe(false);

    const reserveTooLarge = {
      ...show,
      playout: { ...show.playout, closingReserveMs: show.show.targetDurationMs },
    };
    expect(livePackageShowSchema.safeParse(reserveTooLarge).success).toBe(false);
  });

  it("rejects animation durations beyond the card contract", () => {
    const result = liveCardSchema.safeParse({
      id: "card-1",
      type: "headline",
      animation: {
        enter: { preset: "fade", durationMs: 6_000 },
      },
      states: [{ id: "state-1", title: "A" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts quote and chart cards with their type-specific fields", () => {
    const quote = liveCardSchema.safeParse({
      id: "card-quote",
      type: "quote",
      states: [{ id: "state-1", quote: "測れるものしか改善できない", author: "Drucker" }],
    });
    expect(quote.success).toBe(true);

    const line = liveCardSchema.safeParse({
      id: "card-line",
      type: "chart",
      variant: "line",
      chartAnimation: "draw",
      states: [
        {
          id: "state-1",
          categories: [{ key: "a", label: "A" }],
          series: [{ key: "s", label: "S", values: { a: 1 } }],
        },
      ],
    });
    expect(line.success).toBe(true);
  });
});
