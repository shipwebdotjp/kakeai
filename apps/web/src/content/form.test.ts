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

function standingCue(id: string, side: "left" | "right", scale = 1): VisualCue {
  return vc({
    id,
    template: { id: "character.standing", version: 1 },
    layer: "standing",
    input: {
      characterId: "character-rin",
      appearanceId: "appearance-smile",
      side,
      scale,
    },
  });
}

describe("buildContentDocument", () => {
  it("maps scene values to base scenes by id, not position", () => {
    const base = createInitialContentDocument();
    base.scenes.splice(
      base.scenes.length - 1,
      0,
      createPointScene("scene-point-2", "要点 2"),
      createPointScene("scene-point-3", "要点 3"),
    );
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

  it("round-trips an inserted video scene", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    const insert = createInsertSceneFormValue(
      "動画 1",
      "asset-video-1",
      5000,
      collectSceneIds(values.scenes),
    );
    values.scenes.splice(values.scenes.length - 1, 0, insert);

    const rebuilt = buildContentDocument(base, values);
    const scene = rebuilt.scenes.find((entry) => entry.kind === "insert");
    expect(scene).toMatchObject({
      kind: "insert",
      embeddedAudio: true,
      timing: { mode: "fixed", durationMs: 5000 },
    });
    expect(scene?.visualCues).toHaveLength(1);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("round-trips insert trim and loop cue fields", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    const insert = createInsertSceneFormValue(
      "動画 1",
      "asset-video-1",
      5000,
      collectSceneIds(values.scenes),
    );
    insert.cues[0]!.fields.trimStartMs = "1000";
    insert.cues[0]!.fields.trimEndMs = "4000";
    insert.cues[0]!.fields.loop = "true";
    insert.durationMs = 6000;
    values.scenes.splice(values.scenes.length - 1, 0, insert);

    const rebuilt = buildContentDocument(base, values);
    const scene = rebuilt.scenes.find((entry) => entry.kind === "insert");
    expect(scene?.visualCues[0]?.input).toMatchObject({
      trimStartMs: 1000,
      trimEndMs: 4000,
      loop: true,
    });
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("round-trips insert embedded audio gain and omits zero", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    const insert = createInsertSceneFormValue(
      "動画 1",
      "asset-video-1",
      5000,
      collectSceneIds(values.scenes),
    );
    insert.embeddedAudioGainDb = -6;
    values.scenes.splice(values.scenes.length - 1, 0, insert);
    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.scenes.find((entry) => entry.kind === "insert")).toMatchObject({
      embeddedAudioGainDb: -6,
    });

    const base2 = createInitialContentDocument();
    const values2 = toFormValues(base2);
    const insert2 = createInsertSceneFormValue(
      "動画 1",
      "asset-video-1",
      5000,
      collectSceneIds(values2.scenes),
    );
    values2.scenes.splice(values2.scenes.length - 1, 0, insert2);
    const rebuilt2 = buildContentDocument(base2, values2);
    expect(rebuilt2.scenes.find((entry) => entry.kind === "insert")).not.toHaveProperty(
      "embeddedAudioGainDb",
    );
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

  it("keeps a media cue at @1 and round-trips the loop flag", () => {
    const base = createInitialContentDocument();
    base.scenes[0]!.visualCues = [
      vc({
        id: "vc-bg",
        template: { id: "media.full-bleed", version: 1 },
        input: { assetId: "asset-bg", fit: "cover" },
      }),
    ];

    const values = toFormValues(base);
    const cue = values.scenes[0]!.cues.find((entry) => entry.id === "vc-bg")!;
    expect(cue.templateVersion).toBe(1);
    expect(cue.fields.loop).toBe("");
    cue.fields.loop = "true";

    const rebuilt = buildContentDocument(base, values);
    const rebuiltCue = rebuilt.scenes[0]!.visualCues.find((entry) => entry.id === "vc-bg")!;
    expect(rebuiltCue.template).toEqual({ id: "media.full-bleed", version: 1 });
    expect((rebuiltCue.input as { loop?: boolean }).loop).toBe(true);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("omits the loop key when the toggle is left at default", () => {
    const base = createInitialContentDocument();
    base.scenes[0]!.visualCues = [
      vc({
        id: "vc-bg",
        template: { id: "media.full-bleed", version: 1 },
        input: { assetId: "asset-bg", fit: "cover" },
      }),
    ];

    const rebuilt = buildContentDocument(base, toFormValues(base));
    const rebuiltCue = rebuilt.scenes[0]!.visualCues.find((entry) => entry.id === "vc-bg")!;
    expect(rebuiltCue.template).toEqual({ id: "media.full-bleed", version: 1 });
    expect("loop" in (rebuiltCue.input as Record<string, unknown>)).toBe(false);
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

  it("round-trips a device-frame composition screen with fit, zoom and position", () => {
    const base = createInitialContentDocument();
    base.scenes[0]!.visualCues = [
      vc({
        id: "vc-device-comp",
        template: { id: "scene.device-frame", version: 1 },
        layer: "background",
        input: {
          frame: "laptop",
          screen: {
            kind: "composition",
            compositionVersionId: "cmpver_001",
            fit: "contain",
            zoom: 1.5,
            position: { x: 0.2, y: 0.8 },
          },
        },
      }),
    ];

    const values = toFormValues(base);
    const cue = values.scenes[0]!.cues[0]!;
    expect(cue.fields[`screen${NESTED_MODE_SUFFIX}`]).toBe(NESTED_MODE_COMPOSITION);
    expect(cue.fields[`screen${NESTED_COMPOSITION_VERSION_SUFFIX}`]).toBe("cmpver_001");
    expect(cue.fields[`screen${NESTED_COMPOSITION_FIT_SUFFIX}`]).toBe("contain");
    expect(cue.fields[`screen${NESTED_COMPOSITION_ZOOM_SUFFIX}`]).toBe("150");
    expect(cue.fields[`screen${NESTED_COMPOSITION_POS_X_SUFFIX}`]).toBe("20");
    expect(cue.fields[`screen${NESTED_COMPOSITION_POS_Y_SUFFIX}`]).toBe("80");

    cue.fields[`screen${NESTED_COMPOSITION_ZOOM_SUFFIX}`] = "200";
    const rebuilt = buildContentDocument(base, values);
    const input = rebuilt.scenes[0]!.visualCues[0]!.input as {
      frame: string;
      screen: {
        kind: string;
        compositionVersionId: string;
        fit: string;
        zoom: number;
        position: { x: number; y: number };
      };
    };
    expect(input.screen.kind).toBe("composition");
    expect(input.screen.compositionVersionId).toBe("cmpver_001");
    expect(input.screen.fit).toBe("contain");
    expect(input.screen.zoom).toBe(2);
    expect(input.screen.position).toEqual({ x: 0.2, y: 0.8 });
    expect(input.frame).toBe("laptop");
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("switches a media device screen to a composition", () => {
    const base = createInitialContentDocument();
    base.scenes[0]!.visualCues = [
      vc({
        id: "vc-device",
        template: { id: "scene.device-frame", version: 1 },
        layer: "card",
        input: { frame: "phone", screen: { kind: "media", assetId: "asset-screen", fit: "cover" } },
      }),
    ];

    const values = toFormValues(base);
    const cue = values.scenes[0]!.cues[0]!;
    cue.fields[`screen${NESTED_MODE_SUFFIX}`] = NESTED_MODE_COMPOSITION;
    cue.fields[`screen${NESTED_COMPOSITION_VERSION_SUFFIX}`] = "cmpver_002";
    cue.fields[`screen${NESTED_COMPOSITION_FIT_SUFFIX}`] = "cover";

    const rebuilt = buildContentDocument(base, values);
    const input = rebuilt.scenes[0]!.visualCues[0]!.input as {
      screen: { kind: string; compositionVersionId: string; fit: string };
    };
    expect(input.screen.kind).toBe("composition");
    expect(input.screen.compositionVersionId).toBe("cmpver_002");
    expect(input.screen.fit).toBe("cover");
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("rejects a new device screen in composition mode without a selected version", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    const cue = createCueFormValue({
      sceneId: values.scenes[0]!.id,
      templateId: "scene.device-frame",
      templateVersion: 1,
      layer: "background",
      order: 0,
    });
    cue.fields[`screen${NESTED_MODE_SUFFIX}`] = NESTED_MODE_COMPOSITION;
    values.scenes[0]!.cues = [cue];
    expect(() => buildContentDocument(base, values)).toThrow();
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
    values.scenes.splice(
      outroIndex,
      0,
      createPointSceneFormValue("要点 2", collectSceneIds(values.scenes)),
    );

    const rebuilt = buildContentDocument(base, values);
    expect(pointScenes(rebuilt)).toHaveLength(2);
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

  function fullBleedCue(values: ReturnType<typeof toFormValues>) {
    const cue = values.scenes[0]!.cues.find((entry) => entry.templateId === "media.full-bleed");
    if (cue === undefined) {
      throw new Error("media.full-bleed cue not found");
    }
    return cue;
  }

  it("reads focalPoint into mediaCrop form fields as percentages", () => {
    const base = createInitialContentDocument();
    base.scenes[0]!.visualCues = [
      vc({
        id: "vc-bg",
        template: { id: "media.full-bleed", version: 1 },
        input: { assetId: "asset-bg", fit: "cover", focalPoint: { x: 0.25, y: 0.6 } },
      }),
    ];
    const cue = fullBleedCue(toFormValues(base));
    expect(cue.fields["focalPoint__x"]).toBe("25");
    expect(cue.fields["focalPoint__y"]).toBe("60");
  });

  it("omits focalPoint when both axes are unset", () => {
    const base = createInitialContentDocument();
    base.scenes[0]!.visualCues = [
      vc({
        id: "vc-bg",
        template: { id: "media.full-bleed", version: 1 },
        input: { assetId: "asset-bg", fit: "cover" },
      }),
    ];
    const values = toFormValues(base);
    const cue = fullBleedCue(values);
    expect(cue.fields["focalPoint__x"]).toBe("");
    expect(cue.fields["focalPoint__y"]).toBe("");
    const rebuilt = buildContentDocument(base, values);
    expect(
      (rebuilt.scenes[0]!.visualCues[0]!.input as { focalPoint?: unknown }).focalPoint,
    ).toBeUndefined();
  });

  it("drops focalPoint when both axes are reset to center", () => {
    const base = createInitialContentDocument();
    base.scenes[0]!.visualCues = [
      vc({
        id: "vc-bg",
        template: { id: "media.full-bleed", version: 1 },
        input: { assetId: "asset-bg", fit: "cover", focalPoint: { x: 0.2, y: 0.8 } },
      }),
    ];
    const values = toFormValues(base);
    const cue = fullBleedCue(values);
    cue.fields["focalPoint__x"] = "";
    cue.fields["focalPoint__y"] = "";
    const rebuilt = buildContentDocument(base, values);
    expect(
      (rebuilt.scenes[0]!.visualCues[0]!.input as { focalPoint?: unknown }).focalPoint,
    ).toBeUndefined();
  });

  it("rejects a focalPoint with only one axis", () => {
    const base = createInitialContentDocument();
    base.scenes[0]!.visualCues = [
      vc({
        id: "vc-bg",
        template: { id: "media.full-bleed", version: 1 },
        input: { assetId: "asset-bg", fit: "cover" },
      }),
    ];
    const values = toFormValues(base);
    fullBleedCue(values).fields["focalPoint__x"] = "10";
    expect(() => buildContentDocument(base, values)).toThrow();
  });

  it("rejects a focalPoint percent outside 0-100", () => {
    const base = createInitialContentDocument();
    base.scenes[0]!.visualCues = [
      vc({
        id: "vc-bg",
        template: { id: "media.full-bleed", version: 1 },
        input: { assetId: "asset-bg", fit: "cover" },
      }),
    ];
    const values = toFormValues(base);
    const cue = fullBleedCue(values);
    cue.fields["focalPoint__x"] = "120";
    cue.fields["focalPoint__y"] = "50";
    expect(() => buildContentDocument(base, values)).toThrow();
  });

  it("reads and writes media zoom", () => {
    const base = createInitialContentDocument();
    base.scenes[0]!.visualCues = [
      vc({
        id: "vc-bg",
        template: { id: "media.full-bleed", version: 1 },
        input: { assetId: "asset-bg", fit: "cover", zoom: 1.5 },
      }),
    ];
    const values = toFormValues(base);
    const cue = fullBleedCue(values);
    expect(cue.fields["focalPoint__zoom"]).toBe("150");
    const rebuilt = buildContentDocument(base, values);
    expect((rebuilt.scenes[0]!.visualCues[0]!.input as { zoom?: unknown }).zoom).toBe(1.5);
  });

  it("omits zoom when unset and drops it when reset to 100%", () => {
    const base = createInitialContentDocument();
    base.scenes[0]!.visualCues = [
      vc({
        id: "vc-bg",
        template: { id: "media.full-bleed", version: 1 },
        input: { assetId: "asset-bg", fit: "cover", zoom: 2 },
      }),
    ];
    const values = toFormValues(base);
    const cue = fullBleedCue(values);
    cue.fields["focalPoint__zoom"] = "";
    const rebuilt = buildContentDocument(base, values);
    expect(
      (rebuilt.scenes[0]!.visualCues[0]!.input as { zoom?: unknown }).zoom,
    ).toBeUndefined();
  });

  it("keeps zoom independent from focalPoint and rejects out-of-range zoom", () => {
    const base = createInitialContentDocument();
    base.scenes[0]!.visualCues = [
      vc({
        id: "vc-bg",
        template: { id: "media.full-bleed", version: 1 },
        input: { assetId: "asset-bg", fit: "cover" },
      }),
    ];
    const values = toFormValues(base);
    const cue = fullBleedCue(values);
    cue.fields["focalPoint__zoom"] = "200";
    const rebuilt = buildContentDocument(base, values);
    const input = rebuilt.scenes[0]!.visualCues[0]!.input as { focalPoint?: unknown; zoom?: unknown };
    expect(input.focalPoint).toBeUndefined();
    expect(input.zoom).toBe(2);

    cue.fields["focalPoint__zoom"] = "400";
    expect(() => buildContentDocument(base, values)).toThrow();
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
        expressionId: null,
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
        expressionId: null,
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

  it("omits a zero narration gap and round-trips a positive one", () => {
    const base = createInitialContentDocument();
    const point = pointScenes(base)[0]!;
    point.lines = [
      {
        id: "l1",
        speakerId: null,
        captionText: "間あり",
        speechText: "まあり",
        selectedAudioTakeId: null,
        expressionId: null,
        gapBeforeMs: 800,
      },
    ];

    const values = toFormValues(base);
    expect(values.scenes.find((scene) => scene.id === point.id)?.lines[0]?.gapBeforeMs).toBe(800);

    const rebuilt = buildContentDocument(base, values);
    expect(pointScenes(rebuilt)[0]!.lines[0]!.gapBeforeMs).toBe(800);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);

    values.scenes.find((scene) => scene.id === point.id)!.lines[0]!.gapBeforeMs = 0;
    const zeroed = buildContentDocument(base, values);
    expect("gapBeforeMs" in pointScenes(zeroed)[0]!.lines[0]!).toBe(false);
    expect(contentDocumentSchema.safeParse(zeroed).success).toBe(true);
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
        expressionId: null,
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

  it("round-trips scene audio cues independently from work BGM", () => {
    const base = createInitialContentDocument();
    const point = pointScenes(base)[0]!;
    base.audioCues = [
      { id: "cue-work", role: "bgm", assetId: "asset-bgm", range: { kind: "work" }, gainDb: -18, loop: true },
      {
        id: "cue-scene",
        role: "program",
        assetId: "asset-audio-1",
        range: { kind: "scene", sceneId: point.id },
        gainDb: 0,
        loop: false,
      },
    ];

    const values = toFormValues(base);
    const sceneValue = values.scenes.find((scene) => scene.id === point.id)!;
    expect(sceneValue.audioCues).toEqual([
      { cueId: "cue-scene", assetId: "asset-audio-1", role: "program", gainDb: 0, loop: false },
    ]);

    sceneValue.audioCues[0]!.role = "sfx";
    sceneValue.audioCues[0]!.gainDb = -6;
    sceneValue.audioCues[0]!.loop = true;
    values.bgm.gainDb = -12;

    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.audioCues.find((cue) => cue.id === "cue-scene")).toMatchObject({
      role: "sfx",
      gainDb: -6,
      loop: true,
      range: { kind: "scene", sceneId: point.id },
    });
    expect(rebuilt.audioCues.find((cue) => cue.id === "cue-work")).toMatchObject({ gainDb: -12 });
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("adds and removes a scene audio cue", () => {
    const base = createInitialContentDocument();
    const point = pointScenes(base)[0]!;
    const values = toFormValues(base);
    values.scenes.find((scene) => scene.id === point.id)!.audioCues.push({
      cueId: null,
      assetId: "asset-audio-1",
      role: "sfx",
      gainDb: 0,
      loop: false,
    });

    const rebuilt = buildContentDocument(base, values);
    const added = rebuilt.audioCues.filter(
      (cue) => cue.range.kind === "scene" && cue.range.sceneId === point.id,
    );
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ role: "sfx", assetId: "asset-audio-1" });

    values.scenes.find((scene) => scene.id === point.id)!.audioCues = [];
    const cleared = buildContentDocument(base, values);
    expect(cleared.audioCues.filter((cue) => cue.range.kind === "scene")).toHaveLength(0);
    expect(contentDocumentSchema.safeParse(cleared).success).toBe(true);
  });

  it("round-trips characters and a scene standing cue", () => {
    const base = createInitialContentDocument();
    base.characters = [
      {
        id: "character-rin",
        name: "リン",
        voices: [],
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null },
        ],
      },
    ];
    base.scenes[1]!.visualCues = [standingCue("vc-standing", "right")];

    const values = toFormValues(base);
    expect(values.characters).toEqual([
      {
        id: "character-rin",
        name: "リン",
        voiceProfileId: null,
        voices: [],
        appearances: [
          {
            id: "appearance-smile",
            assetId: "asset-rin",
            expression: "smile",
            pose: "front",
            label: "",
            faceSetId: null,
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
        voices: [],
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null },
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
        voices: [],
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null },
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
        voices: [],
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null },
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
        voices: [],
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null },
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
        voices: [],
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null },
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
        voices: [],
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null },
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
    });
    const extraCue = byId.get("vc-standing-extra")!;
    expect(extraCue.template).toEqual({ id: "character.standing", version: 1 });
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
        voices: [],
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null },
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
        voiceProfileId: null,
        voices: [],
        appearances: [
          { id: "appearance-1", assetId: "asset-rin", expression: "  ", pose: "", label: "", faceSetId: null },
        ],
      },
    ];

    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.characters[0]!.appearances[0]).toEqual({
      id: "appearance-1",
      assetId: "asset-rin",
      expression: "normal",
      pose: "front",
      faceSetId: null,
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
        voices: [],
        appearances: [
          { id: "appearance-rin", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: "faceset-rin" },
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
        voices: [],
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null },
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
        voiceProfileId: null,
        voices: [],
        appearances: [
          { id: "appearance-1", assetId: null, expression: "", pose: "", label: "", faceSetId: null },
        ],
      },
    ];

    expect(() => buildContentDocument(base, values)).toThrow();
  });

  it("round-trips a character voice profile through its speaker", () => {
    const base = createInitialContentDocument();
    base.characters = [{ id: "character-rin", name: "リン", voices: [], appearances: [] }];
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
        voices: [
          { locale: "ja-JP", voiceProfileId: "vp-1" },
          { locale: "en-US", voiceProfileId: "vp-2" },
        ],
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
      voiceProfileId: null,
      voices: [],
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
        voices: [],
        appearances: [
          { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null },
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

  it("initializes device-frame@1 fields with animation defaults", () => {
    const cueValue = createCueFormValue({
      sceneId: "scene-intro",
      templateId: "scene.device-frame",
      templateVersion: 1,
      layer: "background",
      order: 0,
    });
    expect(cueValue.fields.screen).toBe("");
    expect(cueValue.fields.frame).toBe("laptop");
    expect(cueValue.fields.animation).toBe("none");
    expect(cueValue.fields["animation__duration"]).toBe("400");
  });

  it("creates new cues with the none enter and exit defaults", () => {
    const cueValue = createCueFormValue({
      sceneId: "scene-intro",
      templateId: "text.block",
      templateVersion: 1,
      layer: "overlay",
      order: 0,
    });
    expect(cueValue.enterPreset).toBe("none");
    expect(cueValue.enterDurationMs).toBe(0);
    expect(cueValue.exitPreset).toBe("none");
    expect(cueValue.exitDurationMs).toBe(0);
  });

  it("clamps device-frame animation duration to the policy maximum", () => {
    const base = createInitialContentDocument();
    base.scenes[0]!.visualCues = [
      vc({
        id: "vc-device",
        template: { id: "scene.device-frame", version: 1 },
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
        templateVersion: 1,
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
    source.accentKind = "custom";
    source.accentColor = "#123456";
    source.transitionPreset = "fade";
    source.transitionDurationMs = 250;
    const sourceLine = createEmptyLine(source.id, collectLineIds(values.scenes));
    sourceLine.captionText = "元のセリフ";
    source.lines = [sourceLine];
    source.cues[0]!.rangeKind = "lines";
    source.cues[0]!.startLineId = sourceLine.id;
    source.cues[0]!.endLineId = sourceLine.id;

    const copy = cloneSceneFormValue(
      source as SceneFormValue & { kind: "point" },
      newSceneId(collectSceneIds(values.scenes)),
      "要点 2",
    );
    expect(copy.kind).toBe("point");
    expect(copy.lines).toEqual([]);
    expect(copy.accentKind).toBe("custom");
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
    expect(cloned.accent).toEqual({ kind: "custom", color: "#123456" });
    expect(cloned.lines).toEqual([]);
    expect(cloned.visualCues).toHaveLength(source.cues.length);
    expect(cloned.transition).toEqual({ enter: { preset: "fade", durationMs: 250 } });
    const cueIds = rebuilt.scenes.flatMap((scene) => scene.visualCues.map((cue) => cue.id));
    expect(new Set(cueIds).size).toBe(cueIds.length);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });
});

describe("scene accent", () => {
  it("reads theme and custom accents into the form", () => {
    const base = createInitialContentDocument();
    base.scenes[1]!.accent = { kind: "theme", token: "secondary" };
    base.scenes[2]!.accent = { kind: "custom", color: "#123ABC" };
    const values = toFormValues(base);
    expect(values.scenes[1]).toMatchObject({
      accentKind: "theme",
      accentToken: "secondary",
      accentColor: "",
    });
    expect(values.scenes[2]).toMatchObject({
      accentKind: "custom",
      accentColor: "#123ABC",
    });
  });

  it("round-trips a theme token accent", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    values.scenes[1]!.accentKind = "theme";
    values.scenes[1]!.accentToken = "tertiary";
    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.scenes[1]!.accent).toEqual({ kind: "theme", token: "tertiary" });
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("normalizes a custom accent color to uppercase", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    values.scenes[1]!.accentKind = "custom";
    values.scenes[1]!.accentColor = "#abcdef";
    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.scenes[1]!.accent).toEqual({ kind: "custom", color: "#ABCDEF" });
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("falls back to the theme default for an empty custom color", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    values.scenes[1]!.accentKind = "custom";
    values.scenes[1]!.accentColor = "";
    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.scenes[1]!.accent).toEqual({ kind: "theme", token: "primary" });
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("keeps explicit text cue styles through a form round-trip", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    const cue = values.scenes[1]!.cues[0]!;
    cue.fields.text = "見出し";
    cue.fields.role = "heading";
    cue.fields.font = "serif";
    cue.fields.fontSize = "80";
    cue.fields.color = "#FF0000";
    cue.fields["decoration.bold"] = "true";
    cue.fields["decoration.italic"] = "";
    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.scenes[1]!.visualCues[0]!.input).toEqual({
      text: "見出し",
      role: "heading",
      font: "serif",
      fontSize: 80,
      color: "#FF0000",
      decoration: { bold: true },
    });
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });
});

describe("table.simple form", () => {
  const tableInput = {
    caption: "料金プラン",
    data: {
      columns: [
        { key: "name", label: "プラン", type: "text" },
        { key: "price", label: "月額", type: "number", format: "currency" },
      ],
      rows: [
        { name: "Free", price: 0 },
        { name: "Pro", price: 1500 },
      ],
    },
    style: { preset: "clean", zebra: true, headerAccent: "primary" },
    effects: [
      {
        target: { kind: "rows" },
        trigger: { kind: "cue" },
        effect: { kind: "appear", preset: "fade", durationMs: 400, staggerMs: 150 },
      },
    ],
  };

  function tableCue() {
    return vc({
      id: "vc-table",
      template: { id: "table.simple", version: 1 },
      layer: "overlay",
      input: structuredClone(tableInput),
    });
  }

  it("round-trips table data and nested style/effects fields", () => {
    const base = createInitialContentDocument();
    base.scenes[1]!.visualCues = [tableCue()];
    const values = toFormValues(base);
    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.scenes[1]!.visualCues[0]!.input).toEqual(tableInput);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("reads nested select fields with defaults and writes them back", () => {
    const base = createInitialContentDocument();
    const input = structuredClone(tableInput) as Record<string, unknown>;
    delete (input as { style?: unknown }).style;
    delete (input as { effects?: unknown }).effects;
    base.scenes[1]!.visualCues = [vc({
      id: "vc-table",
      template: { id: "table.simple", version: 1 },
      layer: "overlay",
      input,
    })];
    const values = toFormValues(base);
    const cue = values.scenes[1]!.cues[0]!;
    expect(cue.fields["style.preset"]).toBe("clean");
    expect(cue.fields["style.headerAccent"]).toBe("");
    expect(cue.fields["style.zebra"]).toBe("");
    cue.fields["style.headerAccent"] = "secondary";
    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.scenes[1]!.visualCues[0]!.input).toEqual({
      caption: tableInput.caption,
      data: tableInput.data,
      style: { preset: "clean", headerAccent: "secondary" },
    });
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("rejects malformed table data on save", () => {
    const base = createInitialContentDocument();
    base.scenes[1]!.visualCues = [tableCue()];
    const values = toFormValues(base);
    values.scenes[1]!.cues[0]!.fields.data = JSON.stringify({ columns: [], rows: [] });
    expect(() => buildContentDocument(base, values)).toThrow();
  });

  it("creates new table cues with starter data", () => {
    const cue = createCueFormValue({
      sceneId: "scene-point-1",
      templateId: "table.simple",
      templateVersion: 1,
      layer: "overlay",
      order: 0,
    });
    const parsed = JSON.parse(cue.fields.data ?? "") as { columns: unknown[]; rows: unknown[] };
    expect(parsed.columns).toHaveLength(2);
    expect(parsed.rows).toHaveLength(1);
  });

  it("round-trips a spotlight emphasis with an onset", () => {
    const base = createInitialContentDocument();
    const input = {
      ...structuredClone(tableInput),
      effects: [
        {
          target: { kind: "row", index: 1 },
          trigger: { kind: "cue" },
          effect: {
            kind: "emphasize",
            style: "spotlight",
            tone: "warning",
            onset: { preset: "sweep", durationMs: 600 },
          },
        },
      ],
    };
    base.scenes[1]!.visualCues = [
      vc({
        id: "vc-table",
        template: { id: "table.simple", version: 1 },
        layer: "overlay",
        input,
      }),
    ];
    const rebuilt = buildContentDocument(base, toFormValues(base));
    expect(rebuilt.scenes[1]!.visualCues[0]!.input).toEqual(input);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });
});

describe("chart.bar form", () => {
  const chartInput = {
    title: "月別",
    data: {
      columns: [
        { key: "month", label: "月", type: "text" },
        { key: "sales", label: "売上", type: "number", format: "currency" },
      ],
      rows: [
        { month: "1月", sales: 100 },
        { month: "2月", sales: 200 },
      ],
    },
    style: { preset: "grid", orientation: "vertical", valueLabels: true, colorBy: "category" },
    effects: [
      {
        target: { kind: "bars" },
        trigger: { kind: "cue" },
        effect: { kind: "appear", preset: "grow", durationMs: 600, staggerMs: 120 },
      },
    ],
  };

  it("round-trips chart data and nested fields", () => {
    const base = createInitialContentDocument();
    base.scenes[1]!.visualCues = [
      vc({
        id: "vc-chart",
        template: { id: "chart.bar", version: 1 },
        layer: "overlay",
        input: structuredClone(chartInput),
      }),
    ];
    const values = toFormValues(base);
    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.scenes[1]!.visualCues[0]!.input).toEqual(chartInput);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("reads grid data into a json field and writes it back", () => {
    const base = createInitialContentDocument();
    base.scenes[1]!.visualCues = [
      vc({
        id: "vc-chart",
        template: { id: "chart.bar", version: 1 },
        layer: "overlay",
        input: structuredClone(chartInput),
      }),
    ];
    const values = toFormValues(base);
    const cue = values.scenes[1]!.cues[0]!;
    const parsed = JSON.parse(cue.fields.data ?? "") as { rows: unknown[] };
    expect(parsed.rows).toHaveLength(2);
    cue.fields["style.orientation"] = "horizontal";
    const rebuilt = buildContentDocument(base, values);
    expect(
      (rebuilt.scenes[1]!.visualCues[0]!.input as { style: { orientation: string } }).style
        .orientation,
    ).toBe("horizontal");
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("normalizes legacy chart effect presets on read", () => {
    const base = createInitialContentDocument();
    base.scenes[1]!.visualCues = [
      vc({
        id: "vc-chart",
        template: { id: "chart.bar", version: 1 },
        layer: "overlay",
        input: {
          data: {
            columns: [
              { key: "month", label: "月", type: "text" },
              { key: "sales", label: "売上", type: "number" },
            ],
            rows: [{ month: "1月", sales: 1 }],
          },
          effects: [
            {
              target: { kind: "bars" },
              trigger: { kind: "cue" },
              effect: { kind: "appear", preset: "slide-up", durationMs: 400 },
            },
          ],
        },
      }),
    ];
    const values = toFormValues(base);
    const parsed = JSON.parse(values.scenes[1]!.cues[0]!.fields.effects!) as {
      effect: { preset: string };
    }[];
    expect(parsed[0]!.effect.preset).toBe("fade");
    const rebuilt = buildContentDocument(base, values);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("creates new chart cues with a valid starter grid", () => {
    const cue = createCueFormValue({
      sceneId: "scene-point-1",
      templateId: "chart.bar",
      templateVersion: 1,
      layer: "overlay",
      order: 0,
    });
    const parsed = JSON.parse(cue.fields.data ?? "") as {
      columns: { type: string }[];
      rows: unknown[];
    };
    expect(parsed.columns).toHaveLength(2);
    expect(parsed.columns[0]!.type).toBe("text");
    expect(parsed.columns[1]!.type).toBe("number");
    expect(parsed.rows).toHaveLength(1);
  });

  it("round-trips a chart emphasize effect", () => {
    const base = createInitialContentDocument();
    const input = {
      ...structuredClone(chartInput),
      effects: [
        {
          target: { kind: "category", index: 1 },
          trigger: { kind: "cue" },
          effect: { kind: "emphasize", style: "spotlight", tone: "info" },
        },
      ],
    };
    base.scenes[1]!.visualCues = [
      vc({
        id: "vc-chart",
        template: { id: "chart.bar", version: 1 },
        layer: "overlay",
        input,
      }),
    ];
    const rebuilt = buildContentDocument(base, toFormValues(base));
    expect(rebuilt.scenes[1]!.visualCues[0]!.input).toEqual(input);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });
});

describe("flow.diagram form", () => {
  const flowInput = {
    title: "処理の流れ",
    diagram: {
      nodes: [{ label: "受付" }, { label: "審査", caption: "窓口" }, { label: "完了" }],
      edges: [
        { from: 0, to: 1, label: "書類" },
        { from: 1, to: 2 },
      ],
    },
    style: { orientation: "vertical", preset: "boxed" },
    effects: [
      {
        target: { kind: "nodes" },
        trigger: { kind: "cue" },
        effect: { kind: "appear", preset: "fade", durationMs: 400, staggerMs: 120 },
      },
    ],
  };

  it("round-trips the flow diagram and effects", () => {
    const base = createInitialContentDocument();
    base.scenes[1]!.visualCues = [
      vc({
        id: "vc-flow",
        template: { id: "flow.diagram", version: 1 },
        layer: "overlay",
        input: structuredClone(flowInput),
      }),
    ];
    const rebuilt = buildContentDocument(base, toFormValues(base));
    expect(rebuilt.scenes[1]!.visualCues[0]!.input).toEqual(flowInput);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("creates new flow cues with a starter diagram", () => {
    const cue = createCueFormValue({
      sceneId: "scene-point-1",
      templateId: "flow.diagram",
      templateVersion: 1,
      layer: "overlay",
      order: 0,
    });
    const parsed = JSON.parse(cue.fields.diagram ?? "") as {
      nodes: unknown[];
      edges: unknown[];
    };
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.edges).toHaveLength(1);
  });
});

describe("stat form", () => {
  const statInput = {
    value: 1200,
    label: "導入社数",
    format: "integer",
    style: { tone: "primary", preset: "card" },
    effects: [{ trigger: { kind: "cue" }, effect: { kind: "value", durationMs: 1000 } }],
  };

  it("round-trips the stat value, format, and count-up effect", () => {
    const base = createInitialContentDocument();
    base.scenes[1]!.visualCues = [
      vc({
        id: "vc-stat",
        template: { id: "stat", version: 1 },
        layer: "overlay",
        input: structuredClone(statInput),
      }),
    ];
    const rebuilt = buildContentDocument(base, toFormValues(base));
    expect(rebuilt.scenes[1]!.visualCues[0]!.input).toEqual(statInput);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("creates new stat cues with a starter value and count-up effect", () => {
    const cue = createCueFormValue({
      sceneId: "scene-point-1",
      templateId: "stat",
      templateVersion: 1,
      layer: "overlay",
      order: 0,
    });
    expect(cue.fields.value).toBe("0");
    const effects = JSON.parse(cue.fields.effects ?? "") as { effect: { kind: string } }[];
    expect(effects[0]!.effect.kind).toBe("value");
  });

  it("round-trips a count-up value effect on a numeric table cell", () => {
    const base = createInitialContentDocument();
    const input = {
      data: {
        columns: [
          { key: "name", label: "項目", type: "text" },
          { key: "count", label: "件数", type: "number" },
        ],
        rows: [{ name: "a", count: 120 }],
      },
      style: { preset: "clean" },
      effects: [
        {
          target: { kind: "cell", row: 0, key: "count" },
          trigger: { kind: "cue" },
          effect: { kind: "value", durationMs: 800 },
        },
      ],
    };
    base.scenes[1]!.visualCues = [
      vc({
        id: "vc-table",
        template: { id: "table.simple", version: 1 },
        layer: "overlay",
        input,
      }),
    ];
    const rebuilt = buildContentDocument(base, toFormValues(base));
    expect(rebuilt.scenes[1]!.visualCues[0]!.input).toEqual(input);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });
});

describe("quote form", () => {
  const quoteInput = {
    quote: "再利用できる",
    author: "山田太郎",
    source: "設計資料",
    style: { tone: "secondary", preset: "card" },
    effects: [
      {
        trigger: { kind: "lines", startLineId: "line-1", endLineId: "line-1" },
        effect: { kind: "emphasize", style: "spotlight", tone: "primary" },
      },
    ],
  };

  it("round-trips the quote, author, source, and a line-triggered effect", () => {
    const base = createInitialContentDocument();
    base.scenes[1]!.lines = [
      {
        id: "line-1",
        speakerId: null,
        captionText: "a",
        speechText: "a",
        selectedAudioTakeId: null,
        expressionId: null,
      },
    ];
    base.scenes[1]!.visualCues = [
      vc({
        id: "vc-quote",
        template: { id: "quote", version: 1 },
        layer: "overlay",
        input: structuredClone(quoteInput),
      }),
    ];
    const rebuilt = buildContentDocument(base, toFormValues(base));
    expect(rebuilt.scenes[1]!.visualCues[0]!.input).toEqual(quoteInput);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("creates new quote cues with a card-appear effect", () => {
    const cue = createCueFormValue({
      sceneId: "scene-point-1",
      templateId: "quote",
      templateVersion: 1,
      layer: "overlay",
      order: 0,
    });
    const effects = JSON.parse(cue.fields.effects ?? "") as { effect: { kind: string } }[];
    expect(effects[0]!.effect.kind).toBe("appear");
  });
});

describe("compositionVersionOptions", () => {
  const landscape = {
    id: "cmp-1",
    name: "Landscape",
    runtimeCompositionId: "cmp.landscape",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    versions: [
      {
        id: "ver-landscape",
        compositionId: "cmp-1",
        versionNumber: 1,
        bundleHash: "hash-l",
        storageKey: "compositions/bundles/hash-l",
        manifest: {
          entrypoint: "index.html",
          runtimeCompositionId: "cmp.landscape",
          width: 1920,
          height: 1080,
          durationMs: 5000,
          dependencies: [],
        },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  } satisfies Composition;

  const portrait = {
    id: "cmp-2",
    name: "Portrait",
    runtimeCompositionId: "cmp.portrait",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    versions: [
      {
        id: "ver-portrait",
        compositionId: "cmp-2",
        versionNumber: 2,
        bundleHash: "hash-p",
        storageKey: "compositions/bundles/hash-p",
        manifest: {
          entrypoint: "index.html",
          runtimeCompositionId: "cmp.portrait",
          canvasProfile: "portrait",
          width: 1080,
          height: 1920,
          durationMs: 5000,
          dependencies: [],
        },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  } satisfies Composition;

  it("labels versions with their canvas profile", () => {
    const options = compositionVersionOptions([landscape, portrait]);
    expect(options.map((option) => option.value)).toEqual(["ver-landscape", "ver-portrait"]);
    expect(options[0]!.label).toContain("横長");
    expect(options[1]!.label).toContain("縦長");
  });

  it("filters to the requested profiles", () => {
    const options = compositionVersionOptions([landscape, portrait], ["landscape"]);
    expect(options.map((option) => option.value)).toEqual(["ver-landscape"]);
  });

  it("treats a legacy manifest without a profile as landscape", () => {
    const options = compositionVersionOptions([landscape], ["landscape"]);
    expect(options).toHaveLength(1);
  });
});

describe("video playback form fields", () => {
  function gatedScene() {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    const scene = values.scenes[1]!;
    const line = createEmptyLine(scene.id, collectLineIds(values.scenes));
    line.captionText = "セリフ";
    scene.lines = [line];
    const cue = createCueFormValue({
      sceneId: scene.id,
      templateId: "media.full-bleed",
      templateVersion: 1,
      layer: "background",
      order: 0,
    });
    cue.fields.assetId = "asset-video";
    cue.fields["assetId__videoPlayback"] = JSON.stringify({
      mode: "gated",
      sourceEndMs: 4000,
      gates: [
        {
          narrationSegmentId: line.id,
          sourceMs: 0,
          audio: { enabled: true, gainDb: -6, fadeInMs: 200, fadeOutMs: 200 },
        },
      ],
    });
    scene.cues = [cue];
    return { base, values, scene, line };
  }

  it("round-trips videoPlayback through the form", () => {
    const { base, values, line } = gatedScene();
    const rebuilt = buildContentDocument(base, values);
    const rebuiltScene = rebuilt.scenes[1]!;
    expect(rebuiltScene.visualCues[0]!.input).toMatchObject({
      assetId: "asset-video",
      videoPlayback: {
        mode: "gated",
        sourceEndMs: 4000,
        gates: [{ narrationSegmentId: line.id, sourceMs: 0 }],
      },
    });
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);

    const reread = toFormValues(rebuilt);
    const rereadCue = reread.scenes[1]!.cues[0]!;
    expect(rereadCue.fields["assetId__videoPlayback"]).toContain("\"mode\":\"gated\"");
  });

  it("omits videoPlayback when the gated field is cleared", () => {
    const { base, values, scene } = gatedScene();
    scene.cues[0]!.fields["assetId__videoPlayback"] = "";
    const rebuilt = buildContentDocument(base, values);
    expect(
      (rebuilt.scenes[1]!.visualCues[0]!.input as { videoPlayback?: unknown }).videoPlayback,
    ).toBeUndefined();
  });

  it("drops gates that reference a removed line", () => {
    const { scene, line } = gatedScene();
    const second = createEmptyLine(scene.id, collectLineIds([scene]));
    second.captionText = "2つ目";
    scene.lines = [line, second];
    scene.cues[0]!.fields["assetId__videoPlayback"] = JSON.stringify({
      mode: "gated",
      gates: [
        { narrationSegmentId: line.id, sourceMs: 0 },
        { narrationSegmentId: second.id, sourceMs: 1000 },
      ],
    });

    const pruned = pruneDraftCueForLines(
      scene.cues[0]!,
      new Set([line.id]),
    );
    const playback = pruned.fields["assetId__videoPlayback"] ?? "";
    expect(playback).toContain(line.id);
    expect(playback).not.toContain(second.id);
  });
});

