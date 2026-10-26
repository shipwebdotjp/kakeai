import { describe, expect, it } from "vitest";
import {
  getVisualTheme,
  type ThumbnailAppearance,
  type ThumbnailDocument,
} from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import type { AssetResolver } from "../resolver";
import { contrastRatio } from "../theme";
import { compileThumbnail } from "./compile";
import {
  headlineFitFactor,
  outlineShadow,
  resolveReadableAccent,
} from "./render";
import { THUMBNAIL_OUTPUT_HEIGHT, THUMBNAIL_OUTPUT_WIDTH } from "../meta";

const resolvedTheme = getVisualTheme("soft-editorial", 1);
if (resolvedTheme === undefined) {
  throw new Error("soft-editorial@1 is required for tests");
}
const theme = resolvedTheme;

const assetResolver: AssetResolver = (assetId) => ({ url: `/preview/${assetId}`, kind: "image" });

const BASE_INPUT = {
  headline: "テスト見出し",
  backgroundAssetId: "ast_bg",
  foregroundAssetId: "ast_fg",
};

function document(
  input: Record<string, unknown> = BASE_INPUT,
  appearanceOverride?: ThumbnailAppearance,
): ThumbnailDocument {
  return {
    schemaVersion: 2,
    template: { id: "thumbnail.cutout-hero", version: 1 },
    input,
    ...(appearanceOverride === undefined ? {} : { appearanceOverride }),
  };
}

function compile(
  input: Record<string, unknown> = BASE_INPUT,
  options: {
    appearanceOverride?: ThumbnailAppearance;
    appearance?: Parameters<typeof compileThumbnail>[0]["appearance"];
    locale?: Parameters<typeof compileThumbnail>[0]["locale"];
  } = {},
) {
  return compileThumbnail({
    document: document(input, options.appearanceOverride),
    theme,
    locale: options.locale ?? "ja-JP",
    assetResolver,
    appearance: options.appearance,
  });
}

