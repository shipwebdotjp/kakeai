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

  it("defines an onset overlay selector matching every preset class", () => {
    const compiled = compileDocument({ document: validContentDocument(), assetResolver: resolver });
    for (const preset of ONSET_PRESETS) {
      expect(compiled.html).toContain(`.kakeai-onset-${preset}{`);
    }
  });

  it("emits a count-up tween for a stat value effect", () => {
    const document = validContentDocument();
    document.scenes[1]!.visualCues = [
      cue({
        id: "vc-stat",
        template: { id: "stat", version: 1 },
        layer: "overlay",
        input: {
          value: 1200,
          format: "integer",
          effects: [{ trigger: { kind: "cue" }, effect: { kind: "value" } }],
        },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    const valueId = cueScope("vc-stat").id("value-text");
    expect(compiled.html).toContain(`document.getElementById("${valueId}")`);
    expect(compiled.html).toContain("_o={v:0}");
    expect(compiled.html).toContain("v:1200");
    expect(compiled.html).toContain("el.textContent=_fmt(");
  });

  it("emits a syntactically valid timeline script for an onset preset", () => {
    const document = validContentDocument();
    document.scenes[1]!.visualCues = [
      cue({
        id: "vc-onset",
        template: { id: "stat", version: 1 },
        layer: "overlay",
        input: {
          value: 42,
          format: "integer",
          effects: [
            {
              trigger: { kind: "cue" },
              effect: {
                kind: "emphasize",
                style: "frame",
                tone: "primary",
                onset: { preset: "marker", durationMs: 600 },
              },
            },
          ],
        },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    const start = compiled.html.lastIndexOf("<script>") + "<script>".length;
    const end = compiled.html.indexOf("</script>", start);
    const script = compiled.html.slice(start, end);
    expect(script).toContain('"--kakeai-onset-progress":0');
    expect(() => new Function(script)).not.toThrow();
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
    expect(compiled.html).toContain('class="kakeai-captiontext"');
    expect(compiled.html).toContain('>最初の要点です。</p>');
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

  it("renders an insert scene's main video as audible embedded audio", () => {
    const document = validContentDocument();
    document.scenes.splice(
      2,
      0,
      createInsertScene("scene-insert-1", "動画 1", "asset-video-insert", 5000, true),
    );
    const compiled = compileDocument({ document, assetResolver: videoResolverWithDuration(5000) });
    expect(compiled.html).toContain('data-has-audio="true"');
    expect(compiled.html).not.toContain(" muted");
  });

  it("renders an insert scene's main video muted when embedded audio is off", () => {
    const document = validContentDocument();
    document.scenes.splice(
      2,
      0,
      createInsertScene("scene-insert-1", "動画 1", "asset-video-insert", 5000, false),
    );
    const compiled = compileDocument({ document, assetResolver: videoResolverWithDuration(5000) });
    expect(compiled.html).not.toContain('data-has-audio="true"');
    expect(compiled.html).toContain(" muted playsinline");
  });

  it("ducks work BGM with 200ms fades around an embedded-audio insert scene", () => {
    const document = validContentDocument();
    document.scenes.splice(
      2,
      0,
      createInsertScene("scene-insert-1", "動画 1", "asset-video-insert", 5000, true),
    );
    const compiled = compileDocument({ document, assetResolver: videoResolverWithDuration(5000) });
    expect(compiled.html).toMatch(/id="kakeai-audio-cue-bgm-main-seg0-\d+"/);
    expect(compiled.html).toMatch(/id="kakeai-audio-cue-bgm-main-seg1-\d+"/);
    expect(compiled.html).toContain('data-fade-out="0.2"');
    expect(compiled.html).toContain('data-fade-in="0.2"');
  });

  it("keeps work BGM continuous when the insert scene has embedded audio off", () => {
    const document = validContentDocument();
    document.scenes.splice(
      2,
      0,
      createInsertScene("scene-insert-1", "動画 1", "asset-video-insert", 5000, false),
    );
    const compiled = compileDocument({ document, assetResolver: videoResolverWithDuration(5000) });
    expect(compiled.html).toContain('id="kakeai-audio-cue-bgm-main-0"');
    expect(compiled.html).not.toContain("data-fade-out");
  });

  it("applies the embedded audio gain as data-volume on the insert video", () => {
    const document = validContentDocument();
    const insert = createInsertScene("scene-insert-1", "動画 1", "asset-video-insert", 5000, true);
    insert.embeddedAudioGainDb = -6;
    document.scenes.splice(2, 0, insert);
    const compiled = compileDocument({ document, assetResolver: videoResolverWithDuration(5000) });
    expect(compiled.html).toContain('data-has-audio="true" data-volume="0.501"');
  });

  it("applies the embedded audio gain to each loop segment", () => {
    const document = validContentDocument();
    const insert = createInsertScene("scene-insert-1", "動画 1", "asset-video-insert", 6000, true);
    insert.embeddedAudioGainDb = -6;
    insert.visualCues[0]!.input = {
      assetId: "asset-video-insert",
      fit: "cover",
      trimStartMs: 0,
      trimEndMs: 2000,
      loop: true,
    };
    document.scenes.splice(2, 0, insert);
    const compiled = compileDocument({ document, assetResolver: videoResolverWithDuration(5000) });
    const segments = compiled.html.match(/data-has-audio="true" data-volume="0.501"/g) ?? [];
    expect(segments.length).toBe(3);
  });

  it("renders an insert scene with a trimmed source and synchronized embedded audio", () => {
    const document = validContentDocument();
    const insert = createInsertScene("scene-insert-1", "動画 1", "asset-video-insert", 3000, true);
    insert.visualCues[0]!.input = {
      assetId: "asset-video-insert",
      fit: "cover",
      trimStartMs: 1000,
      trimEndMs: 4000,
    };
    document.scenes.splice(2, 0, insert);
    const compiled = compileDocument({ document, assetResolver: videoResolverWithDuration(5000) });
    expect(compiled.html).toContain('data-media-start="1"');
    expect(compiled.html).toContain('data-has-audio="true"');
    expect(compiled.html).not.toContain(" muted");
  });

  it("loops an insert scene's trimmed video with audible loop segments", () => {
    const document = validContentDocument();
    const insert = createInsertScene("scene-insert-1", "動画 1", "asset-video-insert", 6000, true);
    insert.visualCues[0]!.input = {
      assetId: "asset-video-insert",
      fit: "cover",
      trimStartMs: 0,
      trimEndMs: 2000,
      loop: true,
    };
    document.scenes.splice(2, 0, insert);
    const compiled = compileDocument({ document, assetResolver: videoResolverWithDuration(5000) });
    const segments = compiled.html.match(/data-kakeai-loop-segment="true"/g) ?? [];
    expect(segments.length).toBe(3);
    expect(compiled.html).toContain('data-has-audio="true"');
    expect(compiled.html).not.toContain(" muted");
  });

  it("rejects a trim range outside the video duration", () => {
    const document = validContentDocument();
    const insert = createInsertScene("scene-insert-1", "動画 1", "asset-video-insert", 5000, true);
    insert.visualCues[0]!.input = {
      assetId: "asset-video-insert",
      fit: "cover",
      trimStartMs: 0,
      trimEndMs: 6000,
    };
    document.scenes.splice(2, 0, insert);
    expect(() =>
      compileDocument({ document, assetResolver: videoResolverWithDuration(5000) }),
    ).toThrow(CompositionCompileError);
  });

  it("plays a non-looping scene audio cue from the scene start", () => {
    const document = validContentDocument();
    document.audioCues = [
      {
        id: "scene-program",
        role: "program",
        assetId: "asset-audio-program",
        range: { kind: "scene", sceneId: "scene-point-1" },
        gainDb: 0,
      },
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain('id="kakeai-audio-cue-scene-program-0"');
    expect(compiled.html).toContain('src="/preview/asset-audio-program"');
    expect(compiled.html).toContain('data-start="4" data-duration="3"');
    expect(compiled.html).toContain('data-volume="1"');
  });

  it("loops a scene audio cue within the scene span", () => {
    const document = validContentDocument();
    document.audioCues = [
      {
        id: "scene-sfx",
        role: "sfx",
        assetId: "asset-audio-sfx",
        range: { kind: "scene", sceneId: "scene-point-1" },
        gainDb: -6,
        loop: true,
      },
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain('id="kakeai-audio-cue-scene-sfx-0"');
    expect(compiled.html).toContain('id="kakeai-audio-cue-scene-sfx-1"');
    expect(compiled.html).toContain('data-start="4" data-duration="3"');
    expect(compiled.html).toContain('data-start="7" data-duration="1"');
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

  it("stamps the cue window onto media elements", () => {
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
    expect(compiled.html).toContain('<video data-start="4.5" data-duration="3"');
  });

  it("renders the media card with the selected aspect ratio", () => {
    const document = validContentDocument();
    document.scenes[1]!.visualCues = [
      cue({
        id: "vc-p1-card",
        template: { id: "media.card", version: 1 },
        layer: "card",
        input: { assetId: "asset-image-1", aspectRatio: "9:16", heading: "見出し" },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain("aspect-ratio:9/16");
  });

  it("maps focalPoint to object-position on full-bleed and card media", () => {
    const document = validContentDocument();
    document.scenes[1]!.visualCues = [
      cue({
        id: "vc-p1-bg",
        template: { id: "media.full-bleed", version: 1 },
        input: { assetId: "asset-image-1", fit: "cover", focalPoint: { x: 0.2, y: 0.8 } },
      }),
      cue({
        id: "vc-p1-card",
        template: { id: "media.card", version: 1 },
        layer: "card",
        input: { assetId: "asset-image-1", heading: "見出し", focalPoint: { x: 0.1, y: 0.9 } },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain("object-position:20% 80%");
    expect(compiled.html).toContain("object-position:10% 90%");
  });

  it("applies media zoom as a transform anchored at the focal point", () => {
    const document = validContentDocument();
    document.scenes[1]!.visualCues = [
      cue({
        id: "vc-p1-bg",
        template: { id: "media.full-bleed", version: 1 },
        input: { assetId: "asset-image-1", fit: "cover", focalPoint: { x: 0.2, y: 0.8 }, zoom: 1.5 },
      }),
      cue({
        id: "vc-p1-card",
        template: { id: "media.card", version: 1 },
        layer: "card",
        input: { assetId: "asset-image-1", heading: "見出し", zoom: 2 },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain("transform:scale(1.5);transform-origin:20% 80%");
    expect(compiled.html).toContain("transform:scale(2);transform-origin:50% 50%");
    expect(compiled.html).toContain('class="kakeai-cardmedia-clip"');
  });

  it("omits the text frame when heading and caption are empty", () => {
    const document = validContentDocument();
    document.scenes[1]!.visualCues = [
      cue({
        id: "vc-p1-card",
        template: { id: "media.card", version: 1 },
        layer: "card",
        input: { assetId: "asset-image-1", heading: "" },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain("kakeai-cardmedia");
    expect(compiled.html).not.toContain('<figcaption class="kakeai-cardtext">');
    expect(compiled.html).not.toContain('<h3 class="kakeai-cardheading">');
  });

  it("repeats a looping video across the cue window", () => {
    const document = validContentDocument();
    document.scenes[1]!.visualCues = [
      cue({
        id: "vc-loop-bg",
        template: { id: "media.full-bleed", version: 1 },
        input: { assetId: "asset-video-1", fit: "cover", loop: true },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: videoResolver });
    const mediaId = cueScope("vc-loop-bg").id("media");
    expect(compiled.html).toContain(
      `<video id="${mediaId}-0" class="kakeai-fullbleed"`,
    );
    expect(compiled.html).toContain(
      `data-media-start="0" data-start="4" data-duration="2"`,
    );
    expect(compiled.html).toContain(
      `data-media-start="0" data-start="6" data-duration="2"`,
    );
  });

  it("does not repeat a looping video when the source fills the window", () => {
    const document = validContentDocument();
    document.scenes[1]!.visualCues = [
      cue({
        id: "vc-loop-bg",
        template: { id: "media.full-bleed", version: 1 },
        input: { assetId: "asset-video-1", fit: "cover", loop: true },
      }),
    ];
    const longResolver: AssetResolver = videoResolverWithDuration(5000);
    const compiled = compileDocument({ document, assetResolver: longResolver });
    expect(compiled.html).not.toContain(`id="${cueScope("vc-loop-bg").id("media")}-1"`);
    expect(compiled.html).toContain('<video data-start="4" data-duration="4"');
  });

  it("does not repeat video when loop is off", () => {
    const document = validContentDocument();
    document.scenes[1]!.visualCues = [
      cue({
        id: "vc-no-loop-bg",
        template: { id: "media.full-bleed", version: 1 },
        input: { assetId: "asset-video-1", fit: "cover" },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: videoResolver });
    expect(compiled.html).not.toContain(`id="${cueScope("vc-no-loop-bg").id("media")}-1"`);
    expect(compiled.html).toContain('<video data-start="4" data-duration="4"');
  });

  it("rejects a looping video that would require too many copies", () => {
    const document = validContentDocument();
    document.scenes[1]!.visualCues = [
      cue({
        id: "vc-loop-bg",
        template: { id: "media.full-bleed", version: 1 },
        input: { assetId: "asset-video-1", fit: "cover", loop: true },
      }),
    ];
    const tinyResolver: AssetResolver = videoResolverWithDuration(3);
    try {
      compileDocument({ document, assetResolver: tinyResolver });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CompositionCompileError);
      expect((error as CompositionCompileError).issues[0]?.code).toBe("loop_span_too_long");
    }
  });

  it("repeats a looping card video inside the card frame", () => {
    const document = validContentDocument();
    document.scenes[1]!.visualCues = [
      cue({
        id: "vc-loop-card",
        template: { id: "media.card", version: 1 },
        layer: "card",
        input: { assetId: "asset-video-1", heading: "見出し", loop: true },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: videoResolver });
    const mediaId = cueScope("vc-loop-card").id("media");
    expect(compiled.html).toContain('class="kakeai-cardmedia-clip"');
    expect(compiled.html).toContain(`<video id="${mediaId}-0" class="kakeai-cardmedia"`);
    expect(compiled.html).toContain(`<video id="${mediaId}-1" class="kakeai-cardmedia"`);
  });

});
