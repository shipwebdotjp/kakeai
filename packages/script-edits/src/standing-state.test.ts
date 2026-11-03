import { describe, expect, it } from "vitest";
import {
  contentDocumentSchema,
  createInitialContentDocument,
  DEFAULT_SCENE_IDS,
  type ContentDocument,
  type NarrationSegment,
  type PointScene,
} from "@kakeai/contracts";
import { applyScriptOperation } from "./apply.ts";
import { createTestContext } from "./testing.ts";

function line(id: string, caption: string): NarrationSegment {
  return {
    id,
    speakerId: null,
    captionText: caption,
    speechText: caption,
    selectedAudioTakeId: null,
    expressionId: null,
  };
}

function fixture(): { document: ContentDocument; point: PointScene } {
  const document = createInitialContentDocument();
  document.characters = [
    {
      id: "char-1",
      name: "A",
      names: [],
      voices: [],
      libraryCharacterId: null,
      appearances: [
        {
          id: "app-1",
          assetId: "asset-image-1",
          expression: "normal",
          pose: "default",
          faceSetId: null,
          faceSetVersion: null,
          libraryAppearanceId: null,
        },
        {
          id: "app-2",
          assetId: "asset-image-2",
          expression: "smile",
          pose: "default",
          faceSetId: null,
          faceSetVersion: null,
          libraryAppearanceId: null,
        },
      ],
    },
  ];
  const scene = document.scenes.find(
    (entry) => entry.id === DEFAULT_SCENE_IDS.point1,
  );
  if (scene === undefined || scene.kind !== "point") {
    throw new Error("point scene is missing");
  }
  scene.lines = [line("line-1", "one"), line("line-2", "two"), line("line-3", "three")];
  return { document, point: scene };
}

describe("standing.state operations", () => {
  it("upserts and removes line-boundary states", () => {
    const { document, point } = fixture();
    const upserted = applyScriptOperation(
      document,
      {
        op: "standing.state.upsert",
        sceneId: point.id,
        side: "left",
        fromLineId: "line-2",
        characterId: "char-1",
        appearanceId: "app-2",
      },
      createTestContext(),
    );
    const scene = upserted.document.scenes[1]!;
    expect(scene.standingStates).toEqual([
      {
        side: "left",
        fromLineId: "line-2",
        characterId: "char-1",
        appearanceId: "app-2",
      },
    ]);
    expect(contentDocumentSchema.safeParse(upserted.document).success).toBe(true);

    const hidden = applyScriptOperation(
      upserted.document,
      {
        op: "standing.state.upsert",
        sceneId: point.id,
        side: "left",
        fromLineId: "line-3",
        characterId: null,
        appearanceId: null,
      },
      createTestContext(),
    );
    expect(hidden.document.scenes[1]!.standingStates).toHaveLength(2);

    const removed = applyScriptOperation(
      hidden.document,
      {
        op: "standing.state.remove",
        sceneId: point.id,
        side: "left",
        fromLineId: "line-3",
      },
      createTestContext(),
    );
    expect(removed.document.scenes[1]!.standingStates).toEqual([
      {
        side: "left",
        fromLineId: "line-2",
        characterId: "char-1",
        appearanceId: "app-2",
      },
    ]);
  });

  it("moves a state to the next line when its line is deleted, dropping a duplicate", () => {
    const { document, point } = fixture();
    const withStates = applyScriptOperation(
      document,
      {
        op: "standing.state.upsert",
        sceneId: point.id,
        side: "left",
        fromLineId: "line-2",
        characterId: "char-1",
        appearanceId: "app-2",
      },
      createTestContext(),
    );
    const removed = applyScriptOperation(
      withStates.document,
      { op: "line.remove", sceneId: point.id, lineId: "line-2" },
      createTestContext(),
    );
    expect(removed.document.scenes[1]!.standingStates).toEqual([
      {
        side: "left",
        fromLineId: "line-3",
        characterId: "char-1",
        appearanceId: "app-2",
      },
    ]);
  });

  it("carries the effective state into the new scene at a scene split", () => {
    const { document, point } = fixture();
    const withState = applyScriptOperation(
      document,
      {
        op: "standing.state.upsert",
        sceneId: point.id,
        side: "left",
        fromLineId: "line-2",
        characterId: "char-1",
        appearanceId: "app-2",
      },
      createTestContext(),
    );
    const split = applyScriptOperation(
      withState.document,
      { op: "scene.splitAtLine", sceneId: point.id, lineId: "line-3" },
      createTestContext(),
    );
    expect(split.document.scenes).toHaveLength(4);
    const first = split.document.scenes[1]!;
    const second = split.document.scenes[2]!;
    expect(first.kind).toBe("point");
    expect(second.kind).toBe("point");
    expect(first.standingStates).toEqual([
      {
        side: "left",
        fromLineId: "line-2",
        characterId: "char-1",
        appearanceId: "app-2",
      },
    ]);
    expect(second.standingStates).toBeUndefined();
    const carried = second.visualCues.find(
      (cue) => cue.template.id === "character.standing",
    );
    expect(carried?.input).toMatchObject({
      characterId: "char-1",
      appearanceId: "app-2",
      side: "left",
    });
    expect(contentDocumentSchema.safeParse(split.document).success).toBe(true);
  });

  it("does not copy standings at a split when the scene has no states", () => {
    const { document, point } = fixture();
    const split = applyScriptOperation(
      document,
      { op: "scene.splitAtLine", sceneId: point.id, lineId: "line-3" },
      createTestContext(),
    );
    const second = split.document.scenes[2]!;
    expect(second.visualCues.some((cue) => cue.template.id === "character.standing")).toBe(
      false,
    );
  });
});