describe("compileThumbnail", () => {
  it("renders a cutout thumbnail at 1280x720 with both images", () => {
    const compiled = compile();
    expect(compiled.width).toBe(THUMBNAIL_OUTPUT_WIDTH);
    expect(compiled.height).toBe(THUMBNAIL_OUTPUT_HEIGHT);
    expect(compiled.html).toContain("/preview/ast_bg");
    expect(compiled.html).toContain("/preview/ast_fg");
    expect(compiled.html).toContain("テスト見出し");
    expect(compiled.assetIds).toEqual(["ast_bg", "ast_fg"]);
  });

  it("changes the subject side", () => {
    const right = compile();
    const left = compile({ ...BASE_INPUT, subjectSide: "left" });
    expect(right.html).toContain('class="kakeai-thumb-foreground" style="position:absolute;bottom:0;left:75%');
    expect(left.html).toContain('class="kakeai-thumb-foreground" style="position:absolute;bottom:0;left:25%');
    expect(right.html).not.toBe(left.html);
  });

  it("flips the foreground and scales it up to 1.8", () => {
    const flipped = compile({ ...BASE_INPUT, flipForeground: true });
    expect(flipped.html).toContain("transform:scaleX(-1)");
    const scaled = compile({ ...BASE_INPUT, subjectScale: 1.8 });
    expect(scaled.html).toContain("transform:scale(1.8)");
    expect(scaled.html).toContain("transform-origin:50% 100%");
  });

  it("changes the subject scaling anchor", () => {
    const expected: Record<string, string> = {
      "bottom-center": "50% 100%",
      center: "50% 50%",
      "top-left": "0% 0%",
      "top-right": "100% 0%",
      "bottom-left": "0% 100%",
      "bottom-right": "100% 100%",
    };
    for (const [anchor, origin] of Object.entries(expected)) {
      expect(compile({ ...BASE_INPUT, subjectAnchor: anchor }).html).toContain(
        `transform-origin:${origin}`,
      );
    }
  });

  it("changes the text block width and can disable wrapping", () => {
    const wide = compile({ ...BASE_INPUT, textWidth: 80 });
    expect(wide.html).toContain("width:80%");
    const wrapped = compile();
    expect(wrapped.html).toContain("white-space:pre-line");
    const noWrap = compile({ ...BASE_INPUT, wrapText: false });
    expect(noWrap.html).toContain("white-space:pre;");
    expect(noWrap.html).not.toContain("white-space:pre-line");
  });

  it("applies common appearance and lets the candidate override it", () => {
    const longHeadline =
      "%%強調%%この見出しはとても長いので自動で小さくなることを確認するための文章です";
    const compiled = compile(
      { ...BASE_INPUT, headline: longHeadline },
      {
        appearance: {
          headline: { fontSize: 120, color: "#00FFFF" },
          accent: "#FF00FF",
        },
        appearanceOverride: {
          headline: {
            color: "#123456",
            lineHeight: 2,
            outline: { color: "#00FF00", width: 6 },
          },
          scrim: { opacity: 0.2 },
        },
      },
    );
    expect(compiled.html).toContain("font-size:80px");
    expect(compiled.html).toContain("line-height:2");
    expect(compiled.html).toContain("color:#123456");
    expect(compiled.html).not.toContain("color:#00FFFF");
    expect(compiled.html).toContain("rgba(0,255,0,.85)");
    expect(compiled.html).toContain("rgba(27,39,64,0.2)");
  });

  it("renders a v1 document and still applies the language-edition appearance", () => {
    const compiled = compileThumbnail({
      document: {
        schemaVersion: 1,
        template: { id: "thumbnail.cutout-hero", version: 1 },
        input: BASE_INPUT,
      },
      theme,
      locale: "ja-JP",
      assetResolver,
      appearance: { headline: { color: "#00FFFF" } },
    });
    expect(compiled.html).toContain("color:#00FFFF");
    expect(compiled.assetIds).toEqual(["ast_bg", "ast_fg"]);
  });

  it("uses the language-edition locale for the html lang and the theme locale font", () => {
    const face = (family: string) => ({
      family,
      style: "normal" as const,
      weight: 400,
      fallbacks: [],
    });
    const localizedTheme = {
      ...theme,
      textRoles: {
        ...theme.textRoles,
        title: {
          ...theme.textRoles.title,
          fontFaceByLocale: { "zh-Hant": face("PingFang TC") },
        },
      },
    };
    const compiled = compileThumbnail({
      document: document(),
      theme: localizedTheme,
      locale: "zh-Hant",
      assetResolver,
    });
    expect(compiled.html).toContain('<html lang="zh-Hant">');
    expect(compiled.html).toContain("'PingFang TC'");
    // An explicit appearance face still wins over the theme locale entry.
    const overridden = compileThumbnail({
      document: document(),
      theme: localizedTheme,
      locale: "zh-Hant",
      assetResolver,
      appearance: { headline: { fontFace: face("Explicit Font") } },
    });
    expect(overridden.html).toContain("font-family:'Explicit Font'");
  });

  it("uses an explicit accent without automatic contrast adjustment", () => {
    const compiled = compile(
      { ...BASE_INPUT, headline: "==強調==" },
      { appearance: { accent: "#FF00FF" } },
    );
    expect(compiled.html).toContain("color:#FF00FF");
  });

  it("keeps Theme accents readable", () => {
    const compiled = compile({ ...BASE_INPUT, headline: "==強調==" });
    const readable = resolveReadableAccent(theme, "primary", theme.scrim.color);
    expect(contrastRatio(readable, theme.scrim.color)).toBeGreaterThanOrEqual(3);
    expect(compiled.html).toContain(`color:${readable}`);
  });

  it("applies whole-role outline and inline outline with the same style", () => {
    const compiled = compile(
      { ...BASE_INPUT, headline: "見出しと%%強調%%" },
      {
        appearance: {
          headline: {
            decoration: { outline: true },
            outline: { color: "#00FF00", width: 6 },
          },
        },
      },
    );
    expect(compiled.html).toContain("text-shadow:");
    expect(compiled.html).toContain("rgba(0,255,0,.85)");
    expect(compiled.html.match(/rgba\(0,255,0,\.85\)/g)?.length ?? 0).toBeGreaterThan(8);
  });

  it("supports bold, italic, accent, outline, escaping, and newlines", () => {
    const compiled = compile({
      ...BASE_INPUT,
      headline: "**太字**と*斜体*と==色==と%%縁取り%%\n2行目 <tag>",
    });
    expect(compiled.html).toContain('<span style="font-weight:700">太字</span>');
    expect(compiled.html).toContain('<span style="font-style:italic">斜体</span>');
    expect(compiled.html).toContain("color:");
    expect(compiled.html).toContain("text-shadow:");
    expect(compiled.html).toContain("&lt;tag&gt;");
    expect(compiled.html).toContain("white-space:pre-line");
    expect(compiled.html).toContain("\n2行目");
  });

  it("sizes headlines down as the visible text grows", () => {
    expect(headlineFitFactor("短い見出し")).toBeGreaterThan(
      headlineFitFactor("この見出しはとても長いので自動で小さくなることを確認するための文章です"),
    );
    const short = compile({ ...BASE_INPUT, headline: "短い見出し" });
    const long = compile({
      ...BASE_INPUT,
      headline: "この見出しはとても長いので自動で小さくなることを確認するための文章です",
    });
    expect(short.html).not.toBe(long.html);
  });

  it("renders deterministically", () => {
    const input = { ...BASE_INPUT, headline: "==強調==と**太字**", subjectSide: "left" };
    expect(compile(input).html).toBe(compile(input).html);
  });

  it("fails on an unknown template", () => {
    expect(() =>
      compileThumbnail({
        document: {
          schemaVersion: 2,
          template: { id: "thumbnail.missing", version: 1 },
          input: BASE_INPUT,
        },
        theme,
        locale: "ja-JP",
        assetResolver,
      }),
    ).toThrow(CompositionCompileError);
  });

  it("fails on invalid input", () => {
    expect(() => compile({ ...BASE_INPUT, foregroundAssetId: undefined })).toThrow(
      CompositionCompileError,
    );
  });
});

describe("outlineShadow", () => {
  it("builds a wider ring for a larger width", () => {
    expect(outlineShadow("#FFFFFF", 0)).toBe("");
    expect(outlineShadow("#FFFFFF", 3)).toContain("2px 2px 0");
    expect(outlineShadow("#FFFFFF", 12)).toContain("8px 8px 0");
  });
});
