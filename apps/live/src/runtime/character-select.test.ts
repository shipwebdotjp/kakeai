import { liveCharacterSheetSchema, type LiveCharacterSheet } from "@kakeai/contracts";
import { describe, expect, it } from "vitest";
import {
  findCharacter,
  pickAppearance,
  pickExpressionLayers,
  pickFaceSet,
  selectCharacterFace,
} from "./character-select.ts";

function sheet(): LiveCharacterSheet {
  return liveCharacterSheetSchema.parse({
    schemaVersion: 1,
    characters: [
      {
        id: "char-left",
        side: "left",
        name: "左",
        appearances: [
          {
            id: "left-normal",
            expression: "normal",
            image: "media/characters/left-normal.png",
            faceSetId: "face-left",
            faceSetVersion: 2,
          },
          {
            id: "left-smile",
            expression: "smile",
            image: "media/characters/left-smile.png",
            faceSetId: "face-left",
            faceSetVersion: 2,
          },
        ],
        voice: { adapterId: "voicevox", voiceId: "voice-1", speedScale: 1, settings: {} },
      },
    ],
    faceSets: [
      {
        id: "face-left",
        version: 2,
        layers: [
          { id: "brow-normal", part: "brow", file: "media/faces/brow-normal.png" },
          {
            id: "eye-normal",
            part: "eye",
            file: "media/faces/eye-normal.png",
            blinkFile: "media/faces/eye-blink.png",
          },
          {
            id: "mouth-normal",
            part: "mouth",
            file: "media/faces/mouth-normal.png",
            speakingFile: "media/faces/mouth-open.png",
          },
          { id: "eye-smile", part: "eye", file: "media/faces/eye-smile.png" },
          { id: "mouth-smile", part: "mouth", file: "media/faces/mouth-smile.png" },
        ],
        expressions: [
          {
            id: "normal",
            name: "通常",
            browLayerId: "brow-normal",
            eyeLayerId: "eye-normal",
            mouthLayerId: "mouth-normal",
          },
          {
            id: "smile",
            name: "笑顔",
            browLayerId: "brow-normal",
            eyeLayerId: "eye-smile",
            mouthLayerId: "mouth-smile",
          },
        ],
      },
    ],
  });
}

describe("pickAppearance", () => {
  it("uses the expression appearance and falls back to normal", () => {
    const character = findCharacter(sheet(), "left")!;
    expect(pickAppearance(character, "smile").id).toBe("left-smile");
    expect(pickAppearance(character, "angry").id).toBe("left-normal");
  });
});

describe("pickFaceSet", () => {
  it("pins the appearance revision and returns null when it is absent", () => {
    const sheetValue = sheet();
    const character = findCharacter(sheetValue, "left")!;
    expect(pickFaceSet(sheetValue, character.appearances[0]!)?.version).toBe(2);
    expect(
      pickFaceSet(sheetValue, { ...character.appearances[0]!, faceSetVersion: 1 }),
    ).toBeNull();
    expect(
      pickFaceSet(sheetValue, { ...character.appearances[0]!, faceSetId: null, faceSetVersion: null }),
    ).toBeNull();
  });
});

describe("pickExpressionLayers", () => {
  it("resolves the expression preset layers including blink and speaking files", () => {
    const sheetValue = sheet();
    const faceSet = sheetValue.faceSets[0]!;
    const normal = pickExpressionLayers(faceSet, "normal");
    expect(normal.brow?.file).toBe("media/faces/brow-normal.png");
    expect(normal.eye?.blinkFile).toBe("media/faces/eye-blink.png");
    expect(normal.mouth?.speakingFile).toBe("media/faces/mouth-open.png");

    const smile = pickExpressionLayers(faceSet, "smile");
    expect(smile.eye?.file).toBe("media/faces/eye-smile.png");
    expect(smile.mouth?.file).toBe("media/faces/mouth-smile.png");
  });

  it("falls back to normal for an unknown expression and tolerates a missing layer", () => {
    const faceSet = sheet().faceSets[0]!;
    expect(pickExpressionLayers(faceSet, "unknown").eye?.file).toBe("media/faces/eye-normal.png");
    const withoutEye = {
      ...faceSet,
      expressions: faceSet.expressions.map((expression) =>
        expression.id === "normal" ? { ...expression, eyeLayerId: "missing" } : expression,
      ),
    };
    expect(pickExpressionLayers(withoutEye, "normal").eye).toBeNull();
    expect(pickExpressionLayers(null, "normal")).toEqual({ brow: null, eye: null, mouth: null });
  });
});

describe("selectCharacterFace", () => {
  it("returns the appearance, pinned face set and layers together", () => {
    const selection = selectCharacterFace(sheet(), "left", "smile")!;
    expect(selection.character.id).toBe("char-left");
    expect(selection.appearance.image).toBe("media/characters/left-smile.png");
    expect(selection.faceSet?.id).toBe("face-left");
    expect(selection.layers.eye?.file).toBe("media/faces/eye-smile.png");
  });

  it("returns null when the side has no character", () => {
    expect(selectCharacterFace(sheet(), "right", "normal")).toBeNull();
  });
});
