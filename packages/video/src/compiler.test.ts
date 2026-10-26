import { describe, expect, it } from "vitest";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import { ONSET_PRESETS, createInsertScene, type SnapshotFaceSet, type VisualCue } from "@kakeai/contracts";
import type { AssetResolver, FaceSetResolver } from "./resolver";
import type { CompositionVersionResolver } from "./composition-resolver";
import { CompositionCompileError } from "./compile-error";
import { compileDocument } from "./compiler";
import { cueScope } from "./scope";
import { mixHex } from "./theme";

const resolver: AssetResolver = (assetId) => {
  if (assetId.includes("audio") || assetId.includes("bgm")) {
    return { url: `/preview/${assetId}`, kind: "audio", durationMs: 3000 };
  }
  return { url: `/preview/${assetId}`, kind: assetId.includes("video") ? "video" : "image" };
};

const videoResolver: AssetResolver = videoResolverWithDuration(2000);

function videoResolverWithDuration(durationMs: number): AssetResolver {
  return (assetId) => {
    if (assetId.includes("audio") || assetId.includes("bgm")) {
      return { url: `/preview/${assetId}`, kind: "audio", durationMs: 3000 };
    }
    return {
      url: `/preview/${assetId}`,
      kind: assetId.includes("video") ? "video" : "image",
      durationMs: assetId.includes("video") ? durationMs : null,
    };
  };
}

const compositionResolver: CompositionVersionResolver = compositionResolverWithDuration(5000);

