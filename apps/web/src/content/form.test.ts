import { describe, expect, it } from "vitest";
import {
  contentDocumentSchema,
  createInitialContentDocument,
  type ContentDocument,
  type PointScene,
  type VisualCue,
} from "@kakeai/contracts";
import {
  buildContentDocument,
  cloneSceneFormValue,
  countAppearanceReferences,
  countCharacterReferences,
  createCueFormValue,
  createEmptyLine,
  createPointSceneFormValue,
  newSceneId,
  toFormValues,
  type SceneFormValue,
} from "./form";

const transition = {
  enter: { preset: "fade", durationMs: 350 },
  exit: { preset: "none", durationMs: 0 },
} as const;

function vc(partial: Partial<VisualCue> & Pick<VisualCue, "id" | "template" | "input">): VisualCue {
  return {
    range: { kind: "scene" },
    layer: "background",
    order: 0,
    transition,
    ...partial,
  } as VisualCue;
}

function pointScenes(document: ContentDocument): PointScene[] {
  return document.scenes.filter((scene): scene is PointScene => scene.kind === "point");
}

function sceneTextCue(scene: { visualCues: VisualCue[] }, role: string): VisualCue | undefined {
  return scene.visualCues.find((cue) => (cue.input as { role?: string }).role === role);
}

function setSceneText(scene: { visualCues: VisualCue[] }, role: string, text: string): void {
  const cue = sceneTextCue(scene, role);
  if (cue !== undefined) {
    (cue.input as { text: string }).text = text;
  }
}

function readSceneText(scene: { visualCues: VisualCue[] }, role: string): string {
  const input = sceneTextCue(scene, role)?.input as { text?: string } | undefined;
  return input?.text ?? "";
}

function standingInput(cue: { input: unknown }): {
  characterId: string;
  appearanceId: string;
  side: "left" | "right";
  scale: number;
} {
  return cue.input as {
    characterId: string;
    appearanceId: string;
    side: "left" | "right";
    scale: number;
  };
}

function standingV1(id: string, x: number, scale = 1): VisualCue {
  return vc({
    id,
    template: { id: "character.standing", version: 1 },
    layer: "standing",
    input: {
      characterId: "character-rin",
      appearanceId: "appearance-smile",
      x,
      y: 0.85,
      scale,
    },
  });
}

