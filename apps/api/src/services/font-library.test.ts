import { describe, expect, it } from "vitest";
import type { FontCatalog, FontFace } from "@kakeai/contracts";
import { searchFonts } from "./font-library.ts";

const updatedAt = "2026-01-01T00:00:00.000Z";

function face(overrides: Partial<FontFace> & Pick<FontFace, "family" | "postScriptName">): FontFace {
  return {
    platformId: overrides.postScriptName,
    displayName: overrides.postScriptName,
    weight: 400,
    style: "normal",
    stretch: "normal",
    available: true,
    ...overrides,
  };
}

const catalog: FontCatalog = {
  supported: true,
  reason: null,
  updatedAt,
  faces: [
    face({
      family: "Hiragino Sans",
      displayName: "Hiragino Sans W6",
      postScriptName: "HiraginoSans-W6",
      weight: 600,
    }),
    face({
      family: "Times New Roman",
      displayName: "Times New Roman Italic",
      postScriptName: "TimesNewRomanPS-ItalicMT",
      style: "italic",
    }),
    face({
      family: "Hiragino Sans",
      displayName: "Hiragino Sans W3",
      postScriptName: "HiraginoSans-W3",
      weight: 300,
    }),
    face({
      family: "Hiragino Mincho ProN",
      displayName: "Hiragino Mincho ProN W3",
      postScriptName: "HiraginoMinchoProN-W3",
      weight: 300,
    }),
  ],
};

describe("searchFonts", () => {
  it("sorts by family, weight and PostScript name", () => {
    const result = searchFonts(catalog, { limit: 50, offset: 0 });
    expect(result.fonts.map((entry) => entry.postScriptName)).toEqual([
      "HiraginoMinchoProN-W3",
      "HiraginoSans-W3",
      "HiraginoSans-W6",
      "TimesNewRomanPS-ItalicMT",
    ]);
    expect(result.total).toBe(4);
    expect(result.nextOffset).toBeNull();
  });

  it("matches the query across family, display name and PostScript name", () => {
    const byFamily = searchFonts(catalog, { query: "mincho", limit: 50, offset: 0 });
    expect(byFamily.fonts.map((entry) => entry.postScriptName)).toEqual([
      "HiraginoMinchoProN-W3",
    ]);
    const byDisplay = searchFonts(catalog, { query: "italic", limit: 50, offset: 0 });
    expect(byDisplay.fonts.map((entry) => entry.postScriptName)).toEqual([
      "TimesNewRomanPS-ItalicMT",
    ]);
    const byPostScript = searchFonts(catalog, {
      query: "HiraginoSans-W6",
      limit: 50,
      offset: 0,
    });
    expect(byPostScript.total).toBe(1);
  });

  it("filters by style, weight range and availability", () => {
    expect(
      searchFonts(catalog, { style: "italic", limit: 50, offset: 0 }).total,
    ).toBe(1);
    expect(
      searchFonts(catalog, { minWeight: 400, maxWeight: 700, limit: 50, offset: 0 })
        .fonts.map((entry) => entry.postScriptName),
    ).toEqual(["HiraginoSans-W6", "TimesNewRomanPS-ItalicMT"]);
    expect(
      searchFonts(catalog, { available: false, limit: 50, offset: 0 }).total,
    ).toBe(0);
  });

  it("pages without duplicating or dropping a face", () => {
    const first = searchFonts(catalog, { limit: 2, offset: 0 });
    const second = searchFonts(catalog, { limit: 2, offset: 2 });
    expect(first.fonts).toHaveLength(2);
    expect(first.total).toBe(4);
    expect(first.nextOffset).toBe(2);
    expect(second.nextOffset).toBeNull();
    expect([...first.fonts, ...second.fonts].map((entry) => entry.postScriptName)).toEqual([
      "HiraginoMinchoProN-W3",
      "HiraginoSans-W3",
      "HiraginoSans-W6",
      "TimesNewRomanPS-ItalicMT",
    ]);
  });

  it("returns the catalog state when the platform has no catalog", () => {
    const result = searchFonts(
      { supported: false, reason: "unsupported_platform", updatedAt, faces: [] },
      { limit: 50, offset: 0 },
    );
    expect(result).toEqual({
      fonts: [],
      total: 0,
      nextOffset: null,
      catalog: { supported: false, reason: "unsupported_platform", updatedAt },
    });
  });
});
