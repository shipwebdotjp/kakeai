import { describe, expect, it } from "vitest";
import {
  contentDocumentSchema,
  createInitialContentDocument,
  type ContentDocument,
  type PointScene,
} from "@kakeai/contracts";
import {
  buildContentDocument,
  countAppearanceReferences,
  countCharacterReferences,
  createEmptySpeaker,
  createPointSceneFormValue,
  toFormValues,
} from "./form";

function pointScenes(document: ContentDocument): PointScene[] {
  return document.scenes.filter((scene): scene is PointScene => scene.kind === "point");
}

function standingInput(cue: { input: unknown }): {
  characterId: string;
  appearanceId: string;
  x: number;
  y: number;
  scale: number;
} {
  return cue.input as {
    characterId: string;
    appearanceId: string;
    x: number;
    y: number;
    scale: number;
  };
}

describe("buildContentDocument", () => {
  it("maps scene values to base scenes by id, not position", () => {
    const base = createInitialContentDocument();
    const points = pointScenes(base);
    points[0]!.slots.heading = "見出し1";
    points[1]!.slots.heading = "見出し2";

    const values = toFormValues(base);
    const [intro, first, second, third, outro] = values.scenes;
    values.scenes = [intro!, second!, first!, third!, outro!];

    const rebuilt = buildContentDocument(base, values);
    const rebuiltPoints = pointScenes(rebuilt);
    expect(rebuiltPoints.map((scene) => scene.slots.heading)).toEqual([
      "見出し2",
      "見出し1",
      "",
    ]);
    expect(rebuilt.scenes[1]!.id).toBe(points[1]!.id);
    expect(rebuilt.scenes[2]!.id).toBe(points[0]!.id);
  });

  it("updates background and card cues while keeping unmanaged cues", () => {
    const base = createInitialContentDocument();
    const point = pointScenes(base)[0]!;
    point.lines = [
      {
        id: "l1",
        speakerId: null,
        captionText: "セリフ",
        speechText: "せりふ",
        selectedAudioTakeId: null,
      },
    ];
    point.visualCues = [
      {
        id: "vc-lines",
        template: { id: "media.full-bleed", version: 1 },
        range: { kind: "lines", startLineId: "l1", endLineId: "l1" },
        input: { assetId: "asset-line-bg", fit: "cover" },
      },
      {
        id: "vc-old-bg",
        template: { id: "media.full-bleed", version: 1 },
        range: { kind: "scene" },
        input: { assetId: "asset-old", fit: "cover" },
      },
    ];

    const values = toFormValues(base);
    const target = values.scenes.find((scene) => scene.id === point.id)!;
    target.backgroundAssetId = "asset-new";
    target.cardAssetId = "asset-card";
    target.cardHeading = "カード見出し";

    const rebuilt = buildContentDocument(base, values);
    const rebuiltPoint = pointScenes(rebuilt)[0]!;
    const sceneCues = rebuiltPoint.visualCues.filter((cue) => cue.range.kind === "scene");
    const assetIds = sceneCues.map((cue) => (cue.input as { assetId: string }).assetId);
    expect(rebuiltPoint.visualCues.some((cue) => cue.id === "vc-lines")).toBe(true);
    expect(assetIds).toContain("asset-new");
    expect(assetIds).not.toContain("asset-old");
    expect(assetIds).toContain("asset-card");
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("dissolves a cue when the selection is cleared", () => {
    const base = createInitialContentDocument();
    const intro = base.scenes[0]!;
    intro.visualCues = [
      {
        id: "vc-bg",
        template: { id: "media.full-bleed", version: 1 },
        range: { kind: "scene" },
        input: { assetId: "asset-bg", fit: "cover" },
      },
    ];

    const values = toFormValues(base);
    values.scenes[0]!.backgroundAssetId = null;

    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.scenes[0]!.visualCues).toEqual([]);
  });

  it("builds a valid document when a new point scene is added", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    const outroIndex = values.scenes.findIndex((scene) => scene.kind === "outro");
    values.scenes.splice(outroIndex, 0, createPointSceneFormValue());

    const rebuilt = buildContentDocument(base, values);
    expect(pointScenes(rebuilt)).toHaveLength(4);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("preserves focalPoint when a managed cue is re-saved", () => {
    const base = createInitialContentDocument();
    const intro = base.scenes[0]!;
    intro.visualCues = [
      {
        id: "vc-bg",
        template: { id: "media.full-bleed", version: 1 },
        range: { kind: "scene" },
        input: { assetId: "asset-bg", fit: "cover", focalPoint: { x: 0.2, y: 0.8 } },
      },
    ];

    const values = toFormValues(base);
    const rebuilt = buildContentDocument(base, values);
    const cue = rebuilt.scenes[0]!.visualCues[0]!;
    expect((cue.input as { focalPoint?: unknown }).focalPoint).toEqual({ x: 0.2, y: 0.8 });
  });

  it("prunes orphaned takes and scene audio cues when a scene is deleted", () => {    const base = createInitialContentDocument();
    const point = pointScenes(base)[0]!;
    point.lines = [
      {
        id: "l-take",
        speakerId: null,
        captionText: "せるふ",
        speechText: "せるふ",
        selectedAudioTakeId: "take-1",
      },
    ];
    base.audioTakes = [
      {
        id: "take-1",
        narrationSegmentId: "l-take",
        source: "manual",
        assetId: "asset-audio",
        durationMs: 1000,
      },
    ];
    base.audioCues = [
      { id: "cue-scene", role: "bgm", assetId: "asset-bgm", range: { kind: "scene", sceneId: point.id } },
      { id: "cue-work", role: "bgm", assetId: "asset-bgm", range: { kind: "work" } },
    ];

    const values = toFormValues(base);
    values.scenes = values.scenes.filter((scene) => scene.id !== point.id);

    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.audioTakes).toEqual([]);
    expect(rebuilt.audioCues.map((cue) => cue.id)).toEqual(["cue-work"]);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("stamps the current template when saving a legacy document", () => {
    const base = createInitialContentDocument();
    base.template = { id: "explanation-5-scenes", version: 1 };

    const rebuilt = buildContentDocument(base, toFormValues(base));
    expect(rebuilt.template).toEqual({ id: "explanation-scenes", version: 1 });
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("round-trips audio takes and their selection", () => {
    const base = createInitialContentDocument();
    const point = pointScenes(base)[0]!;
    point.lines = [
      {
        id: "l1",
        speakerId: null,
        captionText: "せるふ",
        speechText: "せるふ",
        selectedAudioTakeId: "take-1",
      },
    ];
    base.audioTakes = [
      { id: "take-1", narrationSegmentId: "l1", source: "manual", assetId: "asset-a", durationMs: 1200 },
      { id: "take-2", narrationSegmentId: "l1", source: "manual", assetId: "asset-b", durationMs: 900 },
    ];

    const values = toFormValues(base);
    expect(values.scenes.find((scene) => scene.id === point.id)?.lines[0]?.takes).toHaveLength(2);

    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.audioTakes.map((take) => take.id)).toEqual(["take-1", "take-2"]);
    expect(pointScenes(rebuilt)[0]!.lines[0]!.selectedAudioTakeId).toBe("take-1");
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("clears a dangling take selection when the take is removed", () => {
    const base = createInitialContentDocument();
    const point = pointScenes(base)[0]!;
    point.lines = [
      {
        id: "l1",
        speakerId: null,
        captionText: "",
        speechText: "",
        selectedAudioTakeId: "take-1",
      },
    ];
    base.audioTakes = [
      { id: "take-1", narrationSegmentId: "l1", source: "tts", assetId: "asset-a", durationMs: 1000 },
    ];

    const values = toFormValues(base);
    const line = values.scenes.find((scene) => scene.id === point.id)!.lines[0]!;
    expect(line.takes[0]?.source).toBe("tts");
    line.takes = [];
    line.selectedAudioTakeId = "take-1";

    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.audioTakes).toEqual([]);
    expect(pointScenes(rebuilt)[0]!.lines[0]!.selectedAudioTakeId).toBeNull();
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("manages a single work BGM and keeps other audio cues", () => {    const base = createInitialContentDocument();
    base.audioCues = [
      { id: "cue-work", role: "bgm", assetId: "asset-bgm", range: { kind: "work" }, gainDb: -18, loop: true },
      { id: "cue-scene", role: "sfx", assetId: "asset-sfx", range: { kind: "work" } },
    ];

    const values = toFormValues(base);
    expect(values.bgm).toMatchObject({ cueId: "cue-work", assetId: "asset-bgm", gainDb: -18, loop: true });
    values.bgm.gainDb = -12;
    values.bgm.loop = false;

    const rebuilt = buildContentDocument(base, values);
    const workBgm = rebuilt.audioCues.filter((cue) => cue.id === "cue-work");
    expect(workBgm).toHaveLength(1);
    expect(workBgm[0]).toMatchObject({ gainDb: -12, loop: false, range: { kind: "work" } });
    expect(rebuilt.audioCues.some((cue) => cue.id === "cue-scene")).toBe(true);

    values.bgm.assetId = null;
    const cleared = buildContentDocument(base, values);
    expect(cleared.audioCues.some((cue) => cue.id === "cue-work")).toBe(false);
    expect(cleared.audioCues.some((cue) => cue.id === "cue-scene")).toBe(true);
  });

  it("round-trips characters and a scene standing cue", () => {
    const base = createInitialContentDocument();
    base.characters = [
      {
        id: "character-rin",
        name: "リン",
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front" },
        ],
      },
    ];
    const point = pointScenes(base)[0]!;
    point.visualCues = [
      {
        id: "vc-standing",
        template: { id: "character.standing", version: 1 },
        range: { kind: "scene" },
        input: {
          characterId: "character-rin",
          appearanceId: "appearance-smile",
          x: 0.85,
          y: 0.85,
          scale: 1,
        },
      },
    ];

    const values = toFormValues(base);
    expect(values.characters).toEqual([
      {
        id: "character-rin",
        name: "リン",
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front" },
        ],
      },
    ]);
    const target = values.scenes.find((scene) => scene.id === point.id)!;
    expect(target.standingCueId).toBe("vc-standing");
    expect(target.standingCharacterId).toBe("character-rin");
    expect(target.standingAppearanceId).toBe("appearance-smile");

    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.characters[0]!.id).toBe("character-rin");
    expect(rebuilt.characters[0]!.appearances[0]!.id).toBe("appearance-smile");
    const cue = rebuilt.scenes.find((scene) => scene.id === point.id)!.visualCues[0]!;
    expect(cue.id).toBe("vc-standing");
    expect(standingInput(cue)).toEqual({
      characterId: "character-rin",
      appearanceId: "appearance-smile",
      x: 0.85,
      y: 0.85,
      scale: 1,
    });
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("adds a standing cue with the default position and scale", () => {
    const base = createInitialContentDocument();
    base.characters = [
      {
        id: "character-rin",
        name: "リン",
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front" },
        ],
      },
    ];

    const values = toFormValues(base);
    const intro = values.scenes[0]!;
    intro.standingCharacterId = "character-rin";
    intro.standingAppearanceId = "appearance-smile";

    const rebuilt = buildContentDocument(base, values);
    const cue = rebuilt.scenes[0]!.visualCues.find(
      (entry) => entry.template.id === "character.standing",
    )!;
    expect(cue.id).toBe("visual-scene-intro-standing");
    expect(standingInput(cue)).toEqual({
      characterId: "character-rin",
      appearanceId: "appearance-smile",
      x: 0.85,
      y: 0.85,
      scale: 1,
    });
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("dissolves the standing cue when the selection is cleared", () => {
    const base = createInitialContentDocument();
    base.characters = [
      {
        id: "character-rin",
        name: "リン",
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front" },
        ],
      },
    ];
    base.scenes[0]!.visualCues = [
      {
        id: "vc-standing",
        template: { id: "character.standing", version: 1 },
        range: { kind: "scene" },
        input: {
          characterId: "character-rin",
          appearanceId: "appearance-smile",
          x: 0.5,
          y: 0.5,
          scale: 1,
        },
      },
    ];

    const values = toFormValues(base);
    values.scenes[0]!.standingCharacterId = null;
    values.scenes[0]!.standingAppearanceId = null;

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
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front" },
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
      },
    ];
    point.visualCues = [
      {
        id: "vc-lines-standing",
        template: { id: "character.standing", version: 1 },
        range: { kind: "lines", startLineId: "l1", endLineId: "l1" },
        input: {
          characterId: "character-rin",
          appearanceId: "appearance-smile",
          x: 0.1,
          y: 0.2,
          scale: 0.5,
        },
      },
      {
        id: "vc-standing",
        template: { id: "character.standing", version: 1 },
        range: { kind: "scene" },
        input: {
          characterId: "character-rin",
          appearanceId: "appearance-smile",
          x: 0.85,
          y: 0.85,
          scale: 1,
        },
      },
      {
        id: "vc-standing-extra",
        template: { id: "character.standing", version: 1 },
        range: { kind: "scene" },
        input: {
          characterId: "character-rin",
          appearanceId: "appearance-smile",
          x: 0.2,
          y: 0.3,
          scale: 0.75,
        },
      },
    ];

    const values = toFormValues(base);
    const target = values.scenes.find((scene) => scene.id === point.id)!;
    expect(target.standingCueId).toBe("vc-standing");
    target.standingScale = 1.5;

    const rebuilt = buildContentDocument(base, values);
    const rebuiltPoint = pointScenes(rebuilt)[0]!;
    const byId = new Map(rebuiltPoint.visualCues.map((cue) => [cue.id, cue]));
    expect(standingInput(byId.get("vc-lines-standing")!).scale).toBe(0.5);
    expect(standingInput(byId.get("vc-standing")!).scale).toBe(1.5);
    expect(standingInput(byId.get("vc-standing-extra")!).scale).toBe(0.75);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("clears speaker references and drops standing cues when a character is deleted", () => {
    const base = createInitialContentDocument();
    base.characters = [
      {
        id: "character-rin",
        name: "リン",
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front" },
        ],
      },
    ];
    base.speakers = [{ id: "speaker-narrator", name: "ナレーター", characterId: "character-rin", voiceProfileId: null }];
    base.scenes[0]!.visualCues = [
      {
        id: "vc-standing",
        template: { id: "character.standing", version: 1 },
        range: { kind: "scene" },
        input: {
          characterId: "character-rin",
          appearanceId: "appearance-smile",
          x: 0.85,
          y: 0.85,
          scale: 1,
        },
      },
    ];

    const values = toFormValues(base);
    values.characters = [];

    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.characters).toEqual([]);
    expect(rebuilt.speakers[0]!.characterId).toBeNull();
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
        appearances: [{ id: "appearance-1", assetId: "asset-rin", expression: "  ", pose: "" }],
      },
    ];

    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.characters[0]!.appearances[0]).toEqual({
      id: "appearance-1",
      assetId: "asset-rin",
      expression: "normal",
      pose: "front",
    });
  });

  it("rejects an appearance without an image on save", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    values.characters = [
      {
        id: "character-rin",
        name: "リン",
        appearances: [{ id: "appearance-1", assetId: null, expression: "", pose: "" }],
      },
    ];

    expect(() => buildContentDocument(base, values)).toThrow();
  });

  it("round-trips speakers and their voice profile", () => {
    const base = createInitialContentDocument();
    base.speakers = [
      {
        id: "speaker-narrator",
        name: "ナレーター",
        characterId: null,
        voiceProfileId: "vp-1",
      },
    ];
    const values = toFormValues(base);
    expect(values.speakers).toEqual([
      { id: "speaker-narrator", name: "ナレーター", characterId: null, voiceProfileId: "vp-1" },
    ]);

    values.speakers[0]!.voiceProfileId = "vp-2";
    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.speakers[0]!.voiceProfileId).toBe("vp-2");
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("adds a speaker with an unset voice profile", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    values.speakers.push(createEmptySpeaker());

    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.speakers[0]!.voiceProfileId).toBeNull();
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("counts character and appearance references for the deletion dialog", () => {
    const base = createInitialContentDocument();
    base.characters = [
      {
        id: "character-rin",
        name: "リン",
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front" },
        ],
      },
    ];
    base.speakers = [{ id: "speaker-narrator", name: "ナレーター", characterId: "character-rin", voiceProfileId: null }];
    const standingCue = (id: string) => ({
      id,
      template: { id: "character.standing", version: 1 },
      range: { kind: "scene" as const },
      input: {
        characterId: "character-rin",
        appearanceId: "appearance-smile",
        x: 0.85,
        y: 0.85,
        scale: 1,
      },
    });
    base.scenes[0]!.visualCues = [standingCue("vc-a")];
    base.scenes[1]!.visualCues = [standingCue("vc-b")];

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
