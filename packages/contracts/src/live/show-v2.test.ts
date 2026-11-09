import { describe, expect, it } from "vitest";
import {
  collectReferencedLiveCardAssetIds,
  collectReferencedLiveCards,
  liveExportRequestSchema,
  livePackageShowSchema,
  liveProgramDocumentSchema,
  type LivePackageShow,
} from "..";

function speaker() {
  return {
    id: "char-left",
    name: "左キャラ",
    side: "left" as const,
    characterId: "char-left",
    voice: {
      adapterId: "voicevox" as const,
      voiceId: "voice-1",
      speedScale: 1,
      settings: {},
    },
  };
}

function packageShow(): LivePackageShow {
  return livePackageShowSchema.parse({
    schemaVersion: 2,
    show: {
      title: "テスト配信",
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
        cues: ["cue-script"],
        visual: { kind: "card", cardId: "card-list", stateId: "state-list" },
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
        audio: "audio/prepared/cue-0001.wav",
        durationMs: 1000,
      },
      {
        id: "cue-script",
        origin: "live",
        speaker: "left",
        caption: "本編です。",
        speech: "ほんぺんです。",
        expression: "normal",
        visual: { kind: "card", cardId: "card-image", stateId: "state-image" },
        audio: "audio/prepared/cue-0002.wav",
        durationMs: 1200,
      },
      {
        id: "cue-closing",
        origin: "live",
        speaker: "left",
        caption: "終わります。",
        speech: "おわります。",
        expression: "normal",
        audio: "audio/prepared/cue-0003.wav",
        durationMs: 900,
      },
      {
        id: "cue-fallback",
        origin: "live",
        speaker: "left",
        caption: "少し補足します。",
        speech: "すこし ほそくします。",
        expression: "normal",
        audio: "audio/prepared/cue-0004.wav",
        durationMs: 1000,
      },
    ],
    cards: [
      {
        id: "card-list",
        type: "list",
        states: [{ id: "state-list", title: "ポイント", items: [] }],
      },
      {
        id: "card-image",
        type: "image",
        states: [{ id: "state-image", assetId: "asset-image" }],
      },
      {
        id: "card-unused",
        type: "headline",
        states: [{ id: "state-unused", title: "未使用" }],
      },
    ],
    cardAssets: [
      {
        id: "asset-image",
        file: "cards/asset-image.png",
        mediaType: "image/png",
        width: 32,
        height: 18,
      },
      {
        id: "asset-unused",
        file: "cards/asset-unused.png",
        mediaType: "image/png",
        width: 32,
        height: 18,
      },
    ],
    materials: [],
    cutIns: [],
    speakers: [speaker()],
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

describe("live package show v2", () => {
  it("accepts only the program-version export request", () => {
    expect(
      liveExportRequestSchema.safeParse({
        programVersionId: "program-version-1",
        outDir: "/tmp/kakeai/package",
      }).success,
    ).toBe(true);
    expect(
      liveExportRequestSchema.safeParse({
        programVersionId: "program-version-1",
        workId: "work-1",
        outDir: "/tmp/kakeai/package",
      }).success,
    ).toBe(false);
    expect(
      liveExportRequestSchema.safeParse({
        workId: "work-1",
        scriptVersionId: "script-version-1",
        profile: {},
        outDir: "/tmp/kakeai/package",
      }).success,
    ).toBe(false);
  });

  it("accepts typed cards, card assets and visuals", () => {
    const show = packageShow();
    expect(show.schemaVersion).toBe(2);
    expect(show.cards.find((card) => card.id === "card-image")).toBeDefined();
    expect(show.cardAssets.map((asset) => asset.id)).toContain("asset-image");
  });

  it("rejects card and visual content in a v1 show", () => {
    const show = packageShow();
    expect(
      livePackageShowSchema.safeParse({ ...show, schemaVersion: 1 }).success,
    ).toBe(false);
  });

  it("keeps comment source, fixture and startAt out of v2 packages", () => {
    const show = packageShow();
    expect(
      livePackageShowSchema.safeParse({
        ...show,
        show: { ...show.show, startAt: null },
      }).success,
    ).toBe(false);
    expect(
      livePackageShowSchema.safeParse({
        ...show,
        commentSource: { kind: "youtube" },
      }).success,
    ).toBe(false);
    expect(
      livePackageShowSchema.safeParse({
        ...show,
        test: { fixture: "fixtures/comments.json" },
      }).success,
    ).toBe(false);
  });

  it("rejects legacy material references in v2", () => {
    const show = packageShow();
    expect(
      livePackageShowSchema.safeParse({
        ...show,
        cues: show.cues.map((cue) =>
          cue.id === "cue-script" ? { ...cue, materialId: "material-1" } : cue,
        ),
        materials: [
          {
            id: "material-1",
            kind: "image",
            file: "materials/card-0001.png",
            hasAudio: false,
            focus: true,
            width: 1920,
            height: 1080,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      livePackageShowSchema.safeParse({
        ...show,
        segments: show.segments.map((segment) =>
          segment.id === "seg-script" ? { ...segment, material: "material-1" } : segment,
        ),
      }).success,
    ).toBe(false);
  });

  it("rejects unresolved visuals and missing card image assets", () => {
    const show = packageShow();
    expect(
      livePackageShowSchema.safeParse({
        ...show,
        cues: show.cues.map((cue) =>
          cue.id === "cue-script"
            ? {
                ...cue,
                visual: { kind: "card", cardId: "card-missing", stateId: "state-missing" },
              }
            : cue,
        ),
      }).success,
    ).toBe(false);
    expect(
      livePackageShowSchema.safeParse({
        ...show,
        cues: show.cues.map((cue) =>
          cue.id === "cue-script"
            ? { ...cue, visual: { kind: "material", materialId: "material-missing" } }
            : cue,
        ),
      }).success,
    ).toBe(false);
    expect(
      livePackageShowSchema.safeParse({ ...show, cardAssets: [] }).success,
    ).toBe(false);
  });

  it("rejects missing spine sections, bad cut_in placement, fallback reuse and reserve", () => {
    const show = packageShow();
    const without = (kind: string) => show.segments.filter((segment) => segment.kind !== kind);
    expect(livePackageShowSchema.safeParse({ ...show, segments: without("opening") }).success).toBe(
      false,
    );
    expect(livePackageShowSchema.safeParse({ ...show, segments: without("closing") }).success).toBe(
      false,
    );
    expect(livePackageShowSchema.safeParse({ ...show, segments: without("script") }).success).toBe(
      false,
    );
    expect(
      livePackageShowSchema.safeParse({
        ...show,
        segments: [
          { id: "cut", kind: "cut_in", label: "区切り", cutInId: "cut-in-1" },
          ...show.segments,
        ],
        cutIns: [
          {
            id: "cut-in-1",
            file: "media/assets/cut.mp4",
            durationMs: 2000,
            hasAudio: false,
            width: 1920,
            height: 1080,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      livePackageShowSchema.safeParse({
        ...show,
        safety: { ...show.safety, fallbackCueId: "cue-opening" },
      }).success,
    ).toBe(false);
    expect(
      livePackageShowSchema.safeParse({
        ...show,
        cues: show.cues.map((cue) =>
          cue.id === "cue-script" ? { ...cue, speaker: "right" } : cue,
        ),
      }).success,
    ).toBe(false);
    expect(
      livePackageShowSchema.safeParse({
        ...show,
        playout: { ...show.playout, closingReserveMs: show.show.targetDurationMs },
      }).success,
    ).toBe(false);
  });

  it("collects only cards and image assets referenced by visuals", () => {
    const document = liveProgramDocumentSchema.parse({
      schemaVersion: 1,
      title: "テスト",
      locale: "ja-JP",
      targetDurationMs: 600_000,
      stageTemplate: "news-desk",
      theme: { id: "soft-editorial", version: 1 },
      cast: {
        left: { characterId: "char-left", voiceProfileId: "voice-left" },
        right: null,
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
          cues: ["cue-script"],
          visual: { kind: "card", cardId: "card-list", stateId: "state-list" },
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
          speaker: "left",
          caption: "始まります。",
          speech: "はじまります。",
          expression: "normal",
        },
        {
          id: "cue-script",
          speaker: "left",
          caption: "本編です。",
          speech: "ほんぺんです。",
          expression: "normal",
          visual: { kind: "card", cardId: "card-image", stateId: "state-image" },
        },
        {
          id: "cue-closing",
          speaker: "left",
          caption: "終わります。",
          speech: "おわります。",
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
      cards: [
        {
          id: "card-list",
          type: "list",
          states: [{ id: "state-list", title: "ポイント", items: [] }],
        },
        {
          id: "card-image",
          type: "image",
          states: [
            { id: "state-image", assetId: "asset-image" },
            { id: "state-image-2", assetId: "asset-image-2" },
          ],
        },
        {
          id: "card-unused",
          type: "image",
          states: [{ id: "state-unused", assetId: "asset-unused" }],
        },
      ],
      safety: {
        blockedTopics: [],
        persona: "解説役",
        maxResponseChars: 180,
        maxResponseCues: 2,
        fallbackCueId: "cue-fallback",
      },
    });
    expect(collectReferencedLiveCards(document).map((card) => card.id)).toEqual([
      "card-list",
      "card-image",
    ]);
    expect(collectReferencedLiveCardAssetIds(document)).toEqual([
      "asset-image",
      "asset-image-2",
    ]);
  });
});
