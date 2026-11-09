import { describe, expect, it } from "vitest";
import {
  collectLiveProgramAssetReferences,
  liveProgramDocumentSchema,
  validateLiveProgramDocumentForVersion,
  type LiveProgramDocument,
} from "..";

function programDocument(): LiveProgramDocument {
  return liveProgramDocumentSchema.parse({
    schemaVersion: 1,
    title: "テスト配信",
    locale: "ja-JP",
    targetDurationMs: 600_000,
    stageTemplate: "news-desk",
    theme: { id: "theme-1", version: 1 },
    sourceFormat: { formatId: "format-1", formatUpdatedAt: "2026-11-01T00:00:00.000Z" },
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
        visual: { kind: "card", cardId: "card-1", stateId: "state-1" },
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
        caption: "少し補足します。",
        speech: "すこし ほそくします。",
        expression: "normal",
      },
    ],
    cards: [
      {
        id: "card-1",
        type: "headline",
        states: [{ id: "state-1", title: "今日のニュース" }],
      },
    ],
    materials: [{ id: "material-1", name: "図版" }],
    cutIns: [{ id: "cut-in-1", assetId: "asset-video-1" }],
    safety: {
      blockedTopics: [],
      persona: "親しみやすい解説役",
      maxResponseChars: 180,
      maxResponseCues: 2,
      fallbackCueId: "cue-fallback",
    },
  });
}

const versionSchema = liveProgramDocumentSchema.superRefine(
  validateLiveProgramDocumentForVersion,
);

describe("live program contracts", () => {
  it("accepts a draft with an empty spine and applies policy defaults", () => {
    const draft = liveProgramDocumentSchema.parse({
      schemaVersion: 1,
      title: "下書き",
      locale: "ja-JP",
      targetDurationMs: 600_000,
      stageTemplate: "news-desk",
      theme: { id: "theme-1", version: 1 },
      cast: {
        left: { characterId: "char-left", voiceProfileId: "voice-left" },
      },
      segments: [],
      cues: [],
    });
    expect(draft.cast.right).toBeNull();
    expect(draft.segments).toEqual([]);
    expect(draft.commentPolicy.maxCommentsPerCorner).toBe(4);
    expect(draft.playout.minBufferMs).toBe(10_000);
  });

  it("accepts a complete version", () => {
    expect(versionSchema.safeParse(programDocument()).success).toBe(true);
  });

  it("rejects a version without opening, closing or script", () => {
    const doc = programDocument();
    expect(
      versionSchema.safeParse({
        ...doc,
        segments: [],
        cues: doc.cues.filter((cue) => cue.id === "cue-fallback"),
      }).success,
    ).toBe(false);
    expect(
      versionSchema.safeParse({
        ...doc,
        segments: doc.segments.filter((segment) => segment.kind === "script"),
        cues: doc.cues.filter((cue) => cue.id === "cue-script"),
      }).success,
    ).toBe(false);

    expect(
      versionSchema.safeParse({
        ...doc,
        segments: doc.segments.filter((segment) => segment.kind !== "script"),
        cues: doc.cues.filter((cue) => cue.id !== "cue-script"),
      }).success,
    ).toBe(false);
  });

  it("rejects a reused fallback cue and a missing fallback", () => {
    const doc = programDocument();
    expect(
      versionSchema.safeParse({
        ...doc,
        safety: { ...doc.safety!, fallbackCueId: "cue-opening" },
      }).success,
    ).toBe(false);

    expect(
      versionSchema.safeParse({
        ...doc,
        safety: { ...doc.safety!, fallbackCueId: "cue-missing" },
      }).success,
    ).toBe(false);
  });

  it("rejects right speakers when the right cast is null", () => {
    const doc = programDocument();
    expect(
      versionSchema.safeParse({
        ...doc,
        cues: doc.cues.map((cue) =>
          cue.id === "cue-script" ? { ...cue, speaker: "right" } : cue,
        ),
      }).success,
    ).toBe(false);
  });

  it("rejects cut_in at the spine edges and an invalid closing reserve", () => {
    const doc = programDocument();
    expect(
      versionSchema.safeParse({
        ...doc,
        segments: [
          { id: "cut", kind: "cut_in", label: "区切り", cutInId: "cut-in-1" },
          ...doc.segments,
        ],
      }).success,
    ).toBe(false);

    expect(
      versionSchema.safeParse({
        ...doc,
        playout: { ...doc.playout, closingReserveMs: doc.targetDurationMs },
      }).success,
    ).toBe(false);
  });

  it("validates visual references and comment segment overrides", () => {
    const doc = programDocument();
    expect(
      liveProgramDocumentSchema.safeParse({
        ...doc,
        cues: doc.cues.map((cue) =>
          cue.id === "cue-script"
            ? {
                ...cue,
                visual: { kind: "card", cardId: "card-missing", stateId: "state-1" },
              }
            : cue,
        ),
      }).success,
    ).toBe(false);

    expect(
      liveProgramDocumentSchema.safeParse({
        ...doc,
        cues: doc.cues.map((cue) =>
          cue.id === "cue-script"
            ? { ...cue, visual: { kind: "material", materialId: "material-missing" } }
            : cue,
        ),
      }).success,
    ).toBe(false);

    const withComment = liveProgramDocumentSchema.parse({
      ...doc,
      segments: [
        ...doc.segments.slice(0, 2),
        {
          id: "seg-comment",
          kind: "comment",
          label: "コメント",
          targetDurationMs: 120_000,
          commentPolicy: { maxCommentsPerCorner: 2 },
        },
        ...doc.segments.slice(2),
      ],
    });
    const comment = withComment.segments[2];
    expect(comment?.kind).toBe("comment");
    if (comment?.kind === "comment") {
      expect(comment.commentPolicy?.maxCommentsPerCorner).toBe(2);
    }
  });

  it("collects card image, audio and CutIn assets for version resolution", () => {
    const doc = liveProgramDocumentSchema.parse({
      ...programDocument(),
      cards: [
        ...programDocument().cards,
        {
          id: "card-image",
          type: "image",
          states: [{ id: "state-1", assetId: "asset-image" }],
        },
        {
          id: "card-unused",
          type: "image",
          states: [{ id: "state-unused", assetId: "asset-unused" }],
        },
      ],
      cues: programDocument().cues.map((cue) =>
        cue.id === "cue-script"
          ? {
              ...cue,
              audioAssetId: "asset-audio",
              visual: { kind: "card", cardId: "card-image", stateId: "state-1" },
            }
          : cue,
      ),
    });
    // card-unused is not referenced by any visual, so a v2 package omits it
    // and its image asset must not make finalization fail.
    expect(collectLiveProgramAssetReferences(doc)).toEqual({
      cardImageAssetIds: ["asset-image"],
      audioAssetIds: ["asset-audio"],
      cutInAssetIds: ["asset-video-1"],
    });
  });

  it("rejects duplicate ids and an unsupported stage template", () => {
    const doc = programDocument();
    expect(
      liveProgramDocumentSchema.safeParse({
        ...doc,
        cues: [...doc.cues, doc.cues[0]!],
      }).success,
    ).toBe(false);

    expect(
      liveProgramDocumentSchema.safeParse({
        ...doc,
        stageTemplate: "studio",
      }).success,
    ).toBe(false);

    expect(
      liveProgramDocumentSchema.safeParse({
        ...doc,
        segments: doc.segments.map((segment) =>
          segment.kind === "script"
            ? { ...segment, cues: ["cue-script", "cue-script"] }
            : segment,
        ),
      }).success,
    ).toBe(false);
  });
});
