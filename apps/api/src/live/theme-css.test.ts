import { describe, expect, it } from "vitest";
import { DEFAULT_VISUAL_THEME_REF, getVisualTheme } from "@kakeai/contracts";
import { buildThemeCss, manifestFontsFromResolution } from "./theme-css";
import type { ThemeFontResolution } from "../services/font-catalog.ts";

describe("live theme CSS", () => {
  it("writes theme variables and role font families", () => {
    const theme = getVisualTheme(DEFAULT_VISUAL_THEME_REF.id, DEFAULT_VISUAL_THEME_REF.version);
    expect(theme).toBeDefined();
    const css = buildThemeCss(theme!, "ja-JP");
    expect(css.startsWith(":root{")).toBe(true);
    expect(css).toContain("--kakeai-canvas:");
    expect(css).toContain("--kakeai-font-caption:");
    expect(css).toContain("--kakeai-font-title:");
    expect(css).toContain("--kakeai-text-caption-size:");
    expect(css).toContain("--kakeai-text-caption-color:");
    expect(css).toContain("--kakeai-text-caption-line-height:");
  });

  it("records found and fallback font roles", () => {
    const resolution: ThemeFontResolution = {
      catalogSupported: true,
      verificationSupported: true,
      verificationReason: null,
      roles: [
        {
          role: "caption",
          category: "sans",
          localFaceName: "Noto Sans JP",
          localFaceWeight: 400,
          localFaceStyle: "normal",
          usesFallback: false,
        },
        {
          role: "title",
          category: "serif",
          localFaceName: undefined,
          localFaceWeight: undefined,
          localFaceStyle: undefined,
          usesFallback: true,
        },
      ],
      missingFonts: ["Missing"],
      diagnostics: [],
    };
    const fonts = manifestFontsFromResolution(resolution);
    expect(fonts[0]).toMatchObject({ role: "caption", family: "Noto Sans JP", found: true });
    expect(fonts[1]).toMatchObject({ role: "title", found: false, required: false });
    expect(fonts[1]?.fallback.length).toBeGreaterThan(0);
  });
});
