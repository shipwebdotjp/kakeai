import { describe, expect, it } from "vitest";
import {
  SOFT_EDITORIAL_THEME_ID,
  SOFT_EDITORIAL_THEME_VERSION,
  THEME_ACCENT_TOKENS,
  getVisualTheme,
  listVisualThemes,
  visualThemeDefinitionSchema,
  visualThemeRefSchema,
} from "./theme";

describe("visualThemeRegistry", () => {
  it("resolves soft-editorial@1", () => {
    const theme = getVisualTheme(SOFT_EDITORIAL_THEME_ID, SOFT_EDITORIAL_THEME_VERSION);
    expect(theme?.id).toBe("soft-editorial");
    expect(theme?.version).toBe(1);
    expect(theme?.accents).toEqual({
      primary: "#19736D",
      secondary: "#A84D3E",
      tertiary: "#80600F",
    });
  });

  it("returns undefined for an unknown theme", () => {
    expect(getVisualTheme("unknown-theme", 1)).toBeUndefined();
    expect(getVisualTheme(SOFT_EDITORIAL_THEME_ID, 2)).toBeUndefined();
  });

  it("lists the built-in themes", () => {
    expect(listVisualThemes().map((theme) => `${theme.id}@${theme.version}`)).toContain(
      "soft-editorial@1",
    );
  });

  it("validates the built-in definitions against the definition schema", () => {
    for (const theme of listVisualThemes()) {
      expect(visualThemeDefinitionSchema.safeParse(theme).success).toBe(true);
    }
  });

  it("accepts a well-formed theme reference", () => {
    expect(
      visualThemeRefSchema.safeParse({ id: "soft-editorial", version: 1 }).success,
    ).toBe(true);
  });

  it("covers the three accent tokens", () => {
    expect([...THEME_ACCENT_TOKENS].sort()).toEqual(["primary", "secondary", "tertiary"]);
    const theme = getVisualTheme(SOFT_EDITORIAL_THEME_ID, SOFT_EDITORIAL_THEME_VERSION)!;
    for (const token of THEME_ACCENT_TOKENS) {
      expect(theme.accents[token]).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it("defines text tokens for every text role", () => {
    const theme = getVisualTheme(SOFT_EDITORIAL_THEME_ID, SOFT_EDITORIAL_THEME_VERSION)!;
    expect(Object.keys(theme.textRoles).sort()).toEqual([
      "body",
      "caption",
      "closing",
      "code",
      "heading",
      "label",
      "subtitle",
      "title",
    ]);
    for (const token of Object.values(theme.textRoles)) {
      expect(token.fontSize).toBeGreaterThanOrEqual(8);
      expect(token.color).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it("rejects a definition with a malformed color", () => {
    const theme = getVisualTheme(SOFT_EDITORIAL_THEME_ID, SOFT_EDITORIAL_THEME_VERSION)!;
    const broken = {
      ...theme,
      accents: { ...theme.accents, primary: "#19736d" },
    };
    expect(visualThemeDefinitionSchema.safeParse(broken).success).toBe(false);
  });
});