describe("buildContentDocument", () => {
  it("maps scene values to base scenes by id, not position", () => {
    const base = createInitialContentDocument();
    const points = pointScenes(base);
    setSceneText(points[0]!, "heading", "見出し1");
    setSceneText(points[1]!, "heading", "見出し2");

    const values = toFormValues(base);
    const [intro, first, second, third, outro] = values.scenes;
    values.scenes = [intro!, second!, first!, third!, outro!];

    const rebuilt = buildContentDocument(base, values);
    const rebuiltPoints = pointScenes(rebuilt);
    expect(rebuiltPoints.map((scene) => readSceneText(scene, "heading"))).toEqual([
      "見出し2",
      "見出し1",
      "",
    ]);
    expect(rebuilt.scenes[1]!.id).toBe(points[1]!.id);
    expect(rebuilt.scenes[2]!.id).toBe(points[0]!.id);
  });

  it("updates an editable cue and keeps unmanaged cues", () => {
    const base = createInitialContentDocument();
    const intro = base.scenes[0]!;
    intro.visualCues = [
      vc({
        id: "vc-bg",
        template: { id: "media.full-bleed", version: 1 },
        input: { assetId: "asset-old", fit: "cover" },
      }),
      vc({
        id: "vc-text",
        template: { id: "text.block", version: 1 },
        layer: "overlay",
        input: { text: "本文", role: "body" },
      }),
    ];

    const values = toFormValues(base);
    const target = values.scenes[0]!;
    const bg = target.cues.find((cue) => cue.id === "vc-bg")!;
    bg.fields.assetId = "asset-new";

    const rebuilt = buildContentDocument(base, values);
    const cues = rebuilt.scenes[0]!.visualCues;
    const byId = new Map(cues.map((cue) => [cue.id, cue]));
    expect((byId.get("vc-bg")!.input as { assetId: string }).assetId).toBe("asset-new");
    expect(byId.get("vc-text")!.template).toEqual({ id: "text.block", version: 1 });
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("dissolves a cue when its asset selection is cleared", () => {
    const base = createInitialContentDocument();
    base.scenes[0]!.visualCues = [
      vc({
        id: "vc-bg",
        template: { id: "media.full-bleed", version: 1 },
        input: { assetId: "asset-bg", fit: "cover" },
      }),
    ];

    const values = toFormValues(base);
    values.scenes[0]!.cues[0]!.fields.assetId = "";

    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.scenes[0]!.visualCues).toEqual([]);
  });

  it("round-trips a device-frame composition with its nested media", () => {
    const base = createInitialContentDocument();
    base.scenes[0]!.visualCues = [
      vc({
        id: "vc-device",
        template: { id: "scene.device-frame", version: 1 },
        layer: "card",
        input: {
          frame: "phone",
          backgroundColor: "#112233",
          screen: { kind: "media", assetId: "asset-screen", fit: "contain" },
        },
      }),
    ];

    const values = toFormValues(base);
    const cue = values.scenes[0]!.cues[0]!;
    expect(cue.fields.screen).toBe("asset-screen");
    expect(cue.fields.frame).toBe("phone");
    cue.fields.screen = "asset-screen-2";

    const rebuilt = buildContentDocument(base, values);
    const input = rebuilt.scenes[0]!.visualCues[0]!.input as {
      screen: { assetId: string; fit: string };
      frame: string;
      backgroundColor: string;
    };
    expect(input.screen.assetId).toBe("asset-screen-2");
    expect(input.screen.fit).toBe("contain");
    expect(input.frame).toBe("phone");
    expect(input.backgroundColor).toBe("#112233");
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("preserves a nested-template screen when a device-frame is re-saved", () => {
    const base = createInitialContentDocument();
    base.scenes[0]!.visualCues = [
      vc({
        id: "vc-device",
        template: { id: "scene.device-frame", version: 1 },
        layer: "background",
        input: {
          frame: "laptop",
          screen: {
            kind: "template",
            template: { id: "text.block", version: 1 },
            input: { text: "本文", role: "body" },
          },
        },
      }),
    ];

    const values = toFormValues(base);
    const cue = values.scenes[0]!.cues[0]!;
    expect(cue.fields.screen).toBe("");
    cue.fields.frame = "phone";

    const rebuilt = buildContentDocument(base, values);
    const input = rebuilt.scenes[0]!.visualCues[0]!.input as {
      frame: string;
      screen: { kind: string };
    };
    expect(input.frame).toBe("phone");
    expect(input.screen.kind).toBe("template");
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("rejects a newly added cue with no selected media", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    values.scenes[0]!.cues = [
      createCueFormValue({
        sceneId: values.scenes[0]!.id,
        templateId: "media.full-bleed",
        templateVersion: 1,
        layer: "background",
        order: 0,
      }),
    ];
    expect(() => buildContentDocument(base, values)).toThrow();
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
    base.scenes[0]!.visualCues = [
      vc({
        id: "vc-bg",
        template: { id: "media.full-bleed", version: 1 },
        input: { assetId: "asset-bg", fit: "cover", focalPoint: { x: 0.2, y: 0.8 } },
      }),
    ];

    const values = toFormValues(base);
    const rebuilt = buildContentDocument(base, values);
    const cue = rebuilt.scenes[0]!.visualCues[0]!;
    expect((cue.input as { focalPoint?: unknown }).focalPoint).toEqual({ x: 0.2, y: 0.8 });
  });

  it("prunes orphaned takes and scene audio cues when a scene is deleted", () => {
    const base = createInitialContentDocument();
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

  it("manages a single work BGM and keeps other audio cues", () => {
    const base = createInitialContentDocument();
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
    base.scenes[1]!.visualCues = [standingV1("vc-standing", 0.85)];

    const values = toFormValues(base);
    expect(values.characters).toEqual([
      {
        id: "character-rin",
        name: "リン",
        voiceProfileId: null,
        appearances: [
          {
            id: "appearance-smile",
            assetId: "asset-rin",
            expression: "smile",
            pose: "front",
            label: "",
          },
        ],
      },
    ]);
    const target = values.scenes[1]!;
    expect(target.cues).toEqual([]);
    expect(target.standings).toEqual([
      { cueId: null, characterId: null, appearanceId: null, side: "left", scale: 1 },
      {
        cueId: "vc-standing",
        characterId: "character-rin",
        appearanceId: "appearance-smile",
        side: "right",
        scale: 1,
      },
    ]);

    const rebuilt = buildContentDocument(base, values);
    const cue = rebuilt.scenes[1]!.visualCues[0]!;
    expect(cue.id).toBe("vc-standing");
    expect(cue.template).toEqual({ id: "character.standing", version: 2 });
    expect(standingInput(cue)).toEqual({
      characterId: "character-rin",
      appearanceId: "appearance-smile",
      side: "right",
      scale: 1,
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
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front" },
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
    });
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("emits two character.standing@2 cues for the left and right slots", () => {
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
    values.scenes[0]!.standings = [
      {
        cueId: null,
        characterId: "character-rin",
        appearanceId: "appearance-smile",
        side: "left",
        scale: 1,
      },
      {
        cueId: null,
        characterId: "character-rin",
        appearanceId: "appearance-smile",
        side: "right",
        scale: 0.8,
      },
    ];

    const rebuilt = buildContentDocument(base, values);
    const cues = rebuilt.scenes[0]!.visualCues.filter(
      (cue) => cue.template.id === "character.standing",
    );
    expect(cues.map((cue) => cue.template.version)).toEqual([2, 2]);
    expect(cues.map((cue) => standingInput(cue).side)).toEqual(["left", "right"]);
    expect(cues.map((cue) => standingInput(cue).scale)).toEqual([1, 0.8]);
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
    base.scenes[0]!.visualCues = [standingV1("vc-standing", 0.5)];

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
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front" },
        ],
      },
    ];
    base.scenes[0]!.visualCues = [
      standingV1("vc-left", 0.2),
      { ...standingV1("vc-right", 0.85), order: 1 },
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
        ...standingV1("vc-lines-standing", 0.1, 0.5),
        range: { kind: "lines", startLineId: "l1", endLineId: "l1" },
      },
      standingV1("vc-standing", 0.85),
      { ...standingV1("vc-standing-extra", 0.2, 0.75), order: 1 },
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
    expect(mainCue.template).toEqual({ id: "character.standing", version: 2 });
    expect(standingInput(mainCue)).toEqual({
      characterId: "character-rin",
      appearanceId: "appearance-smile",
      side: "right",
      scale: 1.5,
    });
    const extraCue = byId.get("vc-standing-extra")!;
    expect(extraCue.template).toEqual({ id: "character.standing", version: 2 });
    expect(standingInput(extraCue)).toEqual({
      characterId: "character-rin",
      appearanceId: "appearance-smile",
      side: "left",
      scale: 0.75,
    });
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
    base.scenes[0]!.visualCues = [standingV1("vc-standing", 0.85)];

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
        voiceProfileId: null,
        appearances: [
          { id: "appearance-1", assetId: "asset-rin", expression: "  ", pose: "", label: "" },
        ],
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
        voiceProfileId: null,
        appearances: [
          { id: "appearance-1", assetId: null, expression: "", pose: "", label: "" },
        ],
      },
    ];

    expect(() => buildContentDocument(base, values)).toThrow();
  });

  it("round-trips a character voice profile through its speaker", () => {
    const base = createInitialContentDocument();
    base.characters = [{ id: "character-rin", name: "リン", appearances: [] }];
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
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("creates a speaker for a voice-only character with no profile", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    values.characters.push({
      id: "character-narrator",
      name: "ナレーター",
      voiceProfileId: null,
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
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front" },
        ],
      },
    ];
    base.speakers = [{ id: "speaker-narrator", name: "ナレーター", characterId: "character-rin", voiceProfileId: null }];
    const standingCue = (id: string) => standingV1(id, 0.85);
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

  it("edits a text overlay cue through generic fields", () => {
    const base = createInitialContentDocument();
    base.scenes[0]!.visualCues = [
      vc({
        id: "vc-text",
        template: { id: "text.block", version: 1 },
        layer: "overlay",
        input: { text: "タイトル", role: "title", anchor: "center" },
      }),
    ];
    const values = toFormValues(base);
    const cue = values.scenes[0]!.cues[0]!;
    expect(cue.fields.text).toBe("タイトル");
    expect(cue.fields.role).toBe("title");
    expect(cue.fields.anchor).toBe("center");
    cue.fields.text = "新しいタイトル";
    cue.fields.fontSize = "72";
    cue.fields["decoration.bold"] = "true";

    const rebuilt = buildContentDocument(base, values);
    const input = rebuilt.scenes[0]!.visualCues[0]!.input as {
      text: string;
      role: string;
      anchor?: string;
      fontSize?: number;
      decoration?: { bold?: boolean };
    };
    expect(input.text).toBe("新しいタイトル");
    expect(input.anchor).toBe("center");
    expect(input.fontSize).toBe(72);
    expect(input.decoration?.bold).toBe(true);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("keeps an unset optional select absent on round-trip", () => {
    const base = createInitialContentDocument();
    base.scenes[0]!.visualCues = [
      vc({
        id: "vc-text",
        template: { id: "text.block", version: 1 },
        layer: "overlay",
        input: { text: "タイトル", role: "title" },
      }),
    ];
    const values = toFormValues(base);
    const cue = values.scenes[0]!.cues[0]!;
    expect(cue.fields.anchor).toBe("");

    const rebuilt = buildContentDocument(base, values);
    const input = rebuilt.scenes[0]!.visualCues[0]!.input as Record<string, unknown>;
    expect("anchor" in input).toBe(false);
    expect("decoration" in input).toBe(false);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("round-trips a site-mockup cue through generic fields", () => {
    const base = createInitialContentDocument();
    base.scenes[0]!.visualCues = [
      vc({
        id: "vc-mockup",
        template: { id: "scene.site-mockup", version: 1 },
        layer: "card",
        input: {
          variant: "qiita",
          theme: "dark",
          name: "kakeai",
          handle: "@kakeai",
          screen: { kind: "media", assetId: "asset-screen", fit: "cover" },
          logo: { kind: "media", assetId: "asset-logo", fit: "contain" },
        },
      }),
    ];
    const values = toFormValues(base);
    const cue = values.scenes[0]!.cues[0]!;
    expect(cue.fields.variant).toBe("qiita");
    expect(cue.fields.theme).toBe("dark");
    expect(cue.fields.screen).toBe("asset-screen");
    expect(cue.fields.logo).toBe("asset-logo");
    cue.fields.variant = "zenn";

    const rebuilt = buildContentDocument(base, values);
    const input = rebuilt.scenes[0]!.visualCues[0]!.input as {
      variant: string;
      screen: { assetId: string };
      logo?: { assetId: string };
    };
    expect(input.variant).toBe("zenn");
    expect(input.screen.assetId).toBe("asset-screen");
    expect(input.logo?.assetId).toBe("asset-logo");
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("initializes site-mockup fields with defaults", () => {
    const cueValue = createCueFormValue({
      sceneId: "scene-intro",
      templateId: "scene.site-mockup",
      templateVersion: 1,
      layer: "card",
      order: 0,
    });
    expect(cueValue.fields.variant).toBe("x");
    expect(cueValue.fields.theme).toBe("");
    expect(cueValue.fields.screen).toBe("");
    expect(cueValue.fields.animation).toBe("none");
  });

  it("allows a site-mockup without a logo", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    values.scenes[0]!.cues = [
      createCueFormValue({
        sceneId: values.scenes[0]!.id,
        templateId: "scene.site-mockup",
        templateVersion: 1,
        layer: "card",
        order: 0,
      }),
    ];
    values.scenes[0]!.cues[0]!.fields.screen = "asset-screen";

    const rebuilt = buildContentDocument(base, values);
    const input = rebuilt.scenes[0]!.visualCues[0]!.input as Record<string, unknown>;
    expect("logo" in input).toBe(false);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("initializes device-frame@2 fields with animation defaults", () => {
    const cueValue = createCueFormValue({
      sceneId: "scene-intro",
      templateId: "scene.device-frame",
      templateVersion: 2,
      layer: "background",
      order: 0,
    });
    expect(cueValue.fields.screen).toBe("");
    expect(cueValue.fields.frame).toBe("laptop");
    expect(cueValue.fields.animation).toBe("none");
    expect(cueValue.fields["animation__duration"]).toBe("400");
  });

  it("clamps device-frame animation duration to the policy maximum", () => {
    const base = createInitialContentDocument();
    base.scenes[0]!.visualCues = [
      vc({
        id: "vc-device",
        template: { id: "scene.device-frame", version: 2 },
        layer: "background",
        input: {
          frame: "laptop",
          screen: { kind: "media", assetId: "asset-screen", fit: "cover" },
          animation: { preset: "fade", durationMs: 100 },
        },
      }),
    ];
    const values = toFormValues(base);
    values.scenes[0]!.cues[0]!.fields["animation__duration"] = "999999";

    const rebuilt = buildContentDocument(base, values);
    const input = rebuilt.scenes[0]!.visualCues[0]!.input as {
      animation: { durationMs: number };
    };
    expect(input.animation.durationMs).toBe(2000);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("omits the animation input when the preset is none", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    values.scenes[0]!.cues = [
      createCueFormValue({
        sceneId: values.scenes[0]!.id,
        templateId: "scene.device-frame",
        templateVersion: 2,
        layer: "background",
        order: 0,
      }),
    ];
    values.scenes[0]!.cues[0]!.fields.screen = "asset-screen";

    const rebuilt = buildContentDocument(base, values);
    const input = rebuilt.scenes[0]!.visualCues[0]!.input as Record<string, unknown>;
    expect("animation" in input).toBe(false);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("round-trips a scene transition and omits it for cut", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    expect(values.scenes[1]!.transitionPreset).toBe("cut");
    values.scenes[1]!.transitionPreset = "crossfade";
    values.scenes[1]!.transitionDurationMs = 300;

    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.scenes[1]!.transition).toEqual({
      enter: { preset: "crossfade", durationMs: 300 },
    });
    expect(rebuilt.scenes[2]!.transition).toBeUndefined();
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("clones a previous point scene's visuals without lines or audio", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    const source = values.scenes[1]!;
    if (source.kind !== "point") {
      throw new Error("fixture changed");
    }
    source.accentColor = "#123456";
    source.transitionPreset = "fade";
    source.transitionDurationMs = 250;
    const sourceLine = createEmptyLine(source.id);
    sourceLine.captionText = "元のセリフ";
    source.lines = [sourceLine];
    source.cues[0]!.rangeKind = "lines";
    source.cues[0]!.startLineId = sourceLine.id;
    source.cues[0]!.endLineId = sourceLine.id;

    const copy = cloneSceneFormValue(source as SceneFormValue & { kind: "point" }, newSceneId());
    expect(copy.kind).toBe("point");
    expect(copy.lines).toEqual([]);
    expect(copy.accentColor).toBe("#123456");
    expect(copy.transitionPreset).toBe("fade");
    expect(copy.transitionDurationMs).toBe(250);
    expect(copy.cues).toHaveLength(source.cues.length);
    expect(copy.cues.some((cue) => source.cues.some((original) => original.id === cue.id))).toBe(
      false,
    );
    expect(copy.cues[0]!.rangeKind).toBe("scene");
    expect(copy.cues[0]!.startLineId).toBe("");

    copy.cues[0]!.fields.text = "複製側の変更";
    expect(source.cues[0]!.fields.text).not.toBe("複製側の変更");

    values.scenes = [values.scenes[0]!, copy, ...values.scenes.slice(1)];
    const rebuilt = buildContentDocument(base, values);
    const cloned = rebuilt.scenes[1]!;
    expect(cloned.kind).toBe("point");
    expect(cloned.accentColor).toBe("#123456");
    expect(cloned.lines).toEqual([]);
    expect(cloned.visualCues).toHaveLength(source.cues.length);
    expect(cloned.transition).toEqual({ enter: { preset: "fade", durationMs: 250 } });
    const cueIds = rebuilt.scenes.flatMap((scene) => scene.visualCues.map((cue) => cue.id));
    expect(new Set(cueIds).size).toBe(cueIds.length);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });
});
