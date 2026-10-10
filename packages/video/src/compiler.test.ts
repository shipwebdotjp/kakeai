import { describe, expect, it } from "vitest";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import type { VisualCue } from "@kakeai/contracts";
import type { AssetResolver } from "./resolver";
import { CompositionCompileError } from "./compile-error";
import { compileDocument } from "./compiler";
import { cueScope } from "./scope";

const resolver: AssetResolver = (assetId) => {
  if (assetId.includes("audio") || assetId.includes("bgm")) {
    return { url: `/preview/${assetId}`, kind: "audio", durationMs: 3000 };
  }
  return { url: `/preview/${assetId}`, kind: assetId.includes("video") ? "video" : "image" };
};

const transition = {
  enter: { preset: "fade", durationMs: 350 },
  exit: { preset: "none", durationMs: 0 },
} as const;

function cue(partial: Partial<VisualCue> & Pick<VisualCue, "id" | "template" | "input">): VisualCue {
  return {
    range: { kind: "scene" },
    layer: "background",
    order: 0,
    transition,
    ...partial,
  } as VisualCue;
}

function clipId(id: string): string {
  return cueScope(id).id("clip");
}

describe("compileDocument", () => {
  it("renders five scenes back to back with resolved asset urls", () => {
    const compiled = compileDocument({ document: validContentDocument(), assetResolver: resolver });
    expect(compiled.durationMs).toBe(14000);
    expect(compiled.assetIds).toEqual(["asset-bg", "asset-audio-1", "asset-bgm"]);
    expect(compiled.html).toContain('data-composition-id="kakeai-main"');
    expect(compiled.html).toContain('data-width="1920"');
    expect(compiled.html).toContain('data-height="1080"');
    expect(compiled.html).toContain('data-duration="14"');
    expect(compiled.html).toContain('data-fps="30"');
    expect(compiled.html).toContain('data-start="0" data-duration="4"');
    expect(compiled.html).toContain('data-start="4" data-duration="4"');
    expect(compiled.html).toContain('data-start="10" data-duration="4"');
    expect(compiled.html).toContain('src="/preview/asset-bg"');
    expect(compiled.html).toContain('window.__timelines["kakeai-main"]');
  });

  it("applies cue enter and exit transitions to the cue frame", () => {
    const document = validContentDocument();
    const scene = document.scenes[0]!;
    scene.visualCues[0]!.transition = {
      enter: { preset: "fade", durationMs: 300 },
      exit: { preset: "fade", durationMs: 200 },
    };
    const compiled = compileDocument({ document, assetResolver: resolver });
    const bodyId = cueScope("vc-intro-bg").id("body");
    expect(compiled.html).toContain(`document.getElementById("${bodyId}")`);
    expect(compiled.html).toContain("opacity:0");
  });

  it("rejects a transition that exceeds the cue range", () => {
    const document = validContentDocument();
    document.scenes[1]!.visualCues = [
      cue({
        id: "vc-small",
        template: { id: "media.full-bleed", version: 1 },
        input: { assetId: "asset-bg", fit: "cover" },
        range: { kind: "offset", startMs: 0, endMs: 400 },
        transition: {
          enter: { preset: "fade", durationMs: 300 },
          exit: { preset: "fade", durationMs: 300 },
        },
      }),
    ];
    try {
      compileDocument({ document, assetResolver: resolver });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CompositionCompileError);
      expect((error as CompositionCompileError).issues[0]?.code).toBe(
        "transition_range_overflow",
      );
    }
  });

  it("places narration audio and burned-in captions on the line interval", () => {
    const compiled = compileDocument({ document: validContentDocument(), assetResolver: resolver });
    expect(compiled.html).toContain('id="kakeai-audio-take-line-p1-1"');
    expect(compiled.html).toContain('src="/preview/asset-audio-1"');
    expect(compiled.html).toContain('class="kakeai-captiontext">最初の要点です。');
    expect(compiled.html).toContain('data-start="4.5" data-duration="3"');
  });

  it("schedules looping background music across the composition", () => {
    const document = validContentDocument();
    document.audioCues = [
      {
        id: "bgm-main",
        role: "bgm",
        assetId: "asset-bgm",
        range: { kind: "work" },
        gainDb: -18,
        loop: true,
      },
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    const copies = compiled.html.match(/id="kakeai-audio-cue-bgm-main-\d+"/g) ?? [];
    expect(copies.length).toBe(5);
    expect(compiled.html).toContain('src="/preview/asset-bgm"');
    expect(compiled.html).toContain('data-volume="0.126"');
  });

  it("rejects a loop whose copy count exceeds the cap", () => {
    const document = validContentDocument();
    document.audioCues = [
      {
        id: "bgm-tiny",
        role: "bgm",
        assetId: "asset-bgm",
        range: { kind: "work" },
        loop: true,
      },
    ];
    const tinyResolver: AssetResolver = (assetId) => ({
      url: `/preview/${assetId}`,
      kind: assetId.includes("audio") || assetId.includes("bgm") ? "audio" : "image",
      durationMs: 1,
    });
    try {
      compileDocument({ document, assetResolver: tinyResolver });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CompositionCompileError);
      expect((error as CompositionCompileError).issues[0]?.code).toBe("loop_span_too_long");
      expect((error as CompositionCompileError).issues[0]?.path).toEqual(["audioCues", 0]);
    }
  });

  it("resolves line ranges to absolute clip times", () => {
    const document = validContentDocument();
    document.scenes[1]!.visualCues = [
      cue({
        id: "vc-p1-card",
        template: { id: "media.card", version: 1 },
        layer: "card",
        range: { kind: "lines", startLineId: "line-p1-1", endLineId: "line-p1-1" },
        input: { assetId: "asset-video-1", heading: "カード見出し" },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.assetIds).toEqual(["asset-bg", "asset-video-1", "asset-audio-1", "asset-bgm"]);
    expect(compiled.html).toContain('data-start="4.5" data-duration="3"');
    expect(compiled.html).toContain("<video");
    expect(compiled.html).toContain("カード見出し");
  });

  it("escapes slot text", () => {
    const document = validContentDocument();
    const scene = document.scenes[0];
    if (scene === undefined || scene.kind !== "intro") {
      throw new Error("fixture changed");
    }
    scene.slots.title = "<b>危険</b>&引用";
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain("&lt;b&gt;危険&lt;/b&gt;&amp;引用");
    expect(compiled.html).not.toContain("<b>危険</b>");
  });

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
      appearances: [{ id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front" }],
    });
    document.scenes[1]!.visualCues.push(
      cue({
        id: "vc-standing",
        template: { id: "character.standing", version: 1 },
        layer: "standing",
        input: { characterId: "character-rin", appearanceId: "appearance-smile", x: 0.8, y: 0.8, scale: 1 },
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

  it("renders a standing appearance with normalized position and scale", () => {
    const document = validContentDocument();
    document.characters.push({
      id: "character-rin",
      name: "リン",
      appearances: [
        { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front" },
      ],
    });
    document.scenes[1]!.visualCues.push(
      cue({
        id: "vc-standing",
        template: { id: "character.standing", version: 1 },
        layer: "standing",
        input: {
          characterId: "character-rin",
          appearanceId: "appearance-smile",
          x: 0.85,
          y: 0.85,
          scale: 1.5,
        },
      }),
    );
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.assetIds).toContain("asset-rin");
    expect(compiled.html).toContain('class="kakeai-standing"');
    expect(compiled.html).toContain('src="/preview/asset-rin"');
    expect(compiled.html).toContain("left:85%;top:85%;width:720px;");
  });

  it("renders character.standing@2 at the selected side", () => {
    const document = validContentDocument();
    document.characters.push({
      id: "character-rin",
      name: "リン",
      appearances: [
        { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front" },
      ],
    });
    document.scenes[1]!.visualCues.push(
      cue({
        id: "vc-standing-right",
        template: { id: "character.standing", version: 2 },
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
    expect(compiled.html).toContain("left:78.25%;top:86%;");
    expect(compiled.html).toContain("width:720px;");
  });

  it("anchors the standing's outer edge to the frame at any scale", () => {
    const document = validContentDocument();
    document.characters.push({
      id: "character-rin",
      name: "リン",
      appearances: [
        { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front" },
      ],
    });
    document.scenes[1]!.visualCues.push(
      cue({
        id: "vc-standing-left",
        template: { id: "character.standing", version: 2 },
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
        template: { id: "character.standing", version: 2 },
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
    expect(compiled.html).toContain("left:15.5%;top:86%;");
    expect(compiled.html).toContain("left:72%;top:86%;");
  });

  it("bounces only the standing of the speaking character", () => {
    const document = validContentDocument();
    document.characters.push(
      {
        id: "character-rin",
        name: "リン",
        appearances: [
          { id: "appearance-rin", assetId: "asset-rin", expression: "normal", pose: "front" },
        ],
      },
      {
        id: "character-mika",
        name: "ミカ",
        appearances: [
          { id: "appearance-mika", assetId: "asset-mika", expression: "normal", pose: "front" },
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
      },
    ];
    scene.visualCues = [
      cue({
        id: "vc-left",
        template: { id: "character.standing", version: 2 },
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
        template: { id: "character.standing", version: 2 },
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

  it("does not schedule a bounce for character.standing@1", () => {
    const document = validContentDocument();
    document.characters.push({
      id: "character-rin",
      name: "リン",
      appearances: [
        { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front" },
      ],
    });
    document.speakers.push({
      id: "speaker-rin",
      name: "リン",
      characterId: "character-rin",
      voiceProfileId: null,
    });
    const scene = document.scenes[1]!;
    scene.lines = [
      {
        id: "line-rin",
        speakerId: "speaker-rin",
        captionText: "リンです。",
        speechText: "りんです。",
        selectedAudioTakeId: null,
      },
    ];
    scene.visualCues = [
      cue({
        id: "vc-standing",
        template: { id: "character.standing", version: 1 },
        layer: "standing",
        input: {
          characterId: "character-rin",
          appearanceId: "appearance-smile",
          x: 0.85,
          y: 0.85,
          scale: 1,
        },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain('class="kakeai-standing"');
    expect(compiled.html).not.toContain("y:-20");
  });

  it("renders a device-frame composition with nested media at background and card", () => {
    for (const [layer, assetId] of [
      ["background", "asset-screen-image"],
      ["card", "asset-screen-video"],
    ] as const) {
      const document = validContentDocument();
      document.scenes[0]!.visualCues = [
        cue({
          id: `vc-device-${layer}`,
          template: { id: "scene.device-frame", version: 1 },
          layer,
          input: {
            frame: "laptop",
            screen: { kind: "media", assetId, fit: "cover" },
          },
        }),
      ];
      const compiled = compileDocument({ document, assetResolver: resolver });
      expect(compiled.assetIds).toContain(assetId);
      expect(compiled.html).toContain("kakeai-deviceframe");
      expect(compiled.html).toContain(`src="/preview/${assetId}"`);
      const nestedId = cueScope(`vc-device-${layer}`).child("screen").id("media");
      expect(compiled.html).toContain(`id="${nestedId}"`);
    }
  });

  it("applies non-fade cue transition presets", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues[0]!.transition = {
      enter: { preset: "slide-up", durationMs: 300 },
      exit: { preset: "none", durationMs: 0 },
    };
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain("y:60");
  });

  it("animates the device-frame screen for scene.device-frame@2", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-device2",
        template: { id: "scene.device-frame", version: 2 },
        layer: "background",
        input: {
          frame: "laptop",
          screen: { kind: "media", assetId: "asset-screen", fit: "cover" },
          animation: { preset: "scale-in", durationMs: 400 },
        },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    const screenId = cueScope("vc-device2").id("screen");
    expect(compiled.html).toContain(`document.getElementById("${screenId}")`);
    expect(compiled.html).toContain("scale:0.9");
  });

  it("rejects an animation field on scene.device-frame@1", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-device1",
        template: { id: "scene.device-frame", version: 1 },
        layer: "background",
        input: {
          frame: "laptop",
          screen: { kind: "media", assetId: "asset-screen", fit: "cover" },
          animation: { preset: "fade", durationMs: 300 },
        },
      }),
    ];
    expect(() => compileDocument({ document, assetResolver: resolver })).toThrow(
      CompositionCompileError,
    );
  });
});
