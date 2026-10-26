import { describe, expect, it } from "vitest";
import {
  contentDocumentSchema,
  createInitialContentDocument,
  DEFAULT_SCENE_IDS,
  type ContentDocument,
  type PointScene,
} from "@kakeai/contracts";
import { applyScriptOperation, applyScriptOperations } from "./apply.ts";
import { ScriptEditError } from "./errors.ts";
import { createTestContext } from "./testing.ts";

function pointScene(document: ContentDocument): PointScene {
  const scene = document.scenes.find((entry) => entry.id === DEFAULT_SCENE_IDS.point1);
  if (scene === undefined || scene.kind !== "point") {
    throw new Error("要点Sceneがありません。");
  }
  return scene;
}

function documentWithCharacter(voices: ContentDocument["characters"][number]["voices"]): {
  document: ContentDocument;
  point: PointScene;
  lineId: string;
} {
  const document = createInitialContentDocument();
  document.characters = [
    {
      id: "char-1",
      name: "リン",
      names: [],
      voices,
      appearances: [],
      libraryCharacterId: null,
    },
  ];
  document.speakers = [
    {
      id: "speaker-char",
      name: "リン",
      characterId: "char-1",
      voiceProfileId:
        voices.find((voice) => voice.locale === document.locale)?.voiceProfileId ?? null,
    },
  ];
  const point = pointScene(document);
  if (point.lines.length === 0) {
    point.lines = [
      {
        id: "line-char",
        speakerId: null,
        captionText: "",
        speechText: "",
        selectedAudioTakeId: null,
        expressionId: null,
      },
    ];
  }
  point.lines[0]!.speakerId = "speaker-char";
  point.lines[0]!.expressionId = "smile";
  return { document, point, lineId: point.lines[0]!.id };
}

const context = () =>
  createTestContext(
    {},
    {
      voiceProfiles: {
        "vp-ja": "ja-JP",
        "vp-ja-2": "ja-JP",
        "vp-en": "en-US",
      },
    },
  );

function expectEditError(callback: () => unknown, code: ScriptEditError["code"]): void {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(ScriptEditError);
    expect((error as ScriptEditError).code).toBe(code);
    return;
  }
  throw new Error(`エラーが発生しませんでした: ${code}`);
}

