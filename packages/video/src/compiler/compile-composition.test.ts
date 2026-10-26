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

});
