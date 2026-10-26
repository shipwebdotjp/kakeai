import { describe, expect, it } from "vitest";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import {
  accentForegroundHex,
  accentSoftHex,
  contrastRatio,
  hexToRgb,
  mixHex,
  overlayToRgba,
  relativeLuminance,
  resolveFontFamilyCss,
  resolveSceneAccentHex,
  resolveVisualTheme,
  rgbToHex,
  sceneAccentStyle,
  themeRootStyle,
} from "./theme";

describe("resolveFontFamilyCss", () => {
  it("falls back to the category stack without a font face", () => {
    expect(resolveFontFamilyCss(undefined, "sans", "ja-JP")).toContain("sans-serif");
    expect(resolveFontFamilyCss({}, "serif", "ja-JP")).toContain("serif");
  });

  it("pins the selected local face before its family and the category stack", () => {
    expect(
      resolveFontFamilyCss({ platformId: "YuMin-Medium", family: "游明朝体" }, "serif", "ja-JP"),
    ).toBe("'YuMin-Medium','游明朝体','Hiragino Mincho ProN','Yu Mincho','MS PMincho',serif");
  });

  it("keeps a family-only font face usable", () => {
    expect(resolveFontFamilyCss({ family: "Hiragino Sans" }, "sans", "ja-JP")).toMatch(
      /^'Hiragino Sans','Noto Sans JP'/,
    );
  });

  it("drops duplicate names and escapes unsafe characters", () => {
    expect(
      resolveFontFamilyCss({ platformId: "YuMin-Medium", family: "yumin-medium" }, "serif", "ja-JP"),
    ).toMatch(/^'YuMin-Medium','Hiragino Mincho ProN'/);
    expect(resolveFontFamilyCss({ platformId: "Bad';}{Name" }, "sans", "ja-JP")).toMatch(
      /^'BadName',/,
    );
  });

  it("uses the simplified and traditional Chinese stacks for zh locales", () => {
    expect(resolveFontFamilyCss(undefined, "sans", "zh-Hans")).toMatch(/^'PingFang SC'/);
    expect(resolveFontFamilyCss(undefined, "sans", "zh-Hant")).toMatch(/^'PingFang TC'/);
    expect(resolveFontFamilyCss(undefined, "mono", "zh-Hans")).toMatch(
      /^'SFMono-Regular'.*'PingFang SC','Noto Sans SC',monospace$/,
    );
  });
});

describe("theme color math", () => {
  it("mixes two hex colors", () => {
    expect(mixHex("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(mixHex("#123456", "#FAF6EE", 0)).toBe("#123456");
    expect(mixHex("#123456", "#FAF6EE", 1)).toBe("#FAF6EE");
  });

  it("round-trips hex through rgb", () => {
    expect(rgbToHex(hexToRgb("#19736D"))).toBe("#19736D");
  });

  it("renders an overlay as rgba", () => {
    expect(overlayToRgba({ color: "#1B2740", opacity: 0.55 })).toBe("rgba(27,39,64,0.55)");
  });

  it("computes contrast ratios", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBe(0);
  });

  it("picks white for dark soft accents and body text for light ones", () => {
    const theme = resolveVisualTheme(validContentDocument());
    expect(accentForegroundHex("#1E3A38", theme)).toBe("#FFFFFF");
    expect(accentForegroundHex("#EDE6D3", theme)).toBe(theme.text);
  });
});

describe("theme resolution", () => {
  it("resolves the document theme", () => {
    const theme = resolveVisualTheme(validContentDocument());
    expect(theme.id).toBe("soft-editorial");
  });

  it("resolves theme tokens and custom colors for scene accents", () => {
    const theme = resolveVisualTheme(validContentDocument());
    const document = validContentDocument();
    document.scenes[0]!.accent = { kind: "theme", token: "tertiary" };
    expect(resolveSceneAccentHex(document.scenes[0]!, theme)).toBe("#80600F");
    document.scenes[0]!.accent = { kind: "custom", color: "#abcdef" };
    expect(resolveSceneAccentHex(document.scenes[0]!, theme)).toBe("#ABCDEF");
  });

  it("derives soft and foreground values for a custom accent", () => {
    const theme = resolveVisualTheme(validContentDocument());
    expect(accentSoftHex("#123456", theme)).toBe(mixHex("#123456", "#FAF6EE", 0.8));
    expect(sceneAccentStyle("#123456", theme)).toContain("--kakeai-accent:#123456");
    expect(themeRootStyle(theme, "ja-JP")).toContain("--kakeai-canvas:#FAF6EE");
  });
});
