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
});
