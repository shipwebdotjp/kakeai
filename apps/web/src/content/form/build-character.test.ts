import { describe, expect, it } from "vitest";
import {
  contentDocumentSchema,
  createInitialContentDocument,
  createPointScene,
  type Composition,
  type ContentDocument,
  type PointScene,
  type VisualCue,
} from "@kakeai/contracts";
import {
  buildContentDocument,
  cloneSceneFormValue,
  collectLineIds,
  collectSceneIds,
  compositionVersionOptions,
  countAppearanceReferences,
  countCharacterReferences,
  createCueFormValue,
  createEmptyLine,
  createInsertSceneFormValue,
  createPointSceneFormValue,
  defaultOffsetEndMs,
  defaultVideoGate,
  duplicateCueFormValue,
  initialVideoGateLineId,
  newSceneId,
  pruneDraftCueForLines,
  toFormValues,
  NESTED_COMPOSITION_FIT_SUFFIX,
  NESTED_COMPOSITION_POS_X_SUFFIX,
  NESTED_COMPOSITION_POS_Y_SUFFIX,
  NESTED_COMPOSITION_VERSION_SUFFIX,
  NESTED_COMPOSITION_ZOOM_SUFFIX,
  NESTED_MODE_COMPOSITION,
  NESTED_MODE_SUFFIX,
  type LineFormValue,
  type SceneFormValue,
} from "../form";
import { transition, vc, pointScenes, sceneTextCue, setSceneText, readSceneText, standingInput, standingCue } from "./test-helpers";

