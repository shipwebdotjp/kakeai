import { describe, expect, it } from "vitest";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import { ONSET_PRESETS, createInsertScene, getVisualTheme, type SnapshotFaceSet, type VisualCue } from "@kakeai/contracts";
import type { AssetResolver, FaceSetResolver } from "../resolver";
import type { CompositionVersionResolver } from "../composition-resolver";
import { CompositionCompileError } from "../compile-error";
import { compileDocument } from "../compiler";
import { cueScope } from "../scope";
import { mixHex } from "../theme";
import { resolver, videoResolver, videoResolverWithDuration, compositionResolver, compositionResolverWithDuration, transition, cue, clipId } from "./test-helpers";

describe("compileDocument", () => {
  it("rejects unknown template versions", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues.push(
      cue({
        id: "vc-unknown",
        template: { id: "media.full-bleed", version: 99 },
        input: { assetId: "asset-bg", fit: "cover" },
      }),
    );
    expect(() => compileDocument({ document, assetResolver: resolver })).toThrow(
      CompositionCompileError,
    );
  });

  it("rejects non-image assets for character.standing", () => {
    const document = validContentDocument();
    document.characters.push({
      id: "character-rin",
      name: "リン",
      names: [],
      voices: [],
      libraryCharacterId: null,
      appearances: [{ id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null, faceSetVersion: null, libraryAppearanceId: null }],
    });
    document.scenes[1]!.visualCues.push(
      cue({
        id: "vc-standing",
        template: { id: "character.standing", version: 1 },
        layer: "standing",
        input: { characterId: "character-rin", appearanceId: "appearance-smile", side: "right", scale: 1 },
      }),
    );
    const videoResolver: AssetResolver = (assetId) => ({
      url: `/preview/${assetId}`,
      kind: "video",
    });
    try {
      compileDocument({ document, assetResolver: videoResolver });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CompositionCompileError);
      expect((error as CompositionCompileError).issues[0]?.code).toBe("invalid_asset_kind");
    }
  });

  it("renders background below card regardless of document order", () => {
    const document = validContentDocument();
    const scene = document.scenes[0]!;
    scene.visualCues = [
      cue({
        id: "vc-card-first",
        template: { id: "media.card", version: 1 },
        layer: "card",
        order: 0,
        input: { assetId: "asset-card", heading: "カード" },
      }),
      cue({
        id: "vc-bg-second",
        template: { id: "media.full-bleed", version: 1 },
        layer: "background",
        order: 0,
        input: { assetId: "asset-bg2", fit: "cover" },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    const cardPosition = compiled.html.indexOf(`id="${clipId("vc-card-first")}"`);
    const bgPosition = compiled.html.indexOf(`id="${clipId("vc-bg-second")}"`);
    expect(cardPosition).toBeGreaterThan(-1);
    expect(bgPosition).toBeGreaterThan(-1);
    expect(bgPosition).toBeLessThan(cardPosition);
  });

  it("orders cues within a layer by order", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-card-b",
        template: { id: "media.card", version: 1 },
        layer: "card",
        order: 5,
        input: { assetId: "asset-card-b", heading: "B" },
      }),
      cue({
        id: "vc-card-a",
        template: { id: "media.card", version: 1 },
        layer: "card",
        order: 1,
        input: { assetId: "asset-card-a", heading: "A" },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    const aPosition = compiled.html.indexOf(`id="${clipId("vc-card-a")}"`);
    const bPosition = compiled.html.indexOf(`id="${clipId("vc-card-b")}"`);
    expect(aPosition).toBeGreaterThan(-1);
    expect(bPosition).toBeGreaterThan(aPosition);
  });

  it("renders character.standing@1 at the selected side", () => {
    const document = validContentDocument();
    document.characters.push({
      id: "character-rin",
      name: "リン",
      names: [],
      voices: [],
      libraryCharacterId: null,
      appearances: [
        { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null, faceSetVersion: null, libraryAppearanceId: null },
      ],
    });
    document.scenes[1]!.visualCues.push(
      cue({
        id: "vc-standing-right",
        template: { id: "character.standing", version: 1 },
        layer: "standing",
        input: {
          characterId: "character-rin",
          appearanceId: "appearance-smile",
          side: "right",
          scale: 1.5,
        },
      }),
    );
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.assetIds).toContain("asset-rin");
    expect(compiled.html).toContain('class="kakeai-standingv2"');
    expect(compiled.html).toContain('class="kakeai-standingimg"');
    expect(compiled.html).toContain("left:75.5%;top:86%;");
    expect(compiled.html).toContain("width:864px;");
  });

  it("anchors the standing's outer edge to the frame at any scale", () => {
    const document = validContentDocument();
    document.characters.push({
      id: "character-rin",
      name: "リン",
      names: [],
      voices: [],
      libraryCharacterId: null,
      appearances: [
        { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null, faceSetVersion: null, libraryAppearanceId: null },
      ],
    });
    document.scenes[1]!.visualCues.push(
      cue({
        id: "vc-standing-left",
        template: { id: "character.standing", version: 1 },
        layer: "standing",
        order: 0,
        input: {
          characterId: "character-rin",
          appearanceId: "appearance-smile",
          side: "left",
          scale: 1,
        },
      }),
      cue({
        id: "vc-standing-right",
        template: { id: "character.standing", version: 1 },
        layer: "standing",
        order: 1,
        input: {
          characterId: "character-rin",
          appearanceId: "appearance-smile",
          side: "right",
          scale: 2,
        },
      }),
    );
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain("left:17%;top:86%;");
    expect(compiled.html).toContain("left:68%;top:86%;");
  });

  it("maps standing edge and vertical presets to positions", () => {
    const document = validContentDocument();
    document.characters.push({
      id: "character-rin",
      name: "リン",
      names: [],
      voices: [],
      libraryCharacterId: null,
      appearances: [
        { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null, faceSetVersion: null, libraryAppearanceId: null },
      ],
    });
    document.scenes[1]!.visualCues.push(
      cue({
        id: "vc-standing-tight-up",
        template: { id: "character.standing", version: 1 },
        layer: "standing",
        order: 0,
        input: {
          characterId: "character-rin",
          appearanceId: "appearance-smile",
          side: "left",
          scale: 1,
          edge: "tight",
          vertical: "up",
        },
      }),
      cue({
        id: "vc-standing-center-down",
        template: { id: "character.standing", version: 1 },
        layer: "standing",
        order: 1,
        input: {
          characterId: "character-rin",
          appearanceId: "appearance-smile",
          side: "right",
          scale: 1,
          edge: "center",
          vertical: "down",
        },
      }),
    );
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain("left:15%;top:78%;");
    expect(compiled.html).toContain("left:77%;top:92%;");
  });

  it("bounces only the standing of the speaking character", () => {
    const document = validContentDocument();
    document.characters.push(
      {
        id: "character-rin",
        name: "リン",
        names: [],
        voices: [],
        libraryCharacterId: null,
        appearances: [
          { id: "appearance-rin", assetId: "asset-rin", expression: "normal", pose: "front", faceSetId: null, faceSetVersion: null, libraryAppearanceId: null },
        ],
      },
      {
        id: "character-mika",
        name: "ミカ",
        names: [],
        voices: [],
        libraryCharacterId: null,
        appearances: [
          { id: "appearance-mika", assetId: "asset-mika", expression: "normal", pose: "front", faceSetId: null, faceSetVersion: null, libraryAppearanceId: null },
        ],
      },
    );
    document.speakers.push(
      { id: "speaker-rin", name: "リン", characterId: "character-rin", voiceProfileId: null },
      { id: "speaker-mika", name: "ミカ", characterId: "character-mika", voiceProfileId: null },
    );
    const scene = document.scenes[1]!;
    scene.lines = [
      {
        id: "line-rin",
        speakerId: "speaker-rin",
        captionText: "リンです。",
        speechText: "りんです。",
        selectedAudioTakeId: null,
        expressionId: null,
      },
    ];
    scene.visualCues = [
      cue({
        id: "vc-left",
        template: { id: "character.standing", version: 1 },
        layer: "standing",
        order: 0,
        input: {
          characterId: "character-mika",
          appearanceId: "appearance-mika",
          side: "left",
          scale: 1,
        },
      }),
      cue({
        id: "vc-right",
        template: { id: "character.standing", version: 1 },
        layer: "standing",
        order: 1,
        input: {
          characterId: "character-rin",
          appearanceId: "appearance-rin",
          side: "right",
          scale: 1,
        },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    const rightImg = cueScope("vc-right").id("img");
    const leftImg = cueScope("vc-left").id("img");
    expect(compiled.html).toContain(`document.getElementById("${rightImg}")`);
    expect(compiled.html).toContain("y:-20");
    expect(compiled.html).not.toContain(`document.getElementById("${leftImg}")`);
  });

});

describe("face set version", () => {
  it("passes the appearance's pinned version to the resolver", () => {
    const document = validContentDocument();
    document.characters.push({
      id: "character-rin",
      name: "リン",
      names: [],
      voices: [],
      libraryCharacterId: null,
      appearances: [
        {
          id: "appearance-smile",
          assetId: "asset-rin",
          expression: "smile",
          pose: "front",
          faceSetId: "face-set-rin",
          faceSetVersion: 2,
          libraryAppearanceId: null,
        },
      ],
    });
    document.scenes[1]!.visualCues.push(
      cue({
        id: "vc-standing-face",
        template: { id: "character.standing", version: 1 },
        layer: "standing",
        input: {
          characterId: "character-rin",
          appearanceId: "appearance-smile",
          side: "left",
          scale: 1,
        },
      }),
    );
    const calls: Array<[string, number]> = [];
    const faceSetResolver: FaceSetResolver = (faceSetId, version) => {
      calls.push([faceSetId, version]);
      return {
        id: faceSetId,
        version,
        name: "リン正面",
        layers: [],
        expressions: [
          {
            id: "normal",
            name: "通常",
            browLayerId: null,
            eyeLayerId: null,
            mouthLayerId: null,
          },
        ],
      };
    };
    const compiled = compileDocument({
      document,
      assetResolver: resolver,
      faceSetResolver,
    });
    expect(calls).toEqual([["face-set-rin", 2]]);
    expect(compiled.html).toContain('class="kakeai-standingv2"');
  });
});