function compositionResolverWithDuration(durationMs: number): CompositionVersionResolver {
  return (versionId) => ({
    id: versionId,
    runtimeCompositionId: "cmp.test",
    entrypoint: "index.html",
    bundleHash: "bundle-hash",
    storageKey: "compositions/test",
    previewUrl: "/preview/composition",
    manifest: {
      entrypoint: "index.html",
      runtimeCompositionId: "cmp.test",
      width: 1920,
      height: 1080,
      durationMs,
      dependencies: [],
    },
  });
}

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

  it("stamps the cue window onto a composition host", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-intro-comp",
        template: { id: "composition.full-bleed", version: 1 },
        layer: "background",
        input: { compositionVersionId: "ver-1" },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver, compositionResolver });
    expect(compiled.html).toContain(
      `<div data-start="0" data-duration="4" id="${cueScope("vc-intro-comp").id("comp-host")}"`,
    );
    expect(compiled.html).toContain('data-width="1920" data-height="1080"');
    expect(compiled.compositionVersions).toHaveLength(1);
  });

  it("resolves a lines range to an absolute composition window", () => {
    const document = validContentDocument();
    document.scenes[1]!.visualCues = [
      cue({
        id: "vc-point-comp",
        template: { id: "composition.full-bleed", version: 1 },
        layer: "background",
        range: { kind: "lines", startLineId: "line-p1-1", endLineId: "line-p1-1" },
        input: { compositionVersionId: "ver-1" },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver, compositionResolver });
    expect(compiled.html).toContain(
      `<div data-start="4.5" data-duration="3" id="${cueScope("vc-point-comp").id("comp-host")}"`,
    );
  });

  it("truncates a composition host at the child duration", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-intro-comp",
        template: { id: "composition.full-bleed", version: 1 },
        layer: "background",
        range: { kind: "offset", startMs: 0, endMs: 4000 },
        input: { compositionVersionId: "ver-1" },
      }),
    ];
    const compiled = compileDocument({
      document,
      assetResolver: resolver,
      compositionResolver: compositionResolverWithDuration(2000),
    });
    expect(compiled.html).toContain(
      `<div data-start="0" data-duration="2" id="${cueScope("vc-intro-comp").id("comp-host")}"`,
    );
  });

  it("rejects a composition transition that exceeds the effective window", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-intro-comp",
        template: { id: "composition.full-bleed", version: 1 },
        layer: "background",
        input: { compositionVersionId: "ver-1" },
      }),
    ];
    try {
      compileDocument({
        document,
        assetResolver: resolver,
        compositionResolver: compositionResolverWithDuration(300),
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CompositionCompileError);
      expect((error as CompositionCompileError).issues[0]?.code).toBe("transition_range_overflow");
    }
  });

  it("rejects a composition background when a crossfade needs a longer window than the child", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-intro-comp",
        template: { id: "composition.full-bleed", version: 1 },
        layer: "background",
        input: { compositionVersionId: "ver-1" },
      }),
    ];
    document.scenes[1]!.transition = { enter: { preset: "crossfade", durationMs: 1000 } };
    const compiled = compileDocument({
      document,
      assetResolver: resolver,
      compositionResolver: compositionResolverWithDuration(5000),
    });
    expect(compiled.html).toContain(
      `id="${clipId("vc-intro-comp")}" class="clip" data-start="0" data-duration="5"`,
    );
    try {
      compileDocument({
        document,
        assetResolver: resolver,
        compositionResolver: compositionResolverWithDuration(4999),
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CompositionCompileError);
      expect((error as CompositionCompileError).issues[0]?.code).toBe(
        "composition_crossfade_window_insufficient",
      );
    }
  });

  it("extends media timing when a crossfade stretches the previous scene", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-intro-video",
        template: { id: "media.full-bleed", version: 1 },
        layer: "background",
        input: { assetId: "asset-video-1", fit: "cover" },
      }),
    ];
    document.scenes[1]!.transition = { enter: { preset: "crossfade", durationMs: 300 } };
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain(
      `id="${clipId("vc-intro-video")}" class="clip" data-start="0" data-duration="4.3"`,
    );
    expect(compiled.html).toContain('<video data-start="0" data-duration="4.3"');
  });

  it("extends only the last loop segment when a crossfade stretches the previous scene", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-intro-loop",
        template: { id: "media.full-bleed", version: 1 },
        layer: "background",
        input: { assetId: "asset-video-1", fit: "cover", loop: true },
      }),
    ];
    document.scenes[1]!.transition = { enter: { preset: "crossfade", durationMs: 300 } };
    const compiled = compileDocument({ document, assetResolver: videoResolver });
    expect(compiled.html).toContain(
      `id="${clipId("vc-intro-loop")}" class="clip" data-start="0" data-duration="4.3"`,
    );
    expect(compiled.html).toContain(
      `data-media-start="0" data-start="0" data-duration="2" data-kakeai-loop-segment="true">`,
    );
    expect(compiled.html).toContain(
      `data-media-start="0" data-start="2" data-duration="2.3" data-kakeai-loop-segment="true" data-kakeai-loop-segment-last="true">`,
    );
  });

  it("escapes slot text", () => {
    const document = validContentDocument();
    const scene = document.scenes[0];
    if (scene === undefined) {
      throw new Error("fixture changed");
    }
    const titleCue = scene.visualCues.find(
      (candidate) => (candidate.input as { role?: string }).role === "title",
    );
    if (titleCue === undefined) {
      throw new Error("fixture changed");
    }
    (titleCue.input as { text: string }).text = "<b>危険</b>&引用";
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain("&lt;b&gt;危険&lt;/b&gt;&amp;引用");
    expect(compiled.html).not.toContain("<b>危険</b>");
  });

  it("omits clip markup for an empty text cue", () => {
    const document = validContentDocument();
    for (const scene of document.scenes) {
      scene.visualCues = [];
    }
    document.scenes[1]!.visualCues = [
      {
        id: "vc-empty-text",
        template: { id: "text.block", version: 1 },
        range: { kind: "scene" },
        layer: "overlay",
        order: 0,
        transition: {
          enter: { preset: "fade", durationMs: 350 },
          exit: { preset: "none", durationMs: 0 },
        },
        input: { text: "   ", role: "body" },
      },
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).not.toContain("kakeai-textblock");
  });

  it("renders a text.block@1 label role with a custom font face", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-label",
        template: { id: "text.block", version: 1 },
        layer: "overlay",
        input: {
          text: "ラベル",
          role: "label",
          fontFace: { family: "Custom Font" },
        },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain("ラベル");
    expect(compiled.html).toContain("Custom Font");
  });

  it("crossfades by extending the previous scene and fading in the entering scene", () => {
    const document = validContentDocument();
    document.scenes[1]!.transition = { enter: { preset: "crossfade", durationMs: 300 } };
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain(
      'id="kakeai-scene-0-bg" class="clip" data-start="0" data-duration="4.3"',
    );
    expect(compiled.html).toContain('getElementById("kakeai-scene-1")');
  });

  it("fades through black at both sides of a fade transition", () => {
    const document = validContentDocument();
    document.scenes[1]!.transition = { enter: { preset: "fade", durationMs: 400 } };
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain('getElementById("kakeai-scene-1")');
    expect(compiled.html).toContain('getElementById("kakeai-scene-0")');
  });

  it("rejects a scene transition that overflows the adjacent scene", () => {
    const document = validContentDocument();
    document.scenes[1]!.transition = { enter: { preset: "crossfade", durationMs: 5000 } };
    expect(() => compileDocument({ document, assetResolver: resolver })).toThrow(
      CompositionCompileError,
    );
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
      names: [],
      voices: [],
      appearances: [{ id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null }],
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
      appearances: [
        { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null },
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
      appearances: [
        { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null },
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
      appearances: [
        { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null },
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
        appearances: [
          { id: "appearance-rin", assetId: "asset-rin", expression: "normal", pose: "front", faceSetId: null },
        ],
      },
      {
        id: "character-mika",
        name: "ミカ",
        names: [],
        voices: [],
        appearances: [
          { id: "appearance-mika", assetId: "asset-mika", expression: "normal", pose: "front", faceSetId: null },
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

  it("shows device-frame chrome by default and hides it when disabled", () => {
    const compileDevice = (id: string, input: Record<string, unknown>) => {
      const document = validContentDocument();
      document.scenes[0]!.visualCues = [
        cue({ id, template: { id: "scene.device-frame", version: 1 }, layer: "background", input }),
      ];
      return compileDocument({ document, assetResolver: resolver });
    };
    const screen = { kind: "media", assetId: "asset-screen-image", fit: "cover" } as const;

    const phone = compileDevice("vc-device-status", { frame: "phone", screen });
    expect(phone.html).toContain('class="kakeai-deviceframe-status kakeai-statusbar"');
    expect(phone.html).toContain("kakeai-statusbar-island");
    expect(phone.html).not.toContain('class="kakeai-laptopbase"');

    const phoneOff = compileDevice("vc-device-status-off", {
      frame: "phone",
      statusBar: false,
      screen,
    });
    expect(phoneOff.html).not.toContain('class="kakeai-deviceframe-status');

    const laptop = compileDevice("vc-device-keyboard", { frame: "laptop", screen });
    expect(laptop.html).toContain("kakeai-deviceframe-keyboard");
    expect(laptop.html).toContain('class="kakeai-laptopbase"');
    expect(laptop.html).not.toContain('class="kakeai-deviceframe-status');

    const laptopOff = compileDevice("vc-device-keyboard-off", {
      frame: "laptop",
      keyboard: false,
      screen,
    });
    expect(laptopOff.html).not.toContain('class="kakeai-laptopbase"');
  });

  it("renders a nested composition in a device-frame screen with contain fit", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-device-comp",
        template: { id: "scene.device-frame", version: 1 },
        layer: "background",
        input: {
          frame: "laptop",
          screen: { kind: "composition", compositionVersionId: "ver-nested", fit: "contain" },
        },
      }),
    ];
    const compiled = compileDocument({
      document,
      assetResolver: resolver,
      compositionResolver,
    });
    const zoomId = cueScope("vc-device-comp").child("screen").id("compzoom");
    expect(compiled.html).toContain("kakeai-compslot");
    expect(compiled.html).toContain(`id="${zoomId}"`);
    expect(compiled.html).toContain(
      "--kakeai-s:min(tan(atan2(100cqw,1920px)),tan(atan2(100cqh,1080px)))",
    );
    expect(compiled.html).toContain('data-composition-src="/preview/composition"');
    expect(compiled.compositionVersions).toHaveLength(1);
    expect(compiled.compositionVersions[0]!.id).toBe("ver-nested");
  });

  it("renders a portrait composition in a phone screen at default contain without letterbox", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-device-portrait",
        template: { id: "scene.device-frame", version: 1 },
        layer: "background",
        input: {
          frame: "phone",
          screen: { kind: "composition", compositionVersionId: "ver-portrait", fit: "contain" },
        },
      }),
    ];
    const portraitResolver: CompositionVersionResolver = (versionId) => ({
      id: versionId,
      runtimeCompositionId: "cmp.portrait",
      entrypoint: "index.html",
      bundleHash: "bundle-portrait",
      storageKey: "compositions/portrait",
      previewUrl: "/preview/portrait",
      manifest: {
        entrypoint: "index.html",
        runtimeCompositionId: "cmp.portrait",
        canvasProfile: "portrait",
        width: 1080,
        height: 1920,
        durationMs: 5000,
        dependencies: [],
      },
    });
    const compiled = compileDocument({
      document,
      assetResolver: resolver,
      compositionResolver: portraitResolver,
    });
    expect(compiled.html).toContain("aspect-ratio:9/16");
    expect(compiled.html).toContain("--kakeai-cw:1080px;--kakeai-ch:1920px");
    expect(compiled.html).toContain(
      "--kakeai-s:min(tan(atan2(100cqw,1080px)),tan(atan2(100cqh,1920px)))",
    );
    expect(compiled.html).toContain('data-width="1080"');
    expect(compiled.html).toContain('data-height="1920"');
    expect(compiled.compositionVersions[0]!.manifest.canvasProfile).toBe("portrait");
  });

  it("rejects a portrait composition in composition.full-bleed", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-fullbleed-portrait",
        template: { id: "composition.full-bleed", version: 1 },
        layer: "background",
        input: { compositionVersionId: "ver-portrait" },
      }),
    ];
    const portraitResolver: CompositionVersionResolver = (versionId) => ({
      id: versionId,
      runtimeCompositionId: "cmp.portrait",
      entrypoint: "index.html",
      bundleHash: "bundle-portrait",
      storageKey: "compositions/portrait",
      previewUrl: "/preview/portrait",
      manifest: {
        entrypoint: "index.html",
        runtimeCompositionId: "cmp.portrait",
        canvasProfile: "portrait",
        width: 1080,
        height: 1920,
        durationMs: 5000,
        dependencies: [],
      },
    });
    expect(() =>
      compileDocument({
        document,
        assetResolver: resolver,
        compositionResolver: portraitResolver,
      }),
    ).toThrow(/composition\.full-bleed/);
  });

  it("applies cover fit, zoom and position to a nested composition", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-device-comp-cover",
        template: { id: "scene.device-frame", version: 1 },
        layer: "background",
        input: {
          frame: "phone",
          screen: {
            kind: "composition",
            compositionVersionId: "ver-nested",
            fit: "cover",
            zoom: 1.5,
            position: { x: 0.2, y: 0.8 },
          },
        },
      }),
    ];
    const compiled = compileDocument({
      document,
      assetResolver: resolver,
      compositionResolver,
    });
    expect(compiled.html).toContain(
      "--kakeai-s:calc(max(tan(atan2(100cqw,1920px)),tan(atan2(100cqh,1080px))) * 1.5)",
    );
    expect(compiled.html).toContain("--kakeai-posx:0.2");
    expect(compiled.html).toContain("--kakeai-posy:0.8");
  });

  it("hides a nested composition at its own end when shorter than the cue", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-device-comp-short",
        template: { id: "scene.device-frame", version: 1 },
        layer: "background",
        input: {
          frame: "laptop",
          screen: { kind: "composition", compositionVersionId: "ver-nested", fit: "contain" },
        },
      }),
    ];
    const compiled = compileDocument({
      document,
      assetResolver: resolver,
      compositionResolver: compositionResolverWithDuration(1000),
    });
    const zoomId = cueScope("vc-device-comp-short").child("screen").id("compzoom");
    expect(compiled.html).toContain(
      `tl.set(document.getElementById("${zoomId}"),{opacity:0},1);`,
    );
  });

  it("does not hide a nested composition that covers the whole cue", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-device-comp-full",
        template: { id: "scene.device-frame", version: 1 },
        layer: "background",
        input: {
          frame: "laptop",
          screen: { kind: "composition", compositionVersionId: "ver-nested", fit: "contain" },
        },
      }),
    ];
    const compiled = compileDocument({
      document,
      assetResolver: resolver,
      compositionResolver: compositionResolverWithDuration(5000),
    });
    const zoomId = cueScope("vc-device-comp-full").child("screen").id("compzoom");
    expect(compiled.html).not.toContain(
      `tl.set(document.getElementById("${zoomId}"),{opacity:0}`,
    );
  });

  it("places the same CompositionVersion in two device screens (R2)", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-screen-a",
        template: { id: "scene.device-frame", version: 1 },
        layer: "background",
        order: 0,
        input: {
          frame: "laptop",
          screen: { kind: "composition", compositionVersionId: "ver-nested", fit: "contain" },
        },
      }),
      cue({
        id: "vc-screen-b",
        template: { id: "scene.device-frame", version: 1 },
        layer: "background",
        order: 1,
        input: {
          frame: "phone",
          screen: { kind: "composition", compositionVersionId: "ver-nested", fit: "cover" },
        },
      }),
    ];
    const compiled = compileDocument({
      document,
      assetResolver: resolver,
      compositionResolver,
    });
    const hostA = cueScope("vc-screen-a").child("screen").id("comp-host");
    const hostB = cueScope("vc-screen-b").child("screen").id("comp-host");
    expect(compiled.html).toContain(`id="${hostA}"`);
    expect(compiled.html).toContain(`id="${hostB}"`);
    expect(hostA).not.toBe(hostB);
    expect(compiled.compositionVersions).toHaveLength(1);
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

  it("animates the device-frame screen for scene.device-frame@1", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-device2",
        template: { id: "scene.device-frame", version: 1 },
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

  it("renders a site-mockup with chrome, nested media and logo", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-mockup",
        template: { id: "scene.site-mockup", version: 1 },
        layer: "card",
        input: {
          variant: "github",
          theme: "dark",
          name: "kakeai",
          handle: "@kakeai",
          caption: "README",
          screen: { kind: "media", assetId: "asset-screen", fit: "cover" },
          logo: { kind: "media", assetId: "asset-logo", fit: "contain" },
          animation: { preset: "slide-up", durationMs: 300 },
        },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.assetIds).toContain("asset-screen");
    expect(compiled.assetIds).toContain("asset-logo");
    expect(compiled.html).toContain("kakeai-mockup-github");
    expect(compiled.html).toContain("kakeai-mockup-theme-dark");
    const screenId = cueScope("vc-mockup").id("screen");
    expect(compiled.html).toContain(`id="${screenId}"`);
    expect(compiled.html).toContain(`document.getElementById("${screenId}")`);
    expect(compiled.html).toContain("y:60");
  });

  it("keeps two site-mockups from colliding", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-a",
        template: { id: "scene.site-mockup", version: 1 },
        layer: "card",
        order: 0,
        input: { variant: "x", screen: { kind: "media", assetId: "asset-a", fit: "cover" } },
      }),
      cue({
        id: "vc-b",
        template: { id: "scene.site-mockup", version: 1 },
        layer: "card",
        order: 1,
        input: { variant: "x", screen: { kind: "media", assetId: "asset-b", fit: "cover" } },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    const a = cueScope("vc-a").id("screen");
    const b = cueScope("vc-b").id("screen");
    expect(a).not.toBe(b);
    expect(compiled.html).toContain(`id="${a}"`);
    expect(compiled.html).toContain(`id="${b}"`);
  });

  it("rejects a nested-template screen in scene.site-mockup", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-bad",
        template: { id: "scene.site-mockup", version: 1 },
        layer: "card",
        input: {
          variant: "x",
          screen: {
            kind: "template",
            template: { id: "text.block", version: 1 },
            input: { text: "b", role: "body" },
          },
        },
      }),
    ];
    expect(() => compileDocument({ document, assetResolver: resolver })).toThrow(
      CompositionCompileError,
    );
  });

  it("renders a table.simple cue with staggered row tweens", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-table",
        template: { id: "table.simple", version: 1 },
        layer: "overlay",
        input: {
          caption: "料金プラン",
          data: {
            columns: [
              { key: "name", label: "プラン", type: "text" },
              { key: "price", label: "月額", type: "number", format: "currency" },
            ],
            rows: [
              { name: "Free", price: 0 },
              { name: "Pro", price: 1500 },
            ],
          },
          effects: [
            {
              target: { kind: "rows" },
              trigger: { kind: "cue" },
              effect: { kind: "appear", preset: "fade", durationMs: 400, staggerMs: 150 },
            },
          ],
        },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain("kakeai-table");
    expect(compiled.html).toContain("1,500");
    const firstRow = cueScope("vc-table").id("row-0");
    const secondRow = cueScope("vc-table").id("row-1");
    expect(compiled.html).toContain(`document.getElementById("${firstRow}")`);
    expect(compiled.html).toContain(`document.getElementById("${secondRow}")`);
    expect(compiled.html).toContain("opacity:0");
  });

  it("keeps two table.simple cues from colliding", () => {
    const document = validContentDocument();
    const input = {
      data: {
        columns: [{ key: "name", label: "項目", type: "text" }],
        rows: [{ name: "a" }],
      },
    };
    document.scenes[0]!.visualCues = [
      cue({ id: "vc-table-a", template: { id: "table.simple", version: 1 }, layer: "overlay", order: 0, input }),
      cue({ id: "vc-table-b", template: { id: "table.simple", version: 1 }, layer: "overlay", order: 1, input }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    const a = cueScope("vc-table-a").id("row-0");
    const b = cueScope("vc-table-b").id("row-0");
    expect(a).not.toBe(b);
    expect(compiled.html).toContain(`id="${a}"`);
    expect(compiled.html).toContain(`id="${b}"`);
  });

  it("renders a list.callout cue with line-triggered emphasis", () => {
    const document = validContentDocument();
    document.scenes[1]!.visualCues = [
      cue({
        id: "vc-callout",
        template: { id: "list.callout", version: 1 },
        layer: "overlay",
        input: {
          items: [
            {
              text: "再利用できる",
              trigger: { kind: "lines", startLineId: "line-p1-1", endLineId: "line-p1-1" },
              effect: { kind: "emphasize", style: "frame", tone: "primary" },
            },
            { text: "常時表示" },
          ],
        },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain("再利用できる");
    const item = cueScope("vc-callout").id("item-0");
    expect(compiled.html).toContain(`document.getElementById("${item}")`);
    expect(compiled.html).toContain("boxShadow");
  });

  it("renders a chart.bar cue with growing bars", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-chart",
        template: { id: "chart.bar", version: 1 },
        layer: "overlay",
        input: {
          title: "月別売上",
          data: {
            columns: [
              { key: "month", label: "月", type: "text" },
              { key: "sales", label: "売上", type: "number", format: "currency" },
            ],
            rows: [
              { month: "1月", sales: 100 },
              { month: "2月", sales: 200 },
            ],
          },
          effects: [
            {
              target: { kind: "bars" },
              trigger: { kind: "cue" },
              effect: { kind: "appear", preset: "bounce", durationMs: 600, staggerMs: 120 },
            },
          ],
        },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    const firstBar = cueScope("vc-chart").id("bar-0-0");
    const secondBar = cueScope("vc-chart").id("bar-1-0");
    expect(compiled.html).toContain("kakeai-chart");
    expect(compiled.html).toContain("￥200");
    expect(compiled.html).toContain(`document.getElementById("${firstBar}")`);
    expect(compiled.html).toContain(`document.getElementById("${secondBar}")`);
    expect(compiled.html).toContain("scaleY:0");
    expect(compiled.html).toContain('ease:"back.out(1.6)"');
  });
});

describe("visual theme", () => {
  it("emits theme variables on the composition root", () => {
    const compiled = compileDocument({ document: validContentDocument(), assetResolver: resolver });
    expect(compiled.html).toContain("--kakeai-canvas:#FAF6EE");
    expect(compiled.html).toContain("--kakeai-text:#232B3D");
    expect(compiled.html).toContain("--kakeai-accent-primary:#19736D");
    expect(compiled.html).toContain("--kakeai-accent-secondary:#A84D3E");
    expect(compiled.html).toContain("--kakeai-accent-tertiary:#80600F");
    expect(compiled.html).toContain("--kakeai-scrim:rgba(27,39,64,0.55)");
    expect(compiled.html).toContain("--kakeai-radius-lg:20px");
  });

  it("emits the caption safe area derived from the caption style", () => {
    const compiled = compileDocument({ document: validContentDocument(), assetResolver: resolver });
    expect(compiled.html).toContain("--kakeai-caption-offset:72px");
    expect(compiled.html).toContain("--kakeai-caption-safe:216px");
    expect(compiled.html).toContain("padding-bottom:var(--kakeai-caption-safe");
  });

  it("resolves a theme accent token into a soft scene background", () => {
    const document = validContentDocument();
    document.scenes[1]!.accent = { kind: "theme", token: "secondary" };
    const compiled = compileDocument({ document, assetResolver: resolver });
    const expected = `linear-gradient(135deg, ${mixHex("#A84D3E", "#FAF6EE", 0.72)} 0%, ${mixHex("#A84D3E", "#FAF6EE", 0.88)} 100%)`;
    expect(compiled.html).toContain(`background:${expected}`);
    expect(compiled.html).toContain("--kakeai-accent:#A84D3E");
    expect(compiled.html).toContain("--kakeai-accent-soft:");
    expect(compiled.html).toContain("--kakeai-accent-fg:");
  });

  it("mixes a custom accent with the theme canvas", () => {
    const document = validContentDocument();
    document.scenes[1]!.accent = { kind: "custom", color: "#123456" };
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain("--kakeai-accent:#123456");
    expect(compiled.html).toContain(`--kakeai-accent-soft:${mixHex("#123456", "#FAF6EE", 0.8)}`);
  });

  it("applies theme role defaults to text cues", () => {
    const compiled = compileDocument({ document: validContentDocument(), assetResolver: resolver });
    expect(compiled.html).toContain("color:#175C57");
    expect(compiled.html).toContain("font-size:72px");
    expect(compiled.html).toContain("color:#232B3D");
    expect(compiled.html).toContain("font-size:42px");
    expect(compiled.html).toContain("line-height:1.8");
  });

  it("lets explicit cue styles override theme role defaults", () => {
    const document = validContentDocument();
    document.scenes[1]!.visualCues = [
      cue({
        id: "vc-override",
        template: { id: "text.block", version: 1 },
        layer: "overlay",
        input: {
          text: "上書き",
          role: "body",
          font: "serif",
          fontSize: 100,
          color: "#FF0000",
          decoration: { bold: true },
        },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain("color:#FF0000");
    expect(compiled.html).toContain("font-size:100px");
    expect(compiled.html).toContain("Yu Mincho");
    expect(compiled.html).toContain("font-weight:700");
  });

  it("keeps theme defaults for unspecified decoration flags", () => {
    const document = validContentDocument();
    document.scenes[1]!.visualCues = [
      cue({
        id: "vc-partial",
        template: { id: "text.block", version: 1 },
        layer: "overlay",
        input: { text: "部分", role: "body", decoration: { italic: true } },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain("color:#232B3D");
    expect(compiled.html).toContain("font-style:italic");
    expect(compiled.html).toContain("font-weight:400");
  });

  it("styles burned-in captions from the caption token and scrim", () => {
    const compiled = compileDocument({ document: validContentDocument(), assetResolver: resolver });
    expect(compiled.html).toContain("color:#FFFFFF");
    expect(compiled.html).toContain("background:rgba(27,39,64,0.55)");
  });

  it("falls back to the theme surface for a device-frame without a background color", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-device-theme",
        template: { id: "scene.device-frame", version: 1 },
        layer: "background",
        input: {
          frame: "laptop",
          screen: { kind: "media", assetId: "asset-screen", fit: "cover" },
        },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain("background:#F1EAD9");
  });

  it("keeps the site-specific accent on site mockups", () => {
    const compiled = compileDocument({ document: validContentDocument(), assetResolver: resolver });
    expect(compiled.html).toContain("--kakeai-mockup-accent:#1d9bf0;");
    expect(compiled.html).toContain(
      "background:var(--kakeai-mockup-surface,var(--kakeai-surface))",
    );
  });

  it("rejects an unknown visual theme", () => {
    const document = validContentDocument();
    document.visualTheme = { id: "unknown-theme", version: 1 };
    try {
      compileDocument({ document, assetResolver: resolver });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CompositionCompileError);
      expect((error as CompositionCompileError).issues[0]?.code).toBe("unknown_theme");
    }
  });

  describe("character.standing@3", () => {
    const faceSet: SnapshotFaceSet = {
      id: "faceset-rin",
      name: "リン正面",
      layers: [
        { id: "brow-normal", part: "brow", assetId: "asset-brow", blinkLayerId: null, speakingLayerId: null },
        { id: "eye-normal", part: "eye", assetId: "asset-eye", blinkLayerId: null, speakingLayerId: null },
        { id: "mouth-normal", part: "mouth", assetId: "asset-mouth", blinkLayerId: null, speakingLayerId: null },
        { id: "eye-happy", part: "eye", assetId: "asset-eye-happy", blinkLayerId: null, speakingLayerId: null },
        { id: "fg", part: "foreground", assetId: "asset-fg", blinkLayerId: null, speakingLayerId: null },
      ],
      expressions: [
        { id: "normal", name: "通常", browLayerId: "brow-normal", eyeLayerId: "eye-normal", mouthLayerId: "mouth-normal" },
        { id: "happy", name: "笑い", browLayerId: "brow-normal", eyeLayerId: "eye-happy", mouthLayerId: "mouth-normal" },
      ],
    };

    const faceSetResolver: FaceSetResolver = (faceSetId) => {
      if (faceSetId !== faceSet.id) {
        throw new Error(`unknown face set: ${faceSetId}`);
      }
      return faceSet;
    };

    function faceDocument() {
      const document = validContentDocument();
      document.characters.push({
        id: "character-rin",
        name: "リン",
        names: [],
        voices: [],
        appearances: [
          { id: "appearance-rin", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: "faceset-rin" },
        ],
      });
      document.speakers.push(
        { id: "speaker-rin", name: "リン", characterId: "character-rin", voiceProfileId: null },
      );
      const scene = document.scenes[1]!;
      scene.lines = [
        {
          id: "line-happy",
          speakerId: "speaker-rin",
          captionText: "嬉しい",
          speechText: "うれしい",
          selectedAudioTakeId: null,
          expressionId: "happy",
        },
        {
          id: "line-normal",
          speakerId: "speaker-rin",
          captionText: "普通",
          speechText: "ふつう",
          selectedAudioTakeId: null,
          expressionId: null,
        },
      ];
      scene.visualCues = [
        cue({
          id: "vc-face",
          template: { id: "character.standing", version: 1 },
          layer: "standing",
          order: 0,
          input: {
            characterId: "character-rin",
            appearanceId: "appearance-rin",
            side: "left",
            scale: 1,
          },
        }),
      ];
      return document;
    }

    it("composes base, layers and foreground and switches expression per line", () => {
      const compiled = compileDocument({ document: faceDocument(), assetResolver: resolver, faceSetResolver });
      for (const assetId of [
        "asset-rin",
        "asset-brow",
        "asset-eye",
        "asset-eye-happy",
        "asset-mouth",
        "asset-fg",
      ]) {
        expect(compiled.assetIds).toContain(assetId);
        expect(compiled.html).toContain(`src="/preview/${assetId}"`);
      }
      const normalGroup = cueScope("vc-face").id("face-0");
      const happyGroup = cueScope("vc-face").id("face-1");
      expect(compiled.html).toContain(`<div id="${normalGroup}" class="kakeai-facegroup">`);
      expect(compiled.html).toContain(`<div id="${happyGroup}" class="kakeai-facegroup" style="opacity:0;">`);
      expect(compiled.html).toContain(
        `tl.set(document.getElementById("${happyGroup}"),{opacity:1},4.5);`,
      );
      expect(compiled.html).toContain(
        `tl.set(document.getElementById("${normalGroup}"),{opacity:0},4.5);`,
      );
      expect(compiled.html).toContain(
        `tl.set(document.getElementById("${normalGroup}"),{opacity:1},7);`,
      );
      expect(compiled.html).toContain(
        `tl.set(document.getElementById("${happyGroup}"),{opacity:0},7);`,
      );
    });

    it("bounces the wrapper together with the face layers", () => {
      const compiled = compileDocument({ document: faceDocument(), assetResolver: resolver, faceSetResolver });
      const wrapper = cueScope("vc-face").id("wrap");
      expect(compiled.html).toContain(`document.getElementById("${wrapper}")`);
      expect(compiled.html).toContain("y:-20");
    });

    it("renders base only when the appearance has no face set", () => {
      const document = faceDocument();
      document.characters[0]!.appearances[0]!.faceSetId = null;
      const compiled = compileDocument({ document, assetResolver: resolver, faceSetResolver });
      expect(compiled.html).not.toContain('class="kakeai-facegroup"');
      expect(compiled.html).toContain(`src="/preview/asset-rin"`);
      expect(compiled.assetIds).toEqual(
        expect.arrayContaining(["asset-rin", "asset-bg", "asset-bgm"]),
      );
      expect(compiled.assetIds).not.toContain("asset-brow");
    });

    it("fails before output when the face set cannot be resolved", () => {
      const document = faceDocument();
      try {
        compileDocument({ document, assetResolver: resolver });
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(CompositionCompileError);
        expect((error as CompositionCompileError).issues[0]?.code).toBe("unknown_face_set");
      }
    });

    it("fails before output when the face set has no normal preset", () => {
      const broken: SnapshotFaceSet = {
        ...faceSet,
        expressions: faceSet.expressions.filter((preset) => preset.id !== "normal"),
      };
      const document = faceDocument();
      try {
        compileDocument({
          document,
          assetResolver: resolver,
          faceSetResolver: () => broken,
        });
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(CompositionCompileError);
        expect((error as CompositionCompileError).issues[0]?.code).toBe("missing_normal_expression");
      }
    });

    it("falls back to normal for an unknown expression", () => {
      const document = faceDocument();
      document.scenes[1]!.lines[0]!.expressionId = "angry";
      const compiled = compileDocument({ document, assetResolver: resolver, faceSetResolver });
      const normalGroup = cueScope("vc-face").id("face-0");
      const happyGroup = cueScope("vc-face").id("face-1");
      expect(compiled.html).toContain(
        `tl.set(document.getElementById("${normalGroup}"),{opacity:1},4);`,
      );
      expect(compiled.html).toContain(
        `tl.set(document.getElementById("${happyGroup}"),{opacity:0},4);`,
      );
    });

    it("compiles deterministically", () => {
      const first = compileDocument({ document: faceDocument(), assetResolver: resolver, faceSetResolver });
      const second = compileDocument({ document: faceDocument(), assetResolver: resolver, faceSetResolver });
      expect(second.html).toBe(first.html);
    });

    describe("blink and mouth", () => {
      const variantFaceSet: SnapshotFaceSet = {
        id: "faceset-blink",
        name: "瞬き",
        layers: [
          { id: "brow", part: "brow", assetId: "asset-brow", blinkLayerId: null, speakingLayerId: null },
          { id: "eye", part: "eye", assetId: "asset-eye", blinkLayerId: "eye-closed", speakingLayerId: null },
          { id: "eye-closed", part: "eye", assetId: "asset-eye-closed", blinkLayerId: null, speakingLayerId: null },
          { id: "mouth", part: "mouth", assetId: "asset-mouth", blinkLayerId: null, speakingLayerId: "mouth-open" },
          { id: "mouth-open", part: "mouth", assetId: "asset-mouth-open", blinkLayerId: null, speakingLayerId: null },
        ],
        expressions: [
          { id: "normal", name: "通常", browLayerId: "brow", eyeLayerId: "eye", mouthLayerId: "mouth" },
          { id: "happy", name: "笑い", browLayerId: "brow", eyeLayerId: "eye", mouthLayerId: "mouth" },
        ],
      };

      const variantResolver: FaceSetResolver = (faceSetId) => {
        if (faceSetId !== variantFaceSet.id) {
          throw new Error(`unknown face set: ${faceSetId}`);
        }
        return variantFaceSet;
      };

      function variantDocument() {
        const document = faceDocument();
        document.characters[0]!.appearances[0]!.faceSetId = variantFaceSet.id;
        return document;
      }

      function setEvents(html: string): { elementId: string; visible: boolean; at: number }[] {
        const pattern =
          /tl\.set\(document\.getElementById\("([^"]+)"\),\{opacity:([01])\},([0-9.]+)\);/g;
        const events: { elementId: string; visible: boolean; at: number }[] = [];
        for (const match of html.matchAll(pattern)) {
          events.push({
            elementId: match[1]!,
            visible: match[2] === "1",
            at: Number(match[3]),
          });
        }
        return events;
      }

      it("renders closed-eye and open-mouth variants hidden with tracked assets", () => {
        const compiled = compileDocument({
          document: variantDocument(),
          assetResolver: resolver,
          faceSetResolver: variantResolver,
        });
        const eyeBlink = cueScope("vc-face").id("face-0-eye");
        const mouthSpeaking = cueScope("vc-face").id("face-0-mouth");
        expect(compiled.html).toContain(
          `<img id="${eyeBlink}" class="kakeai-face" src="/preview/asset-eye-closed" style="opacity:0;" alt="">`,
        );
        expect(compiled.html).toContain(
          `<img id="${mouthSpeaking}" class="kakeai-face" src="/preview/asset-mouth-open" style="opacity:0;" alt="">`,
        );
        expect(compiled.assetIds).toContain("asset-eye-closed");
        expect(compiled.assetIds).toContain("asset-mouth-open");
      });

      it("blinks across the whole cue and flaps the mouth only while speaking", () => {
        const compiled = compileDocument({
          document: variantDocument(),
          assetResolver: resolver,
          faceSetResolver: variantResolver,
        });
        const eyeBlinkIds = new Set(
          [0, 1].map((index) => cueScope("vc-face").id(`face-${index}-eye`)),
        );
        const eyeBaseIds = new Set(
          [0, 1].map((index) => cueScope("vc-face").id(`face-${index}-eye-base`)),
        );
        const mouthSpeakingIds = new Set(
          [0, 1].map((index) => cueScope("vc-face").id(`face-${index}-mouth`)),
        );
        const blinks = setEvents(compiled.html).filter((event) =>
          eyeBlinkIds.has(event.elementId),
        );
        const eyeBases = setEvents(compiled.html).filter((event) =>
          eyeBaseIds.has(event.elementId),
        );
        const mouths = setEvents(compiled.html).filter((event) =>
          mouthSpeakingIds.has(event.elementId),
        );
        expect(blinks.length).toBeGreaterThan(0);
        expect(mouths.length).toBeGreaterThan(0);
        for (const event of [...blinks, ...mouths]) {
          expect(event.at).toBeGreaterThanOrEqual(4);
          expect(event.at).toBeLessThanOrEqual(10);
        }
        const blinkOns = blinks.filter((event) => event.visible);
        expect(blinkOns.length).toBeGreaterThan(0);
        for (const on of blinkOns) {
          const off = blinks.find(
            (candidate) =>
              candidate.elementId === on.elementId && !candidate.visible && candidate.at > on.at,
          );
          expect(off).toBeDefined();
          expect(off!.at - on.at).toBeLessThanOrEqual(0.2);
          const baseId = on.elementId.replace(/-eye$/, "-eye-base");
          expect(
            eyeBases.some(
              (candidate) => candidate.elementId === baseId && !candidate.visible && candidate.at === on.at,
            ),
          ).toBe(true);
          expect(
            eyeBases.some(
              (candidate) => candidate.elementId === baseId && candidate.visible && candidate.at === off!.at,
            ),
          ).toBe(true);
        }
        for (const event of mouths.filter((candidate) => candidate.visible)) {
          expect(event.at).toBeGreaterThanOrEqual(4.5);
          expect(event.at).toBeLessThan(9.5);
        }
      });

      it("resets variants when the expression changes", () => {
        const compiled = compileDocument({
          document: variantDocument(),
          assetResolver: resolver,
          faceSetResolver: variantResolver,
        });
        const happyEye = cueScope("vc-face").id("face-1-eye");
        const happyMouth = cueScope("vc-face").id("face-1-mouth");
        expect(compiled.html).toContain(
          `tl.set(document.getElementById("${happyEye}"),{opacity:0},4.5);`,
        );
        expect(compiled.html).toContain(
          `tl.set(document.getElementById("${happyMouth}"),{opacity:0},4.5);`,
        );
      });

      it("emits no variant tweens when no variant is registered", () => {
        const compiled = compileDocument({ document: faceDocument(), assetResolver: resolver, faceSetResolver });
        expect(compiled.html).not.toContain("face-0-eye");
        expect(compiled.html).not.toContain("face-0-mouth");
        const events = setEvents(compiled.html);
        expect(events.every((event) => !event.elementId.includes("-eye") && !event.elementId.includes("-mouth"))).toBe(true);
      });

      it("compiles blink and mouth deterministically", () => {
        const first = compileDocument({
          document: variantDocument(),
          assetResolver: resolver,
          faceSetResolver: variantResolver,
        });
        const second = compileDocument({
          document: variantDocument(),
          assetResolver: resolver,
          faceSetResolver: variantResolver,
        });
        expect(second.html).toBe(first.html);
      });
    });
  });
});
