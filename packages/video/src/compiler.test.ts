import { describe, expect, it } from "vitest";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import type { AssetResolver } from "./resolver";
import { CompositionCompileError } from "./compile-error";
import { compileDocument } from "./compiler";

const resolver: AssetResolver = (assetId) => ({
  url: `/preview/${assetId}`,
  kind: assetId.includes("video") ? "video" : "image",
});

describe("compileDocument", () => {
  it("renders five scenes back to back with resolved asset urls", () => {
    const compiled = compileDocument({ document: validContentDocument(), assetResolver: resolver });
    expect(compiled.durationMs).toBe(14000);
    expect(compiled.assetIds).toEqual(["asset-bg"]);
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
    expect(compiled.assetIds).toEqual(["asset-bg", "asset-video-1"]);
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
});