describe("speaker operations", () => {
  it("adds a voice-only speaker with a new ID and reports it in created.speakerIds", () => {
    const document = createInitialContentDocument();
    const result = applyScriptOperation(
      document,
      {
        op: "speaker.add",
        key: "narration",
        name: "ナレーター",
        voiceProfileId: "vp-ja",
      },
      context(),
    );

    expect(result.document.speakers).toEqual([
      {
        id: "speaker-new-1",
        name: "ナレーター",
        characterId: null,
        voiceProfileId: "vp-ja",
      },
    ]);
    expect(result.created.speakerIds).toEqual(["speaker-new-1"]);
    expect(contentDocumentSchema.safeParse(result.document).success).toBe(true);
  });

  it("rejects a missing profile, a locale mismatch, and a missing lookup", () => {
    const document = createInitialContentDocument();
    expectEditError(
      () =>
        applyScriptOperation(
          document,
          { op: "speaker.add", name: "N", voiceProfileId: "missing" },
          context(),
        ),
      "EDIT_TARGET_NOT_FOUND",
    );
    expectEditError(
      () =>
        applyScriptOperation(
          document,
          { op: "speaker.add", name: "N", voiceProfileId: "vp-en" },
          context(),
        ),
      "EDIT_PRECONDITION_FAILED",
    );
    expectEditError(
      () =>
        applyScriptOperation(
          document,
          { op: "speaker.add", name: "N", voiceProfileId: "vp-ja" },
          { assets: { get: () => null }, ids: createTestContext().ids },
        ),
      "EDIT_PRECONDITION_FAILED",
    );
  });

  it("assigns and clears a voice on a voice-only speaker", () => {
    const document = createInitialContentDocument();
    document.speakers = [
      {
        id: "speaker-narrator",
        name: "ナレーター",
        characterId: null,
        voiceProfileId: "vp-ja",
      },
    ];

    const changed = applyScriptOperation(
      document,
      {
        op: "speaker.setVoiceProfile",
        speakerId: "speaker-narrator",
        voiceProfileId: "vp-ja-2",
      },
      context(),
    );
    expect(changed.document.speakers[0]?.voiceProfileId).toBe("vp-ja-2");

    const cleared = applyScriptOperation(
      changed.document,
      {
        op: "speaker.setVoiceProfile",
        speakerId: "speaker-narrator",
        voiceProfileId: null,
      },
      context(),
    );
    expect(cleared.document.speakers[0]?.voiceProfileId).toBeNull();
  });

  it("changes a keyed speaker's voice in the same edit", () => {
    const document = createInitialContentDocument();
    const result = applyScriptOperations(
      document,
      [
        {
          op: "speaker.add",
          key: "narration",
          name: "ナレーター",
          voiceProfileId: "vp-ja",
        },
        {
          op: "speaker.setVoiceProfile",
          speakerId: { key: "narration" },
          voiceProfileId: "vp-ja-2",
        },
      ],
      context(),
    );
    expect(result.document.speakers[0]?.voiceProfileId).toBe("vp-ja-2");
  });

  it("requires a Character-linked speaker to keep the Character Voice", () => {
    const { document } = documentWithCharacter([
      { locale: "ja-JP", voiceProfileId: "vp-ja" },
    ]);

    const same = applyScriptOperation(
      document,
      {
        op: "speaker.setVoiceProfile",
        speakerId: "speaker-char",
        voiceProfileId: "vp-ja",
      },
      context(),
    );
    expect(same.document.speakers[0]?.voiceProfileId).toBe("vp-ja");

    expectEditError(
      () =>
        applyScriptOperation(
          document,
          {
            op: "speaker.setVoiceProfile",
            speakerId: "speaker-char",
            voiceProfileId: "vp-ja-2",
          },
          context(),
        ),
      "EDIT_PRECONDITION_FAILED",
    );
    expectEditError(
      () =>
        applyScriptOperation(
          document,
          {
            op: "speaker.setVoiceProfile",
            speakerId: "speaker-char",
            voiceProfileId: null,
          },
          context(),
        ),
      "EDIT_PRECONDITION_FAILED",
    );
  });

  it("rejects assigning a voice when the Character has no locale Voice", () => {
    const { document } = documentWithCharacter([]);
    expectEditError(
      () =>
        applyScriptOperation(
          document,
          {
            op: "speaker.setVoiceProfile",
            speakerId: "speaker-char",
            voiceProfileId: "vp-ja",
          },
          context(),
        ),
      "EDIT_PRECONDITION_FAILED",
    );

    const cleared = applyScriptOperation(
      document,
      {
        op: "speaker.setVoiceProfile",
        speakerId: "speaker-char",
        voiceProfileId: null,
      },
      context(),
    );
    expect(cleared.document.speakers[0]?.voiceProfileId).toBeNull();
  });

  it("rejects an unknown speaker", () => {
    const document = createInitialContentDocument();
    expectEditError(
      () =>
        applyScriptOperation(
          document,
          {
            op: "speaker.setVoiceProfile",
            speakerId: "missing",
            voiceProfileId: "vp-ja",
          },
          context(),
        ),
      "EDIT_TARGET_NOT_FOUND",
    );
  });

  it("assigns a keyed narrator to a line and clears the expression", () => {
    const { document, point, lineId } = documentWithCharacter([
      { locale: "ja-JP", voiceProfileId: "vp-ja" },
    ]);
    const result = applyScriptOperations(
      document,
      [
        {
          op: "speaker.add",
          key: "narration",
          name: "ナレーター",
          voiceProfileId: "vp-ja-2",
        },
        {
          op: "line.setSpeaker",
          sceneId: point.id,
          lineId,
          speakerId: { key: "narration" },
        },
      ],
      context(),
    );

    const line = pointScene(result.document).lines[0]!;
    expect(line.speakerId).toBe("speaker-new-1");
    expect(line.expressionId).toBeNull();
    expect(result.created.speakerIds).toEqual(["speaker-new-1"]);
    expect(contentDocumentSchema.safeParse(result.document).success).toBe(true);
  });

  it("creates a keyed narrator line in the same edit", () => {
    const document = createInitialContentDocument();
    const point = pointScene(document);
    const result = applyScriptOperations(
      document,
      [
        {
          op: "speaker.add",
          key: "narration",
          name: "ナレーター",
          voiceProfileId: "vp-ja",
        },
        {
          op: "line.add",
          key: "line-a",
          sceneId: point.id,
          captionText: "こんにちは",
          speechText: "こんにちは",
          speakerId: { key: "narration" },
        },
      ],
      context(),
    );
    const added = pointScene(result.document).lines.at(-1)!;
    expect(added.id).toBe(result.created.lineIds[0]);
    expect(added.speakerId).toBe("speaker-new-1");
    expect(added.expressionId).toBeNull();
  });

  it("rejects an explicit expression on a voice-only speaker line", () => {
    const document = createInitialContentDocument();
    document.speakers = [
      {
        id: "speaker-narrator",
        name: "ナレーター",
        characterId: null,
        voiceProfileId: "vp-ja",
      },
    ];
    const point = pointScene(document);
    expectEditError(
      () =>
        applyScriptOperation(
          document,
          {
            op: "line.add",
            sceneId: point.id,
            captionText: "a",
            speakerId: "speaker-narrator",
            expressionId: "smile",
          },
          context(),
        ),
      "EDIT_INVALID_INPUT",
    );
  });

  it("rejects line.setExpression on a voice-only speaker", () => {
    const document = createInitialContentDocument();
    document.speakers = [
      {
        id: "speaker-narrator",
        name: "ナレーター",
        characterId: null,
        voiceProfileId: "vp-ja",
      },
    ];
    const point = pointScene(document);
    const added = applyScriptOperation(
      document,
      {
        op: "line.add",
        sceneId: point.id,
        captionText: "a",
        speakerId: "speaker-narrator",
      },
      context(),
    );
    expectEditError(
      () =>
        applyScriptOperation(
          added.document,
          {
            op: "line.setExpression",
            sceneId: point.id,
            lineId: added.created.lineIds[0]!,
            expressionId: "smile",
          },
          context(),
        ),
      "EDIT_PRECONDITION_FAILED",
    );
  });

  it("applies the same speaker checks to scene.add initial lines", () => {
    const document = createInitialContentDocument();
    document.speakers = [
      {
        id: "speaker-narrator",
        name: "ナレーター",
        characterId: null,
        voiceProfileId: "vp-ja",
      },
    ];
    expectEditError(
      () =>
        applyScriptOperation(
          document,
          {
            op: "scene.add",
            kind: "point",
            lines: [{ speakerId: "speaker-narrator", expressionId: "smile" }],
          },
          context(),
        ),
      "EDIT_INVALID_INPUT",
    );
    expectEditError(
      () =>
        applyScriptOperation(
          document,
          {
            op: "scene.add",
            kind: "point",
            lines: [{ speakerId: "missing" }],
          },
          context(),
        ),
      "EDIT_TARGET_NOT_FOUND",
    );
  });

  it("rejects an unknown speaker on line.add and line.setSpeaker", () => {
    const document = createInitialContentDocument();
    const point = pointScene(document);
    expectEditError(
      () =>
        applyScriptOperation(
          document,
          {
            op: "line.add",
            sceneId: point.id,
            captionText: "a",
            speakerId: "missing",
          },
          context(),
        ),
      "EDIT_TARGET_NOT_FOUND",
    );

    const added = applyScriptOperation(
      document,
      { op: "line.add", sceneId: point.id, captionText: "a" },
      context(),
    );
    expectEditError(
      () =>
        applyScriptOperation(
          added.document,
          {
            op: "line.setSpeaker",
            sceneId: point.id,
            lineId: added.created.lineIds[0]!,
            speakerId: "missing",
          },
          context(),
        ),
      "EDIT_TARGET_NOT_FOUND",
    );
  });

  it("does not change existing Audio Takes when the voice changes", () => {
    const { document } = documentWithCharacter([
      { locale: "ja-JP", voiceProfileId: "vp-ja" },
    ]);
    const lineId = pointScene(document).lines[0]!.id;
    document.audioTakes = [
      {
        id: "take-1",
        narrationSegmentId: lineId,
        source: "tts",
        assetId: "asset-audio",
        durationMs: 1000,
      },
    ];
    pointScene(document).lines[0]!.selectedAudioTakeId = "take-1";

    const result = applyScriptOperation(
      document,
      {
        op: "speaker.setVoiceProfile",
        speakerId: "speaker-char",
        voiceProfileId: "vp-ja",
      },
      context(),
    );
    expect(result.document.audioTakes).toEqual(document.audioTakes);
    expect(pointScene(result.document).lines[0]!.selectedAudioTakeId).toBe("take-1");
  });
});
