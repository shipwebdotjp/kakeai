import { describe, expect, it } from "vitest";
import {
  HANDMADE_PAPER_SKIN_REF,
  NEUTRAL_VISUAL_SKIN_REF,
  SOFT_EDITORIAL_THEME_ID,
  SOFT_EDITORIAL_THEME_VERSION,
  THEME_ACCENT_TOKENS,
  getVisualSkinDefinition,
  getVisualTheme,
  isLatestVisualThemeDefinition,
  latestVisualThemeDefinitions,
  listVisualSkinDefinitions,
  listVisualThemes,
  resolveVisualThemeSkin,
  toVisualThemeDefinitionV2,
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

describe("visualSkinRegistry", () => {
  it("ships neutral@1 as a known skin", () => {
    const refs = listVisualSkinDefinitions().map((skin) => `${skin.id}@${skin.version}`);
    expect(refs).toContain("neutral@1");
    expect(getVisualSkinDefinition("neutral", 1)?.name).toBe("Neutral");
    expect(getVisualSkinDefinition("neutral", 2)).toBeUndefined();
  });

  it("resolves a v1 theme definition to neutral@1 without rewriting it", () => {
    const theme = getVisualTheme(SOFT_EDITORIAL_THEME_ID, SOFT_EDITORIAL_THEME_VERSION)!;
    expect(theme.themeDefinitionSchemaVersion).toBe(1);
    expect(resolveVisualThemeSkin(theme)).toEqual(NEUTRAL_VISUAL_SKIN_REF);
  });

  it("requires skin on v2 theme definitions", () => {
    const theme = getVisualTheme(SOFT_EDITORIAL_THEME_ID, SOFT_EDITORIAL_THEME_VERSION)!;
    const withoutSkin = {
      ...theme,
      themeDefinitionSchemaVersion: 2,
    };
    expect(visualThemeDefinitionSchema.safeParse(withoutSkin).success).toBe(false);
  });

  it("accepts a v2 definition with a known skin", () => {
    const theme = getVisualTheme(SOFT_EDITORIAL_THEME_ID, SOFT_EDITORIAL_THEME_VERSION)!;
    const upgraded = {
      ...theme,
      themeDefinitionSchemaVersion: 2,
      skin: { id: "neutral", version: 1 },
    };
    const parsed = visualThemeDefinitionSchema.safeParse(upgraded);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(resolveVisualThemeSkin(parsed.data)).toEqual(NEUTRAL_VISUAL_SKIN_REF);
    }
  });

  it("rejects a v2 definition with an unknown skin", () => {
    const theme = getVisualTheme(SOFT_EDITORIAL_THEME_ID, SOFT_EDITORIAL_THEME_VERSION)!;
    const unknown = {
      ...theme,
      themeDefinitionSchemaVersion: 2,
      skin: { id: "no-such-skin", version: 1 },
    };
    expect(visualThemeDefinitionSchema.safeParse(unknown).success).toBe(false);
  });

  it("ships handmade-paper@1 as a known skin and accepts it in v2", () => {
    expect(getVisualSkinDefinition("handmade-paper", 1)?.name).toBe("Handmade Paper");
    const theme = getVisualTheme(SOFT_EDITORIAL_THEME_ID, SOFT_EDITORIAL_THEME_VERSION)!;
    const upgraded = toVisualThemeDefinitionV2(theme, HANDMADE_PAPER_SKIN_REF);
    expect(upgraded.themeDefinitionSchemaVersion).toBe(2);
    expect(upgraded.skin).toEqual(HANDMADE_PAPER_SKIN_REF);
    expect(visualThemeDefinitionSchema.safeParse(upgraded).success).toBe(true);
  });

  it("upgrades v1 definitions to v2 with neutral by default", () => {
    const theme = getVisualTheme(SOFT_EDITORIAL_THEME_ID, SOFT_EDITORIAL_THEME_VERSION)!;
    const upgraded = toVisualThemeDefinitionV2(theme);
    expect(upgraded.skin).toEqual(NEUTRAL_VISUAL_SKIN_REF);
    const kept = toVisualThemeDefinitionV2(upgraded);
    expect(kept).toBe(upgraded);
  });

  it("reports only the latest built-in definition as selectable", () => {
    const latest = latestVisualThemeDefinitions();
    expect(latest.map((definition) => `${definition.id}@${definition.version}`)).toContain(
      `${SOFT_EDITORIAL_THEME_ID}@${SOFT_EDITORIAL_THEME_VERSION}`,
    );
    expect(
      isLatestVisualThemeDefinition(
        SOFT_EDITORIAL_THEME_ID,
        SOFT_EDITORIAL_THEME_VERSION,
      ),
    ).toBe(true);
    expect(isLatestVisualThemeDefinition(SOFT_EDITORIAL_THEME_ID, 999)).toBe(false);
    expect(isLatestVisualThemeDefinition("missing", 1)).toBe(false);
  });
});
