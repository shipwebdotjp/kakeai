import { describe, expect, it } from "vitest";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import { CompositionCompileError } from "../compile-error";
import { resolveVisualTheme } from "../theme";
import { compileMaterialCardRaw, compileStaticMaterialCard } from "./compile-card";
import { assertStaticHtml, stripScripts } from "./strip-scripts";

function imageResolver() {
  return (assetId: string) => ({
    url: `media/${assetId}.png`,
    kind: "image" as const,
    durationMs: null,
  });
}

describe("compileMaterialCard", () => {
  it("compiles one scene and produces a script-free static HTML variant", () => {
    const content = validContentDocument();
    const compiled = compileMaterialCardRaw({
      document: content,
      sceneId: "scene-intro",
      theme: resolveVisualTheme(content),
      durationMs: 4000,
      assetResolver: imageResolver(),
    });
    expect(compiled.html).toContain("kakeai-root");
    expect(compiled.durationMs).toBe(4000);
    const html = stripScripts(compiled.html);
    expect(html).not.toMatch(/<script\b/i);
    expect(() => assertStaticHtml(html, "scene-intro")).not.toThrow();
    expect(() => assertStaticHtml(compiled.html, "scene-intro")).toThrow();

    const staticCompiled = compileStaticMaterialCard({
      document: content,
      sceneId: "scene-intro",
      theme: resolveVisualTheme(content),
      durationMs: 4000,
      assetResolver: imageResolver(),
    });
    expect(staticCompiled.html).not.toMatch(/<script\b/i);
    expect(() => assertStaticHtml(staticCompiled.html, "scene-intro")).not.toThrow();
  });

  it("rejects scenes with lines, videos and unsupported templates", () => {
    const content = validContentDocument();
    const theme = resolveVisualTheme(content);
    const withLine = structuredClone(content);
    withLine.scenes[0]!.lines.push({
      id: "line-material",
      speakerId: null,
      captionText: "字幕",
      speechText: "こくじ",
      selectedAudioTakeId: null,
      expressionId: null,
    });
    expect(() =>
      compileMaterialCardRaw({
        document: withLine,
        sceneId: "scene-intro",
        theme,
        durationMs: 4000,
        assetResolver: imageResolver(),
      }),
    ).toThrow(CompositionCompileError);

    expect(() =>
      compileMaterialCardRaw({
        document: content,
        sceneId: "scene-intro",
        theme,
        durationMs: 4000,
        assetResolver: () => ({ url: "video.mp4", kind: "video", durationMs: 1000 }),
      }),
    ).toThrow(CompositionCompileError);
  });

  it("strips scripts and rejects event attributes", () => {
    expect(stripScripts('<div><script>alert(1)</script><p>ok</p></div>')).toBe(
      "<div><p>ok</p></div>",
    );
    expect(() => assertStaticHtml('<img src="x" onload="x()">', "scene")).toThrow(
      CompositionCompileError,
    );
    expect(() => assertStaticHtml('<a href="javascript:alert(1)">x</a>', "scene")).toThrow(
      CompositionCompileError,
    );
    expect(() => assertStaticHtml('<svg/onload="x()"></svg>', "scene")).toThrow(
      CompositionCompileError,
    );
    expect(() => assertStaticHtml('<a href="&#106;avascript:alert(1)">x</a>', "scene")).toThrow(
      CompositionCompileError,
    );
    expect(() => assertStaticHtml('<iframe srcdoc="<p>x</p>"></iframe>', "scene")).toThrow(
      CompositionCompileError,
    );
  });
});
