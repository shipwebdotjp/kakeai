import { describe, expect, it } from "vitest";
import { getVisualTheme } from "../content/theme";
import {
  DEFAULT_THUMBNAIL_OUTLINE_WIDTH,
  applyThumbnailAppearance,
  mergeThumbnailAppearance,
  normalizeThumbnailAppearance,
  resolveThumbnailAppearanceDefaults,
  thumbnailAppearanceSchema,
} from "./appearance";

const theme = getVisualTheme("soft-editorial", 1);
if (theme === undefined) {
  throw new Error("soft-editorial@1 is required for tests");
}

describe("thumbnail appearance", () => {
  it("derives typography from the theme and colors from on-media", () => {
    const defaults = resolveThumbnailAppearanceDefaults(theme, "ja-JP");
    expect(defaults.headline.fontSize).toBe(theme.textRoles.title.fontSize);
    expect(defaults.subline.fontSize).toBe(theme.textRoles.heading.fontSize);
    expect(defaults.headline.color).toBe(theme.onMedia);
    expect(defaults.subline.color).toBe(theme.onMedia);
    expect(defaults.headline.outline).toEqual({
      color: null,
      width: DEFAULT_THUMBNAIL_OUTLINE_WIDTH,
    });
    expect(defaults.accent).toBe(theme.accents.primary);
    expect(defaults.scrim).toEqual(theme.scrim);
  });

  it("merges common and candidate overrides per property", () => {
    const merged = mergeThumbnailAppearance(
      {
        headline: {
          fontSize: 80,
          color: "#111111",
          decoration: { bold: false },
          outline: { color: "#000000", width: 4 },
        },
        accent: "#FF0000",
        scrim: { opacity: 0.3 },
      },
      {
        headline: {
          color: "#222222",
          decoration: { italic: true },
          outline: { width: 6 },
        },
        scrim: { color: "#000000" },
      },
    );
    expect(merged).toEqual({
      headline: {
        fontSize: 80,
        color: "#222222",
        decoration: { bold: false, italic: true },
        outline: { color: "#000000", width: 6 },
      },
      accent: "#FF0000",
      scrim: { opacity: 0.3, color: "#000000" },
    });
  });

  it("applies the merged patch over theme defaults", () => {
    const defaults = resolveThumbnailAppearanceDefaults(theme, "ja-JP");
    const resolved = applyThumbnailAppearance(
      defaults,
      {
        headline: {
          fontSize: 80,
          color: "#222222",
          decoration: { bold: false, italic: true },
          outline: { color: "#000000", width: 6 },
        },
        accent: "#FF0000",
        scrim: { opacity: 0.3, color: "#000000" },
      },
      "ja-JP",
    );
    expect(resolved.headline.fontSize).toBe(80);
    expect(resolved.headline.color).toBe("#222222");
    expect(resolved.headline.decoration).toEqual({ ...defaults.headline.decoration, bold: false, italic: true });
    expect(resolved.headline.outline).toEqual({ color: "#000000", width: 6 });
    expect(resolved.subline).toEqual(defaults.subline);
    expect(resolved.accent).toBe("#FF0000");
    expect(resolved.scrim).toEqual({ color: "#000000", opacity: 0.3 });
  });

  it("drops empty groups when normalizing", () => {
    expect(normalizeThumbnailAppearance(null)).toBeNull();
    expect(normalizeThumbnailAppearance({})).toBeNull();
    expect(normalizeThumbnailAppearance({ headline: {} })).toBeNull();
    expect(normalizeThumbnailAppearance({ headline: { decoration: {} } })).toBeNull();
    expect(normalizeThumbnailAppearance({ scrim: {} })).toBeNull();
  });

  it("prefers the locale font from the theme without dropping the shared face", () => {
    const localized = {
      ...theme,
      textRoles: {
        ...theme.textRoles,
        title: {
          ...theme.textRoles.title,
          fontFace: { family: "Noto Sans JP", style: "normal" as const, weight: 400, fallbacks: [] },
          fontFaceByLocale: {
            "zh-Hant": { family: "PingFang TC", style: "normal" as const, weight: 400, fallbacks: [] },
          },
        },
      },
    };
    const zhDefaults = resolveThumbnailAppearanceDefaults(localized, "zh-Hant");
    expect(zhDefaults.headline.fontFace?.family).toBe("PingFang TC");
    expect("fontFaceByLocale" in zhDefaults.headline).toBe(false);
    const jaDefaults = resolveThumbnailAppearanceDefaults(localized, "ja-JP");
    expect(jaDefaults.headline.fontFace?.family).toBe("Noto Sans JP");
  });

  it("uses the appearance font for the matching locale only", () => {
    const face = (family: string) => ({
      family,
      style: "normal" as const,
      weight: 400,
      fallbacks: [],
    });
    const defaults = resolveThumbnailAppearanceDefaults(theme, "zh-Hant");
    const resolved = applyThumbnailAppearance(
      defaults,
      {
        headline: {
          fontFaceByLocale: { "zh-Hant": face("Explicit TC") },
        },
      },
      "zh-Hant",
    );
    expect(resolved.headline.fontFace?.family).toBe("Explicit TC");

    // A face for another locale does not affect the rendered locale; the Theme
    // font stays in effect.
    const otherLocale = applyThumbnailAppearance(
      defaults,
      { headline: { fontFaceByLocale: { "en-US": face("English Only") } } },
      "zh-Hant",
    );
    expect(otherLocale.headline.fontFace?.family).toBe(defaults.headline.fontFace?.family);
  });

  it("lets a candidate locale font override the Work appearance per locale", () => {
    const face = (family: string) => ({
      family,
      style: "normal" as const,
      weight: 400,
      fallbacks: [],
    });
    const workAppearance = {
      headline: {
        fontSize: 100,
        fontFaceByLocale: { "ja-JP": face("Work JA"), "en-US": face("Work EN") },
      },
    };
    const candidateOverride = {
      headline: {
        fontFaceByLocale: { "ja-JP": face("Candidate JA") },
      },
    };
    const merged = mergeThumbnailAppearance(workAppearance, candidateOverride);
    expect(merged?.headline?.fontFaceByLocale).toEqual({
      "ja-JP": face("Candidate JA"),
      "en-US": face("Work EN"),
    });
    expect(merged?.headline?.fontSize).toBe(100);

    const defaults = resolveThumbnailAppearanceDefaults(theme, "ja-JP");
    const resolved = applyThumbnailAppearance(defaults, merged, "ja-JP");
    expect(resolved.headline.fontFace?.family).toBe("Candidate JA");
    expect(resolved.headline.fontSize).toBe(100);
  });

  it("validates outline width, colors, and unknown keys", () => {
    expect(
      thumbnailAppearanceSchema.safeParse({
        headline: { outline: { color: "#FFFFFF", width: 12 } },
      }).success,
    ).toBe(true);
    expect(
      thumbnailAppearanceSchema.safeParse({ headline: { outline: { width: 13 } } }).success,
    ).toBe(false);
    expect(
      thumbnailAppearanceSchema.safeParse({ headline: { outline: { width: -1 } } }).success,
    ).toBe(false);
    expect(
      thumbnailAppearanceSchema.safeParse({ headline: { outline: { color: "#fff" } } }).success,
    ).toBe(false);
    expect(
      thumbnailAppearanceSchema.safeParse({ headline: { unknown: true } }).success,
    ).toBe(false);
  });
});
