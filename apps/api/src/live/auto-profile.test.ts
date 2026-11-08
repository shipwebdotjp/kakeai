import { describe, expect, it } from "vitest";
import {
  contentDocumentSchema,
  type Character,
  type ContentDocument,
} from "@kakeai/contracts";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import { AutoProfileError, buildAutoShowProfile } from "./auto-profile.ts";

const ASSET_KINDS = new Map([
  ["asset-bg", { kind: "image" }],
  ["asset-audio-1", { kind: "audio" }],
  ["asset-bgm", { kind: "audio" }],
  ["asset-video", { kind: "video" }],
]);

function character(id: string, name: string): Character {
  return {
    id,
    name,
    names: [],
    voices: [{ locale: "ja-JP", voiceProfileId: `voice-${id}` }],
    appearances: [
      {
        id: `appearance-${id}`,
        assetId: "asset-bg",
        expression: "normal",
        pose: "standing",
        faceSetId: null,
        faceSetVersion: null,
        libraryAppearanceId: null,
      },
    ],
    libraryCharacterId: null,
  };
}

function line(id: string, speakerId: string | null, caption: string, speech: string) {
  return {
    id,
    speakerId,
    captionText: caption,
    speechText: speech,
    selectedAudioTakeId: null,
    expressionId: null,
  };
}

function contentWithCast(): ContentDocument {
  const content = validContentDocument();
  content.speakers = [
    {
      id: "speaker-left",
      name: "左",
      characterId: "char-left",
      voiceProfileId: "voice-char-left",
    },
    {
      id: "speaker-right",
      name: "右",
      characterId: "char-right",
      voiceProfileId: "voice-char-right",
    },
  ];
  content.characters = [character("char-left", "左キャラ"), character("char-right", "右キャラ")];
  content.scenes[0]!.lines = [
    line("line-intro", "speaker-left", "オープニングです。", "おーぷにんぐです。"),
  ];
  content.scenes[1]!.lines = [
    line("line-p1-1", "speaker-left", "最初の要点です。", "さいしょのようてんです。"),
  ];
  content.scenes[2]!.lines = [
    line("line-p2-1", "speaker-right", "二番目の要点です。", "にばんめのようてんです。"),
  ];
  content.scenes[4]!.lines = [
    line("line-outro", "speaker-left", "終わりです。", "おわりです。"),
  ];
  return contentDocumentSchema.parse(content);
}

function build(content: ContentDocument, includeCommentCorners = true) {
  return buildAutoShowProfile({
    title: "テスト配信",
    content,
    includeCommentCorners,
    assetKindById: ASSET_KINDS,
  });
}

describe("auto Show Profile generation", () => {
  it("builds opening, script, comment, closing, cues, and a linked material", () => {
    const result = build(contentWithCast());
    expect(result.profile.segments.map((segment) => segment.kind)).toEqual([
      "opening",
      "script",
      "comment",
      "script",
      "closing",
    ]);
    expect(result.profile.scriptCues.map((cue) => cue.lineId)).toEqual(
      expect.arrayContaining([
        "line-intro",
        "line-p1-1",
        "line-p2-1",
        "line-outro",
      ]),
    );
    expect(result.profile.liveCues).toHaveLength(0);
    expect(result.profile.materials).toHaveLength(1);
    expect(result.profile.materials[0]?.sceneId).toBe("scene-point-3");
    const lastScript = result.profile.segments.find(
      (segment) => segment.kind === "script" && segment.label === "要点 2",
    );
    expect(lastScript?.material).toBe("material-scene-point-3");
    expect(result.profile.show.characters).toEqual({
      left: "char-left",
      right: "char-right",
    });
    expect(result.summary.characters).toEqual({
      left: "左キャラ",
      right: "右キャラ",
    });
    expect(result.summary.materials[0]?.label).toBe("要点 3");
  });

  it("creates placeholder live cues when intro and outro have no lines", () => {
    const content = contentWithCast();
    content.scenes[0]!.lines = [];
    content.scenes[4]!.lines = [];
    const result = build(content);
    expect(result.profile.liveCues.map((cue) => cue.id)).toEqual([
      "cue-opening-placeholder",
      "cue-closing-placeholder",
    ]);
    expect(result.profile.segments[0]).toMatchObject({
      kind: "opening",
      cues: ["cue-opening-placeholder"],
    });
    const closing = result.profile.segments[result.profile.segments.length - 1];
    expect(closing).toMatchObject({
      kind: "closing",
      cues: ["cue-closing-placeholder"],
    });
    expect(result.profile.safety.fallbackCueId).toBe("cue-closing-placeholder");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("omits comment corners when disabled", () => {
    const result = build(contentWithCast(), false);
    expect(result.profile.segments.some((segment) => segment.kind === "comment")).toBe(
      false,
    );
  });

  it("skips lines without a speaker or with empty text", () => {
    const content = contentWithCast();
    content.scenes[1]!.lines.push(
      line("line-no-speaker", null, "話者なし", "はなしなし"),
      line("line-empty", "speaker-left", "", "から"),
    );
    const result = build(content);
    expect(result.profile.scriptCues.map((cue) => cue.lineId)).not.toContain(
      "line-no-speaker",
    );
    expect(result.profile.scriptCues.map((cue) => cue.lineId)).not.toContain(
      "line-empty",
    );
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("uses only the first two characters and warns about extras", () => {
    const content = contentWithCast();
    content.characters.push(character("char-third", "第三キャラ"));
    content.speakers.push({
      id: "speaker-third",
      name: "第三",
      characterId: "char-third",
      voiceProfileId: "voice-char-third",
    });
    content.scenes[2]!.lines.push(
      line("line-p2-third", "speaker-third", "第三の話者です。", "だいさんのわしゃです。"),
    );
    const result = build(content);
    expect(result.profile.show.characters).toEqual({
      left: "char-left",
      right: "char-right",
    });
    expect(result.profile.scriptCues.map((cue) => cue.lineId)).not.toContain(
      "line-p2-third",
    );
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("fails when no character speaker is usable", () => {
    expect(() => build(validContentDocument())).toThrow(AutoProfileError);
  });

  it("skips empty no-line scenes instead of creating a blank card", () => {
    const content = contentWithCast();
    content.scenes[3]!.visualCues = [];
    const result = build(content);
    expect(result.profile.materials).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("skips material scenes that contain non-image assets", () => {
    const content = contentWithCast();
    const transition = structuredClone(content.scenes[0]!.visualCues[0]!.transition);
    content.scenes[3]!.visualCues.push({
      id: "vc-p3-video",
      template: { id: "media.full-bleed", version: 1 },
      range: { kind: "scene" },
      layer: "background",
      order: 0,
      transition,
      input: { assetId: "asset-video", fit: "cover" },
    });
    const result = build(content);
    expect(result.profile.materials).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
