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

  it("duplicates a saved cue at the end of the same layer", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    const scene = values.scenes[1]!;
    const source = scene.cues[0]!;
    expect(source.baseCue).not.toBeNull();

    const copy = duplicateCueFormValue(source, scene.id, scene.cues);
    expect(copy).not.toBeNull();
    expect(copy!.id).not.toBe(source.id);
    expect(copy!.templateId).toBe(source.templateId);
    expect(copy!.layer).toBe(source.layer);
    expect(copy!.rangeKind).toBe(source.rangeKind);
    expect(copy!.fields).toEqual(source.fields);
    expect(copy!.fields).not.toBe(source.fields);
    const maxOrder = Math.max(...scene.cues.filter((cue) => cue.layer === source.layer).map((cue) => cue.order));
    expect(copy!.order).toBe(maxOrder + 1);

    copy!.fields.text = "複製側の変更";
    expect(source.fields.text).not.toBe("複製側の変更");

    scene.cues = [...scene.cues, copy!];
    const rebuilt = buildContentDocument(base, values);
    const ids = rebuilt.scenes.flatMap((entry) => entry.visualCues.map((cue) => cue.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("refuses to duplicate an unsaved draft cue", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    const scene = values.scenes[1]!;
    const draft = createCueFormValue({
      sceneId: scene.id,
      templateId: "text.block",
      templateVersion: 1,
      layer: "background",
      order: 99,
    });
    expect(duplicateCueFormValue(draft, scene.id, [...scene.cues, draft])).toBeNull();
  });
});
