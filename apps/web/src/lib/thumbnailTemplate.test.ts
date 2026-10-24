import { describe, expect, it } from "vitest";
import { defaultThumbnailInput, thumbnailInputWithDefaults } from "./thumbnailTemplate";

describe("defaultThumbnailInput", () => {
  it("seeds the cutout template defaults", () => {
    expect(defaultThumbnailInput("thumbnail.cutout-hero", 1)).toEqual({
      headline: "",
      subjectSide: "right",
      flipForeground: false,
      subjectAnchor: "bottom-center",
      subjectScale: 1,
      textWidth: 50,
      wrapText: true,
    });
  });

  it("returns an empty input for an unknown template", () => {
    expect(defaultThumbnailInput("thumbnail.missing", 1)).toEqual({});
  });
});

describe("thumbnailInputWithDefaults", () => {
  it("fills missing optional inputs without overwriting saved values", () => {
    expect(
      thumbnailInputWithDefaults("thumbnail.cutout-hero", 1, {
        headline: "保存済み",
        subjectScale: 1.4,
        wrapText: false,
      }),
    ).toEqual({
      headline: "保存済み",
      subjectSide: "right",
      flipForeground: false,
      subjectAnchor: "bottom-center",
      subjectScale: 1.4,
      textWidth: 50,
      wrapText: false,
    });
  });
});