describe("buildContentDocument", () => {

  it("round-trips characters and a scene standing cue", () => {
    const base = createInitialContentDocument();
    base.characters = [
      {
        id: "character-rin",
        name: "リン",
        names: [],
        voices: [],
        libraryCharacterId: null,
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null, faceSetVersion: null, libraryAppearanceId: null },
        ],
      },
    ];
    base.scenes[1]!.visualCues = [standingCue("vc-standing", "right")];

    const values = toFormValues(base);
    expect(values.characters).toEqual([
      {
        id: "character-rin",
        name: "リン",
        names: [],
        voiceProfileId: null,
        voices: [],
        libraryCharacterId: null,
        appearances: [
          {
            id: "appearance-smile",
            assetId: "asset-rin",
            expression: "smile",
            pose: "front",
            label: "",
            faceSetId: null, faceSetVersion: null, libraryAppearanceId: null,
          },
        ],
      },
    ]);
    const target = values.scenes[1]!;
    expect(target.cues).toEqual([]);
    expect(target.standings).toEqual([
      {
        cueId: null,
        characterId: null,
        appearanceId: null,
        side: "left",
        scale: 1,
        edge: "margin",
        vertical: "standard",
        enterPreset: "none",
        enterDurationMs: 0,
        exitPreset: "none",
        exitDurationMs: 0,
      },
      {
        cueId: "vc-standing",
        characterId: "character-rin",
        appearanceId: "appearance-smile",
        side: "right",
        scale: 1,
        edge: "margin",
        vertical: "standard",
        enterPreset: "fade",
        enterDurationMs: 350,
        exitPreset: "none",
        exitDurationMs: 0,
      },
    ]);

    const rebuilt = buildContentDocument(base, values);
    const cue = rebuilt.scenes[1]!.visualCues[0]!;
    expect(cue.id).toBe("vc-standing");
    expect(cue.template).toEqual({ id: "character.standing", version: 1 });
    expect(standingInput(cue)).toEqual({
      characterId: "character-rin",
      appearanceId: "appearance-smile",
      side: "right",
      scale: 1,
      edge: "margin",
      vertical: "standard",
    });
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("always exposes left and right standing slots", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    for (const scene of values.scenes) {
      expect(scene.standings.map((standing) => standing.side)).toEqual(["left", "right"]);
      expect(
        scene.standings.every(
          (standing) =>
            standing.cueId === null &&
            standing.characterId === null &&
            standing.appearanceId === null,
        ),
      ).toBe(true);
    }
  });

  it("adds a standing cue with the default position and scale", () => {
    const base = createInitialContentDocument();
    base.characters = [
      {
        id: "character-rin",
        name: "リン",
        names: [],
        voices: [],
        libraryCharacterId: null,
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null, faceSetVersion: null, libraryAppearanceId: null },
        ],
      },
    ];

    const values = toFormValues(base);
    values.scenes[0]!.standings = [
      {
        cueId: null,
        characterId: "character-rin",
        appearanceId: "appearance-smile",
        side: "left",
        scale: 1,
        edge: "margin",
        vertical: "standard",
        enterPreset: "none",
        enterDurationMs: 0,
        exitPreset: "none",
        exitDurationMs: 0,
      },
    ];

    const rebuilt = buildContentDocument(base, values);
    const cue = rebuilt.scenes[0]!.visualCues.find(
      (entry) => entry.template.id === "character.standing",
    )!;
    expect(cue.id).toContain("standing-left");
    expect(standingInput(cue)).toEqual({
      characterId: "character-rin",
      appearanceId: "appearance-smile",
      side: "left",
      scale: 1,
      edge: "margin",
      vertical: "standard",
    });
    expect(cue.transition).toEqual({
      enter: { preset: "none", durationMs: 0 },
      exit: { preset: "none", durationMs: 0 },
    });
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("emits two character.standing@1 cues for the left and right slots", () => {
    const base = createInitialContentDocument();
    base.characters = [
      {
        id: "character-rin",
        name: "リン",
        names: [],
        voices: [],
        libraryCharacterId: null,
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null, faceSetVersion: null, libraryAppearanceId: null },
        ],
      },
    ];

    const values = toFormValues(base);
    values.scenes[0]!.standings = [
      {
        cueId: null,
        characterId: "character-rin",
        appearanceId: "appearance-smile",
        side: "left",
        scale: 1,
        edge: "margin",
        vertical: "standard",
        enterPreset: "none",
        enterDurationMs: 0,
        exitPreset: "none",
        exitDurationMs: 0,
      },
      {
        cueId: null,
        characterId: "character-rin",
        appearanceId: "appearance-smile",
        side: "right",
        scale: 0.8,
        edge: "margin",
        vertical: "standard",
        enterPreset: "none",
        enterDurationMs: 0,
        exitPreset: "none",
        exitDurationMs: 0,
      },
    ];

    const rebuilt = buildContentDocument(base, values);
    const cues = rebuilt.scenes[0]!.visualCues.filter(
      (cue) => cue.template.id === "character.standing",
    );
    expect(cues.map((cue) => cue.template.version)).toEqual([1, 1]);
    expect(cues.map((cue) => standingInput(cue).side)).toEqual(["left", "right"]);
    expect(cues.map((cue) => standingInput(cue).scale)).toEqual([1, 0.8]);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("writes standing enter and exit transitions and clamps the duration", () => {
    const base = createInitialContentDocument();
    base.characters = [
      {
        id: "character-rin",
        name: "リン",
        names: [],
        voices: [],
        libraryCharacterId: null,
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null, faceSetVersion: null, libraryAppearanceId: null },
        ],
      },
    ];

    const values = toFormValues(base);
    values.scenes[0]!.standings = values.scenes[0]!.standings.map((standing, index) => ({
      ...standing,
      characterId: "character-rin",
      appearanceId: "appearance-smile",
      ...(index === 0
        ? { enterPreset: "fade" as const, enterDurationMs: 99999, exitPreset: "fade" as const, exitDurationMs: 400 }
        : { enterPreset: "fade" as const, enterDurationMs: 250 }),
    }));

    const rebuilt = buildContentDocument(base, values);
    const cues = rebuilt.scenes[0]!.visualCues.filter(
      (cue) => cue.template.id === "character.standing",
    );
    expect(cues[0]!.transition).toEqual({
      enter: { preset: "fade", durationMs: 1000 },
      exit: { preset: "fade", durationMs: 400 },
    });
    expect(cues[1]!.transition).toEqual({
      enter: { preset: "fade", durationMs: 250 },
      exit: { preset: "none", durationMs: 0 },
    });
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("dissolves the standing cue when the selection is cleared", () => {
    const base = createInitialContentDocument();
    base.characters = [
      {
        id: "character-rin",
        name: "リン",
        names: [],
        voices: [],
        libraryCharacterId: null,
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null, faceSetVersion: null, libraryAppearanceId: null },
        ],
      },
    ];
    base.scenes[0]!.visualCues = [standingCue("vc-standing", "right")];

    const values = toFormValues(base);
    values.scenes[0]!.standings = [];

    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.scenes[0]!.visualCues).toEqual([]);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("removes standing cues when both fixed slots are cleared", () => {
    const base = createInitialContentDocument();
    base.characters = [
      {
        id: "character-rin",
        name: "リン",
        names: [],
        voices: [],
        libraryCharacterId: null,
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null, faceSetVersion: null, libraryAppearanceId: null },
        ],
      },
    ];
    base.scenes[0]!.visualCues = [
      standingCue("vc-left", "left"),
      { ...standingCue("vc-right", "right"), order: 1 },
    ];

    const values = toFormValues(base);
    const target = values.scenes[0]!;
    expect(target.standings.map((standing) => standing.cueId)).toEqual(["vc-left", "vc-right"]);
    target.standings = target.standings.map((standing) => ({
      ...standing,
      characterId: null,
      appearanceId: null,
    }));

    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.scenes[0]!.visualCues).toEqual([]);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("keeps unmanaged standing cues and updates only the managed one", () => {
    const base = createInitialContentDocument();
    base.characters = [
      {
        id: "character-rin",
        name: "リン",
        names: [],
        voices: [],
        libraryCharacterId: null,
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null, faceSetVersion: null, libraryAppearanceId: null },
        ],
      },
    ];
    const point = pointScenes(base)[0]!;
    point.lines = [
      {
        id: "l1",
        speakerId: null,
        captionText: "セリフ",
        speechText: "せりふ",
        selectedAudioTakeId: null,
        expressionId: null,
      },
    ];
    point.visualCues = [
      {
        ...standingCue("vc-lines-standing", "left", 0.5),
        range: { kind: "lines", startLineId: "l1", endLineId: "l1" },
      },
      standingCue("vc-standing", "right"),
      { ...standingCue("vc-standing-extra", "left", 0.75), order: 1 },
    ];

    const values = toFormValues(base);
    const target = values.scenes.find((scene) => scene.id === point.id)!;
    expect(target.standings.map((standing) => standing.cueId)).toEqual([
      "vc-standing-extra",
      "vc-standing",
    ]);
    expect(target.standings.map((standing) => standing.side)).toEqual(["left", "right"]);
    target.standings[1]!.scale = 1.5;

    const rebuilt = buildContentDocument(base, values);
    const rebuiltPoint = pointScenes(rebuilt)[0]!;
    const byId = new Map(rebuiltPoint.visualCues.map((cue) => [cue.id, cue]));
    const lineCue = byId.get("vc-lines-standing")!;
    expect(lineCue.template).toEqual({ id: "character.standing", version: 1 });
    expect(standingInput(lineCue).scale).toBe(0.5);
    const mainCue = byId.get("vc-standing")!;
    expect(mainCue.template).toEqual({ id: "character.standing", version: 1 });
    expect(standingInput(mainCue)).toEqual({
      characterId: "character-rin",
      appearanceId: "appearance-smile",
      side: "right",
      scale: 1.5,
      edge: "margin",
      vertical: "standard",
    });
    const extraCue = byId.get("vc-standing-extra")!;
    expect(extraCue.template).toEqual({ id: "character.standing", version: 1 });
    expect(standingInput(extraCue)).toEqual({
      characterId: "character-rin",
      appearanceId: "appearance-smile",
      side: "left",
      scale: 0.75,
      edge: "margin",
      vertical: "standard",
    });
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("clears speaker references and drops standing cues when a character is deleted", () => {
    const base = createInitialContentDocument();
    base.characters = [
      {
        id: "character-rin",
        name: "リン",
        names: [],
        voices: [],
        libraryCharacterId: null,
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null, faceSetVersion: null, libraryAppearanceId: null },
        ],
      },
    ];
    base.speakers = [{ id: "speaker-narrator", name: "ナレーター", characterId: "character-rin", voiceProfileId: null }];
    base.scenes[0]!.visualCues = [standingCue("vc-standing", "right")];

    const values = toFormValues(base);
    values.characters = [];

    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.characters).toEqual([]);
    expect(rebuilt.speakers).toEqual([]);
    expect(rebuilt.scenes[0]!.visualCues).toEqual([]);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("defaults blank expression and pose to normal and front", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    values.characters = [
      {
        id: "character-rin",
        name: "リン",
        names: [],
        voiceProfileId: null,
        voices: [],
        libraryCharacterId: null,
        appearances: [
          { id: "appearance-1", assetId: "asset-rin", expression: "  ", pose: "", label: "", faceSetId: null, faceSetVersion: null, libraryAppearanceId: null },
        ],
      },
    ];

    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.characters[0]!.appearances[0]).toEqual({
      id: "appearance-1",
      assetId: "asset-rin",
      expression: "normal",
      pose: "front",
      faceSetId: null, faceSetVersion: null, libraryAppearanceId: null,
    });
  });

  it("round-trips faceSetId and expressionId", () => {
    const base = createInitialContentDocument();
    base.speakers = [
      { id: "speaker-rin", name: "リン", characterId: "character-rin", voiceProfileId: null },
    ];
    base.characters = [
      {
        id: "character-rin",
        name: "リン",
        names: [],
        voices: [],
        libraryCharacterId: null,
        appearances: [
          { id: "appearance-rin", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: "faceset-rin", faceSetVersion: 1, libraryAppearanceId: null },
        ],
      },
    ];
    const point = pointScenes(base)[0]!;
    point.lines = [
      {
        id: "line-happy",
        speakerId: "speaker-rin",
        captionText: "嬉しい",
        speechText: "うれしい",
        selectedAudioTakeId: null,
        expressionId: "happy",
      },
    ];

    const values = toFormValues(base);
    expect(values.characters[0]!.appearances[0]!.faceSetId).toBe("faceset-rin");
    expect(values.scenes[1]!.lines[0]!.expressionId).toBe("happy");

    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.characters[0]!.appearances[0]!.faceSetId).toBe("faceset-rin");
    expect(rebuilt.scenes[1]!.lines[0]!.expressionId).toBe("happy");
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("round-trips library provenance and normalizes a legacy Face Set version to v1", () => {
    const base = createInitialContentDocument();
    base.characters = [
      {
        id: "character-rin",
        name: "リン",
        names: [],
        voices: [],
        libraryCharacterId: "lib-rin",
        appearances: [
          {
            id: "appearance-rin",
            assetId: "asset-rin",
            expression: "smile",
            pose: "front",
            faceSetId: "faceset-rin",
            faceSetVersion: 3,
            libraryAppearanceId: "lib-appearance-rin",
          },
        ],
      },
    ];

    const values = toFormValues(base);
    expect(values.characters[0]!.libraryCharacterId).toBe("lib-rin");
    expect(values.characters[0]!.appearances[0]).toMatchObject({
      faceSetVersion: 3,
      libraryAppearanceId: "lib-appearance-rin",
    });
    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.characters[0]).toMatchObject({
      libraryCharacterId: "lib-rin",
      appearances: [
        {
          faceSetId: "faceset-rin",
          faceSetVersion: 3,
          libraryAppearanceId: "lib-appearance-rin",
        },
      ],
    });

    base.characters[0]!.appearances[0]!.faceSetVersion = null;
    expect(toFormValues(base).characters[0]!.appearances[0]!.faceSetVersion).toBe(1);
  });

  it("clears expressionId when the speaker is dropped", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    values.scenes[1]!.lines = [
      {
        id: "line-orphan",
        speakerId: "speaker-missing",
        captionText: "孤立",
        speechText: "こりつ",
        selectedAudioTakeId: null,
        expressionId: "happy",
        takes: [],
        gapBeforeMs: 0,
      },
    ];

    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.scenes[1]!.lines[0]).toMatchObject({ speakerId: null, expressionId: null });
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("reads a character.standing@1 cue into the standing slots", () => {
    const base = createInitialContentDocument();
    base.characters = [
      {
        id: "character-rin",
        name: "リン",
        names: [],
        voices: [],
        libraryCharacterId: null,
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null, faceSetVersion: null, libraryAppearanceId: null },
        ],
      },
    ];
    base.scenes[1]!.visualCues = [
      {
        id: "vc-standing-3",
        template: { id: "character.standing", version: 1 },
        range: { kind: "scene" },
        layer: "standing",
        order: 0,
        transition: {
          enter: { preset: "none", durationMs: 0 },
          exit: { preset: "none", durationMs: 0 },
        },
        input: {
          characterId: "character-rin",
          appearanceId: "appearance-rin",
          side: "left",
          scale: 1,
        },
      },
    ];

    const values = toFormValues(base);
    expect(values.scenes[1]!.standings[0]).toMatchObject({
      cueId: "vc-standing-3",
      characterId: "character-rin",
      appearanceId: "appearance-rin",
      side: "left",
    });
  });

  it("rejects an appearance without an image on save", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    values.characters = [
      {
        id: "character-rin",
        name: "リン",
        names: [],
        voiceProfileId: null,
        voices: [],
        libraryCharacterId: null,
        appearances: [
          { id: "appearance-1", assetId: null, expression: "", pose: "", label: "", faceSetId: null, faceSetVersion: null, libraryAppearanceId: null },
        ],
      },
    ];

    expect(() => buildContentDocument(base, values)).toThrow();
  });

  it("round-trips a character voice profile through its speaker", () => {
    const base = createInitialContentDocument();
    base.characters = [{ id: "character-rin", name: "リン", names: [], voices: [], appearances: [], libraryCharacterId: null }];
    base.speakers = [
      { id: "speaker-rin", name: "リン", characterId: "character-rin", voiceProfileId: "vp-1" },
    ];
    const values = toFormValues(base);
    expect(values.characters[0]!.voiceProfileId).toBe("vp-1");

    values.characters[0]!.voiceProfileId = "vp-2";
    const rebuilt = buildContentDocument(base, values);
    const speaker = rebuilt.speakers.find((entry) => entry.characterId === "character-rin")!;
    expect(speaker.id).toBe("speaker-rin");
    expect(speaker.voiceProfileId).toBe("vp-2");
    expect(rebuilt.characters[0]!.voices).toEqual([{ locale: "ja-JP", voiceProfileId: "vp-2" }]);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("reads the current locale voice from character voices", () => {
    const base = createInitialContentDocument();
    base.characters = [
      {
        id: "character-rin",
        name: "リン",
        names: [],
        voices: [
          { locale: "ja-JP", voiceProfileId: "vp-1" },
          { locale: "en-US", voiceProfileId: "vp-2" },
        ],
        libraryCharacterId: null,
        appearances: [],
      },
    ];
    base.speakers = [
      { id: "speaker-rin", name: "リン", characterId: "character-rin", voiceProfileId: "vp-1" },
    ];
    const values = toFormValues(base);
    expect(values.characters[0]!.voiceProfileId).toBe("vp-1");
    expect(values.characters[0]!.voices).toEqual([
      { locale: "ja-JP", voiceProfileId: "vp-1" },
      { locale: "en-US", voiceProfileId: "vp-2" },
    ]);

    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.characters[0]!.voices).toEqual([
      { locale: "ja-JP", voiceProfileId: "vp-1" },
      { locale: "en-US", voiceProfileId: "vp-2" },
    ]);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("creates a speaker for a voice-only character with no profile", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    values.characters.push({
      id: "character-narrator",
      name: "ナレーター",
      names: [],
      voiceProfileId: null,
      voices: [],
      libraryCharacterId: null,
      appearances: [],
    });

    const rebuilt = buildContentDocument(base, values);
    const speaker = rebuilt.speakers.find(
      (entry) => entry.characterId === "character-narrator",
    )!;
    expect(speaker.voiceProfileId).toBeNull();
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("preserves a referenced narrator speaker and prunes unreferenced ones", () => {
    const base = createInitialContentDocument();
    base.speakers = [
      { id: "speaker-narrator", name: "ナレーター", characterId: null, voiceProfileId: "vp-1" },
      { id: "speaker-unused", name: "未使用", characterId: null, voiceProfileId: null },
    ];
    const point = base.scenes[1]!;
    point.lines = [
      {
        id: "line-narrator",
        speakerId: "speaker-narrator",
        captionText: "ナレーション",
        speechText: "なれーしょん",
        selectedAudioTakeId: null,
        expressionId: null,
      },
    ];

    const values = toFormValues(base);
    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.speakers.map((speaker) => speaker.id)).toEqual(["speaker-narrator"]);
    expect(rebuilt.speakers[0]!.voiceProfileId).toBe("vp-1");
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("counts character and appearance references for the deletion dialog", () => {
    const base = createInitialContentDocument();
    base.characters = [
      {
        id: "character-rin",
        name: "リン",
        names: [],
        voices: [],
        libraryCharacterId: null,
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null, faceSetVersion: null, libraryAppearanceId: null },
        ],
      },
    ];
    base.speakers = [{ id: "speaker-narrator", name: "ナレーター", characterId: "character-rin", voiceProfileId: null }];
    const makeStandingCue = (id: string) => standingCue(id, "right");
    base.scenes[0]!.visualCues = [makeStandingCue("vc-a")];
    base.scenes[1]!.visualCues = [makeStandingCue("vc-b")];

    expect(countCharacterReferences(base, "character-rin")).toEqual({
      scenes: 2,
      cues: 2,
      speakers: 1,
    });
    expect(countAppearanceReferences(base, "character-rin", "appearance-smile")).toEqual({
      scenes: 2,
      cues: 2,
      speakers: 0,
    });
  });

});
