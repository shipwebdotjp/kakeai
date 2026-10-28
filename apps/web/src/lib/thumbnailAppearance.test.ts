import { describe, expect, it } from "vitest";
import {
  clearAccent,
  clearOutlineValue,
  clearScrimValue,
  clearTextDecoration,
  clearTextFontFaceForLocale,
  clearTextValue,
  setAccent,
  setDecorationValue,
  setOutlineValue,
  setScrimValue,
  setTextDecoration,
  setTextFontFaceForLocale,
  setTextValue,
} from "./thumbnailAppearance";

const FACE = { family: "Noto Sans JP", style: "normal" as const, weight: 400, fallbacks: [] };

describe("thumbnailAppearance helpers", () => {
  it("sets and clears text properties", () => {
    const withSize = setTextValue(null, "headline", "fontSize", 80);
    expect(withSize).toEqual({ headline: { fontSize: 80 } });
    expect(clearTextValue(withSize, "headline", "fontSize")).toBeNull();
  });

  it("keeps sibling properties when one is cleared", () => {
    const value = setTextValue(
      setTextValue(null, "headline", "fontSize", 80),
      "headline",
      "color",
      "#FFFFFF",
    );
    expect(clearTextValue(value, "headline", "fontSize")).toEqual({
      headline: { color: "#FFFFFF" },
    });
  });

  it("sets decoration flags and clears the decoration group", () => {
    const value = setTextDecoration(null, "subline", { bold: true });
    expect(value).toEqual({ subline: { decoration: { bold: true } } });
    expect(setDecorationValue(value, "subline", "italic", true)).toEqual({
      subline: { decoration: { bold: true, italic: true } },
    });
    expect(clearTextDecoration(value, "subline")).toBeNull();
  });

  it("sets and clears outline color and width independently", () => {
    const value = setOutlineValue(null, "headline", "color", "#00FF00");
    expect(value).toEqual({ headline: { outline: { color: "#00FF00" } } });
    const wider = setOutlineValue(value, "headline", "width", 6);
    expect(wider).toEqual({ headline: { outline: { color: "#00FF00", width: 6 } } });
    expect(clearOutlineValue(wider, "headline", "width")).toEqual({
      headline: { outline: { color: "#00FF00" } },
    });
    expect(clearOutlineValue({ headline: { outline: { width: 6 } } }, "headline", "width")).toBeNull();
  });

  it("does not mutate the previous outline object", () => {
    const original = { headline: { outline: { color: "#00FF00", width: 6 } } };
    const cleared = clearOutlineValue(original, "headline", "width");
    expect(original).toEqual({ headline: { outline: { color: "#00FF00", width: 6 } } });
    expect(cleared).toEqual({ headline: { outline: { color: "#00FF00" } } });
  });

  it("sets and clears accent and scrim", () => {
    const value = setAccent(null, "#FF00FF");
    expect(value).toEqual({ accent: "#FF00FF" });
    expect(clearAccent(value)).toBeNull();

    const scrim = setScrimValue(null, "opacity", 0.2);
    expect(scrim).toEqual({ scrim: { opacity: 0.2 } });
    const colored = setScrimValue(scrim, "color", "#000000");
    expect(clearScrimValue(colored, "opacity")).toEqual({ scrim: { color: "#000000" } });
  });

  it("does not mutate the previous scrim object", () => {
    const original = { scrim: { color: "#000000", opacity: 0.2 } };
    const cleared = clearScrimValue(original, "opacity");
    expect(original).toEqual({ scrim: { color: "#000000", opacity: 0.2 } });
    expect(cleared).toEqual({ scrim: { color: "#000000" } });
  });

  it("sets and clears the Font Face for one locale", () => {
    const ja = setTextFontFaceForLocale(null, "headline", "ja-JP", FACE);
    expect(ja).toEqual({ headline: { fontFaceByLocale: { "ja-JP": FACE } } });
    const both = setTextFontFaceForLocale(
      ja,
      "headline",
      "en-US",
      { ...FACE, family: "Inter" },
    );
    expect(both).toEqual({
      headline: {
        fontFaceByLocale: {
          "ja-JP": FACE,
          "en-US": { ...FACE, family: "Inter" },
        },
      },
    });
    expect(clearTextFontFaceForLocale(both, "headline", "ja-JP")).toEqual({
      headline: { fontFaceByLocale: { "en-US": { ...FACE, family: "Inter" } } },
    });
    expect(clearTextFontFaceForLocale(ja, "headline", "ja-JP")).toBeNull();
  });
});
