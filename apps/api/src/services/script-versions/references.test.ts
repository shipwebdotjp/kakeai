import { describe, expect, it } from "vitest";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import type { ContentDocument } from "@kakeai/contracts";
import {
  assertFaceSetReferences,
  faceSetKey,
  type AssetWithRenditions,
  type FaceSetRevisionDetails,
} from "./references.ts";

function faceSet(
  faceSetId: string,
  expressions: readonly string[],
): FaceSetRevisionDetails {
  return {
    faceSetId,
    name: faceSetId,
    version: 1,
    layers: [],
    expressions: expressions.map((id) => ({
      id,
      name: id,
      browLayerId: null,
      eyeLayerId: null,
      mouthLayerId: null,
    })),
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function fixture(): {
  document: ContentDocument;
  faceSets: Map<string, FaceSetRevisionDetails>;
  assets: Map<string, AssetWithRenditions>;
} {
  const document = validContentDocument();
  const point = document.scenes[1]!;
  point.lines.push({
    ...point.lines[0]!,
    id: "line-p1-2",
    selectedAudioTakeId: null,
  });
  document.speakers = [
    {
      id: "speaker-rin",
      name: "リン",
      characterId: "character-rin",
      voiceProfileId: null,
    },
  ];
  for (const line of point.lines) {
    line.speakerId = "speaker-rin";
  }
  document.characters = [
    {
      id: "character-rin",
      name: "リン",
      names: [],
      voices: [],
      libraryCharacterId: null,
      appearances: [
        {
          id: "appearance-a",
          assetId: "asset-rin-a",
          expression: "normal",
          pose: "front",
          faceSetId: "fs-a",
          faceSetVersion: 1,
          libraryAppearanceId: null,
        },
        {
          id: "appearance-b",
          assetId: "asset-rin-b",
          expression: "normal",
          pose: "front",
          faceSetId: "fs-b",
          faceSetVersion: 1,
          libraryAppearanceId: null,
        },
      ],
    },
  ];
  point.visualCues.push({
    id: "vc-standing",
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
      appearanceId: "appearance-a",
      side: "left",
    },
  });
  point.standingStates = [
    {
      side: "left",
      fromLineId: "line-p1-2",
      characterId: "character-rin",
      appearanceId: "appearance-b",
    },
  ];
  return {
    document,
    faceSets: new Map([
      [faceSetKey("fs-a", 1), faceSet("fs-a", ["normal", "happy"])],
      [faceSetKey("fs-b", 1), faceSet("fs-b", ["normal"])],
    ]),
    assets: new Map(),
  };
}

describe("assertFaceSetReferences expression validation", () => {
  it("validates a line against the appearance visible on that line", () => {
    const { document, faceSets, assets } = fixture();
    const point = document.scenes[1]!;
    point.lines[0]!.expressionId = "happy";
    expect(() =>
      assertFaceSetReferences(document, faceSets, assets),
    ).not.toThrow();

    point.lines[1]!.expressionId = "happy";
    expect(() => assertFaceSetReferences(document, faceSets, assets)).toThrow();
  });

  it("skips expression validation when the line hides the character", () => {
    const { document, faceSets, assets } = fixture();
    const point = document.scenes[1]!;
    point.lines[1]!.expressionId = "happy";
    point.standingStates = [
      {
        side: "left",
        fromLineId: "line-p1-2",
        characterId: null,
        appearanceId: null,
      },
    ];
    expect(() =>
      assertFaceSetReferences(document, faceSets, assets),
    ).not.toThrow();
  });
});
