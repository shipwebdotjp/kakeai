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
});
