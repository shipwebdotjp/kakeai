import { describe, expect, it } from "vitest";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import type { AssetResolver } from "./resolver";
import { CompositionCompileError } from "./compile-error";
import { compileDocument } from "./compiler";

const resolver: AssetResolver = (assetId) => {
  if (assetId.includes("audio") || assetId.includes("bgm")) {
    return { url: `/preview/${assetId}`, kind: "audio", durationMs: 3000 };
  }
  return { url: `/preview/${assetId}`, kind: assetId.includes("video") ? "video" : "image" };
};

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
    const scene = document.scenes[1];
    if (scene === undefined) {
      throw new Error("fixture changed");
    }
    scene.visualCues.push({
      id: "vc-p1-card",
      template: { id: "media.card", version: 1 },
      range: { kind: "lines", startLineId: "line-p1-1", endLineId: "line-p1-1" },
      input: { assetId: "asset-video-1", heading: "カード見出し" },
    });
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
    const scene = document.scenes[0];
    if (scene === undefined) {
      throw new Error("fixture changed");
    }
    scene.visualCues.push({
      id: "vc-unknown",
      template: { id: "media.full-bleed", version: 99 },
      range: { kind: "scene" },
      input: { assetId: "asset-bg", fit: "cover" },
    });
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
    const scene = document.scenes[1];
    if (scene === undefined) {
      throw new Error("fixture changed");
    }
    scene.visualCues.push({
      id: "vc-standing",
      template: { id: "character.standing", version: 1 },
      range: { kind: "scene" },
      input: { characterId: "character-rin", appearanceId: "appearance-smile", x: 0.8, y: 0.8, scale: 1 },
    });
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

  it("renders full-bleed below card regardless of document order", () => {
    const document = validContentDocument();
    const scene = document.scenes[0];
    if (scene === undefined) {
      throw new Error("fixture changed");
    }
    scene.visualCues.push({
      id: "vc-card-first",
      template: { id: "media.card", version: 1 },
      range: { kind: "scene" },
      input: { assetId: "asset-card", heading: "カード" },
    });
    scene.visualCues.push({
      id: "vc-bg-second",
      template: { id: "media.full-bleed", version: 1 },
      range: { kind: "scene" },
      input: { assetId: "asset-bg2", fit: "cover" },
    });
    const compiled = compileDocument({ document, assetResolver: resolver });
    const cardPosition = compiled.html.indexOf('id="kakeai-cue-0-1"');
    const bgPosition = compiled.html.indexOf('id="kakeai-cue-0-2"');
    expect(cardPosition).toBeGreaterThan(-1);
    expect(bgPosition).toBeGreaterThan(-1);
    expect(bgPosition).toBeLessThan(cardPosition);
  });

  it("renders a standing appearance with normalized position and scale", () => {
    const document = validContentDocument();
    document.characters.push({
      id: "character-rin",
      name: "リン",
      appearances: [
        {
          id: "appearance-smile",
          assetId: "asset-rin",
          expression: "smile",
          pose: "front",
        },
      ],
    });
    const scene = document.scenes[1];
    if (scene === undefined) {
      throw new Error("fixture changed");
    }
    scene.visualCues.push({
      id: "vc-standing",
      template: { id: "character.standing", version: 1 },
      range: { kind: "scene" },
      input: {
        characterId: "character-rin",
        appearanceId: "appearance-smile",
        x: 0.85,
        y: 0.85,
        scale: 1.5,
      },
    });
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.assetIds).toContain("asset-rin");
    expect(compiled.html).toContain('class="kakeai-standing"');
    expect(compiled.html).toContain('src="/preview/asset-rin"');
    expect(compiled.html).toContain("left:85%;top:85%;width:720px;");
  });

  it("fixes the cue layer order as background, card, standing, other", () => {
    const document = validContentDocument();
    document.characters.push({
      id: "character-rin",
      name: "リン",
      appearances: [
        {
          id: "appearance-smile",
          assetId: "asset-rin",
          expression: "smile",
          pose: "front",
        },
      ],
    });
    const scene = document.scenes[1];
    if (scene === undefined) {
      throw new Error("fixture changed");
    }
    scene.visualCues = [
      {
        id: "vc-text",
        template: { id: "text.body", version: 1 },
        range: { kind: "scene" },
        input: { heading: "見出し", body: "本文" },
      },
      {
        id: "vc-standing",
        template: { id: "character.standing", version: 1 },
        range: { kind: "scene" },
        input: {
          characterId: "character-rin",
          appearanceId: "appearance-smile",
          x: 0.5,
          y: 0.5,
          scale: 1,
        },
      },
      {
        id: "vc-card",
        template: { id: "media.card", version: 1 },
        range: { kind: "scene" },
        input: { assetId: "asset-card", heading: "カード" },
      },
      {
        id: "vc-bg",
        template: { id: "media.full-bleed", version: 1 },
        range: { kind: "scene" },
        input: { assetId: "asset-bg", fit: "cover" },
      },
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    const textPosition = compiled.html.indexOf('id="kakeai-cue-1-0"');
    const standingPosition = compiled.html.indexOf('id="kakeai-cue-1-1"');
    const cardPosition = compiled.html.indexOf('id="kakeai-cue-1-2"');
    const bgPosition = compiled.html.indexOf('id="kakeai-cue-1-3"');
    expect(bgPosition).toBeGreaterThan(-1);
    expect(cardPosition).toBeGreaterThan(bgPosition);
    expect(standingPosition).toBeGreaterThan(cardPosition);
    expect(textPosition).toBeGreaterThan(standingPosition);
    const slotPosition = compiled.html.indexOf('id="kakeai-scene-1-slot"');
    expect(slotPosition).toBeGreaterThan(textPosition);
  });
});
