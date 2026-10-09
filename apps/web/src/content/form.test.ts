import { describe, expect, it } from "vitest";
import {
  contentDocumentSchema,
  createInitialContentDocument,
  type ContentDocument,
  type PointScene,
} from "@kakeai/contracts";
import {
  buildContentDocument,
  createPointSceneFormValue,
  toFormValues,
} from "./form";

function pointScenes(document: ContentDocument): PointScene[] {
  return document.scenes.filter((scene): scene is PointScene => scene.kind === "point");
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
});
